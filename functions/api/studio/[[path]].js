import { getDatabase } from '../../utils/databaseAdapter.js';
import { addFileToIndex, removeFileFromIndex } from '../../utils/indexManager.js';
import { hashPassword, verifyPassword } from '../../utils/auth/passwordHash.js';
import { validateSession } from '../../utils/auth/sessionManager.js';

const BASE_LIMIT = 100 * 1024 * 1024;
const CREATOR_MONTH_LIMIT = 1024 * 1024 * 1024;
const SINGLE_FILE_LIMIT = 25 * 1024 * 1024;
const SESSION_SECONDS = 7 * 86400;
const DEFAULT_GUILD_IDS = '1291925535324110879,1379304008157499423';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
});
const fail = (message, status = 400) => json({ error: message }, status);
const uid = () => crypto.randomUUID();
const monthKey = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(x => x.toString(16).padStart(2, '0')).join('');
const cookie = (token, age = SESSION_SECONDS) => `studio_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const getCookie = (request, key) => request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${key}=`))?.slice(key.length + 1) || '';
const cleanName = s => String(s || '').replace(/[\r\n/\\<>:"|?*\x00-\x1f]/g, '_').trim().slice(0, 100);
const plain = s => String(s || '').trim();
const safeUser = u => ({ id: u.id, username: u.username, discordId: u.discord_id, discordName: u.discord_name, accountType: u.account_type, tier: u.tier, storedBytes: u.stored_bytes, monthUploadedBytes: u.month_uploaded_bytes, monthKey: u.month_key, baseLimit: BASE_LIMIT, creatorMonthLimit: CREATOR_MONTH_LIMIT });

function dbOf(env) {
  if (!env.img_d1?.prepare) throw new Error('Studio requires a D1 binding named img_d1');
  return env.img_d1;
}
function safeOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin;
}
async function bodyJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 65536) throw new Error('请求过大');
  return request.json();
}
async function currentUser(db, request) {
  const token = getCookie(request, 'studio_session');
  if (!token) return null;
  const row = await db.prepare('SELECT u.* FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0').bind(await sha(token), Date.now()).first();
  return row || null;
}
async function sessionResponse(db, user) {
  const token = uid() + uid();
  await db.prepare('INSERT INTO studio_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token), user.id, Date.now() + SESSION_SECONDS * 1000).run();
  const headers = { 'Set-Cookie': cookie(token), 'Cache-Control': 'no-store' };
  return json({ user: safeUser(user) }, 200, headers);
}
function actualImageType(bytes) {
  const text = (start, length) => new TextDecoder().decode(bytes.slice(start, start + length));
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  if (text(0, 6) === 'GIF87a' || text(0, 6) === 'GIF89a') return 'image/gif';
  if (text(4, 4) === 'ftyp' && ['avif', 'avis'].includes(text(8, 4))) return 'image/avif';
  if (text(0, 2) === 'BM') return 'image/bmp';
  return null;
}
function redirectWithCookie(url, name, value, age = 600) {
  return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': `${name}=${value}; Path=/api/studio/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`, 'Cache-Control': 'no-store' } });
}
async function oauthStart(env, request) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return fail('Discord 登录尚未配置', 503);
  const state = uid().replaceAll('-', '') + uid().replaceAll('-', '');
  const origin = new URL(request.url).origin;
  const destination = new URL('https://discord.com/oauth2/authorize');
  destination.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify guilds', redirect_uri: `${origin}/api/studio/oauth/callback`, state }).toString();
  return redirectWithCookie(destination.toString(), 'studio_oauth_state', state);
}
async function oauthCallback(env, db, request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || state !== getCookie(request, 'studio_oauth_state')) return fail('Discord 授权状态无效，请重新登录', 401);
  const origin = url.origin;
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: `${origin}/api/studio/oauth/callback` })
  });
  if (!tokenResponse.ok) return fail('Discord 授权失败，请重试', 502);
  const token = (await tokenResponse.json()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const [meRes, guildsRes] = await Promise.all([
    fetch('https://discord.com/api/v10/users/@me', { headers }),
    fetch('https://discord.com/api/v10/users/@me/guilds', { headers })
  ]);
  if (!meRes.ok || !guildsRes.ok) return fail('Discord 成员信息读取失败', 502);
  const me = await meRes.json();
  const guilds = await guildsRes.json();
  const allowed = new Set(plain(env.DISCORD_GUILD_IDS || DEFAULT_GUILD_IDS).split(',').map(x => x.trim()).filter(Boolean));
  if (!Array.isArray(guilds) || !guilds.some(g => allowed.has(g.id))) return new Response(null, { status: 302, headers: { Location: '/studio/?error=not_member', 'Cache-Control': 'no-store' } });
  let user = await db.prepare('SELECT * FROM studio_users WHERE discord_id=?').bind(me.id).first();
  if (!user) {
    const id = uid();
    await db.prepare("INSERT INTO studio_users(id,discord_id,discord_name,account_type,tier) VALUES(?,?,?,'discord','pichu')").bind(id, me.id, me.global_name || me.username || me.id).run();
    user = await db.prepare('SELECT * FROM studio_users WHERE id=?').bind(id).first();
    await db.prepare('INSERT INTO studio_albums(id,user_id,name) VALUES(?,?,?)').bind(uid(), id, '我的相册').run();
  } else {
    await db.prepare('UPDATE studio_users SET discord_name=? WHERE id=?').bind(me.global_name || me.username || me.id, user.id).run();
  }
  if (user.disabled) return fail('此账号已停用', 403);
  const sessionToken = uid() + uid();
  await db.prepare('INSERT INTO studio_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(sessionToken), user.id, Date.now() + SESSION_SECONDS * 1000).run();
  const h = new Headers({ Location: '/studio/', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookie(sessionToken));
  h.append('Set-Cookie', 'studio_oauth_state=; Path=/api/studio/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return new Response(null, { status: 302, headers: h });
}
async function login(db, request) {
  const data = await bodyJson(request);
  const username = plain(data.username).toLowerCase();
  const password = String(data.password || '');
  if (!username || !password) return fail('请输入账号和密码');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await sha(`${ip}:${username}`);
  const now = Date.now();
  const attempt = await db.prepare('SELECT * FROM studio_login_attempts WHERE key=?').bind(key).first();
  if (attempt?.attempts >= 8 && now - attempt.window_start < 10 * 60 * 1000) return fail('尝试次数过多，请十分钟后重试', 429);
  const user = await db.prepare("SELECT * FROM studio_users WHERE username=? AND account_type='local'").bind(username).first();
  if (!user || user.disabled || !await verifyPassword(password, user.password_hash)) {
    await db.prepare('INSERT INTO studio_login_attempts(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN ?-window_start>600000 THEN ? ELSE window_start END,attempts=CASE WHEN ?-window_start>600000 THEN 1 ELSE attempts+1 END').bind(key, now, now, now, now).run();
    return fail('账号或密码错误', 401);
  }
  await db.prepare('DELETE FROM studio_login_attempts WHERE key=?').bind(key).run();
  return sessionResponse(db, user);
}
async function reserve(db, user, size) {
  const month = monthKey();
  await db.prepare('UPDATE studio_users SET month_key=?,month_uploaded_bytes=0 WHERE id=? AND month_key<>?').bind(month, user.id, month).run();
  const result = await db.prepare("UPDATE studio_users SET stored_bytes=stored_bytes+?,month_uploaded_bytes=month_uploaded_bytes+? WHERE id=? AND disabled=0 AND ((tier='pichu' AND stored_bytes+?<=?) OR (tier='pikachu' AND month_uploaded_bytes+?<=?))")
    .bind(size, size, user.id, size, BASE_LIMIT, size, CREATOR_MONTH_LIMIT).run();
  return result.meta?.changes === 1;
}
async function refund(db, id, size) {
  await db.prepare('UPDATE studio_users SET stored_bytes=max(0,stored_bytes-?),month_uploaded_bytes=max(0,month_uploaded_bytes-?) WHERE id=?').bind(size, size, id).run();
}
function acceptedSource(raw, env) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('图片链接无效'); }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || !u.hostname.includes('.') || u.username || u.password || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(':') || u.hostname.endsWith('.local')) throw new Error('仅支持公开的 HTTPS 图片链接');
  const hosts = plain(env.STUDIO_IMPORT_HOSTS || 'iili.io,i.postimg.cc').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(u.hostname.toLowerCase())) throw new Error(`暂不允许从 ${u.hostname} 导入，请联系管理员添加来源域名`);
  return u.toString();
}
async function fetchImage(raw, env) {
  let url = acceptedSource(raw, env);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'image/*' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) { url = acceptedSource(new URL(res.headers.get('Location'), url).toString(), env); continue; }
    if (!res.ok) throw new Error(`源站返回 ${res.status}`);
    const sizeHint = Number(res.headers.get('Content-Length') || 0);
    if (sizeHint > SINGLE_FILE_LIMIT) throw new Error('单张图片超过 25 MB');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('源站没有返回图片内容');
    const chunks = []; let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SINGLE_FILE_LIMIT) { await reader.cancel(); throw new Error('单张图片超过 25 MB'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw new Error('源文件不是受支持的图片');
    return { bytes, type, sourceUrl: raw };
  }
  throw new Error('源站重定向次数过多');
}
async function saveImage(context, db, user, albumId, file) {
  const { env, request } = context;
  if (!env.img_r2?.put) return fail('R2 存储桶未绑定为 img_r2', 503);
  const album = await db.prepare('SELECT id FROM studio_albums WHERE id=? AND user_id=?').bind(albumId, user.id).first();
  if (!album) return fail('相册不存在', 404);
  const { bytes, type, name, sourceUrl } = file;
  if (!IMAGE_TYPES.has(type) || bytes.byteLength < 1 || bytes.byteLength > SINGLE_FILE_LIMIT || actualImageType(bytes) !== type) return fail('只接受 25 MB 以内的 PNG、JPEG、WebP、GIF、AVIF 或 BMP 原图', 400);
  if (!await reserve(db, user, bytes.byteLength)) return fail('上传额度不足', 403);
  const id = `studio/${user.id}/${album.id}/${uid()}.${EXTENSIONS[type]}`;
  const metadata = { FileName: cleanName(name) || `image.${EXTENSIONS[type]}`, FileType: type, FileSize: (bytes.byteLength / 1048576).toFixed(2), FileSizeBytes: bytes.byteLength, UploadIP: request.headers.get('CF-Connecting-IP') || '', UploadAddress: '', ListType: 'None', TimeStamp: Date.now(), Label: 'None', Directory: `studio/${user.id}/${album.id}/`, Channel: 'CloudflareR2', ChannelName: 'Studio', OwnerId: user.id, Tags: [] };
  try {
    await env.img_r2.put(id, bytes, { httpMetadata: { contentType: type } });
    await getDatabase(env).put(id, '', { metadata });
    await db.prepare('INSERT INTO studio_files(id,user_id,album_id,file_name,mime_type,size_bytes,source_url) VALUES(?,?,?,?,?,?,?)').bind(id, user.id, album.id, metadata.FileName, type, bytes.byteLength, sourceUrl || null).run();
    context.waitUntil(addFileToIndex(context, id, metadata));
    return json({ id, url: `${new URL(request.url).origin}/file/${id}`, fileName: metadata.FileName, sizeBytes: bytes.byteLength, sourceUrl });
  } catch (error) {
    console.error('Studio upload failed', error);
    await Promise.allSettled([env.img_r2.delete(id), getDatabase(env).delete(id), refund(db, user.id, bytes.byteLength)]);
    return fail('保存图片失败，请重试', 500);
  }
}
async function handleUser(context, db, user, route, method) {
  const { request, env } = context;
  if (route === 'me' && method === 'GET') {
    const fresh = await db.prepare('SELECT * FROM studio_users WHERE id=?').bind(user.id).first();
    const application = await db.prepare('SELECT id,status,work_title,created_at,reviewed_at FROM studio_applications WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(user.id).first();
    return json({ user: safeUser(fresh), application });
  }
  if (route === 'logout' && method === 'POST') {
    await db.prepare('DELETE FROM studio_sessions WHERE token_hash=?').bind(await sha(getCookie(request, 'studio_session'))).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (route === 'albums' && method === 'GET') {
    const rows = await db.prepare('SELECT a.*,count(f.id) file_count FROM studio_albums a LEFT JOIN studio_files f ON f.album_id=a.id WHERE a.user_id=? GROUP BY a.id ORDER BY a.created_at').bind(user.id).all();
    return json({ albums: rows.results || [] });
  }
  if (route === 'albums' && method === 'POST') {
    const data = await bodyJson(request); const name = plain(data.name).slice(0, 80);
    if (!name) return fail('请输入相册名称');
    const id = uid();
    await db.prepare('INSERT INTO studio_albums(id,user_id,name) VALUES(?,?,?)').bind(id, user.id, name).run();
    return json({ id, name }, 201);
  }
  if (route.startsWith('albums/') && method === 'DELETE') {
    const id = route.split('/')[1];
    const album = await db.prepare('SELECT id FROM studio_albums WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!album) return fail('相册不存在', 404);
    const count = await db.prepare('SELECT count(*) n FROM studio_files WHERE album_id=?').bind(id).first();
    if (count.n) return fail('请先清空相册', 409);
    await db.prepare('DELETE FROM studio_albums WHERE id=? AND user_id=?').bind(id, user.id).run();
    return json({ ok: true });
  }
  if (route === 'files' && method === 'GET') {
    const params = new URL(request.url).searchParams;
    const albumId = params.get('album');
    const offset = Math.min(1000000, Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0));
    const rows = albumId ? await db.prepare('SELECT id,album_id,file_name,mime_type,size_bytes,source_url,created_at FROM studio_files WHERE user_id=? AND album_id=? ORDER BY created_at DESC, id DESC LIMIT 101 OFFSET ?').bind(user.id, albumId, offset).all() : await db.prepare('SELECT id,album_id,file_name,mime_type,size_bytes,source_url,created_at FROM studio_files WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 101 OFFSET ?').bind(user.id, offset).all();
    const page = rows.results || [];
    return json({ files: page.slice(0, 100).map(f => ({ ...f, url: `${new URL(request.url).origin}/file/${f.id}` })), hasMore: page.length > 100 });
  }
  if (route === 'files' && method === 'POST') {
    if (Number(request.headers.get('Content-Length') || 0) > SINGLE_FILE_LIMIT + 65536) return fail('单张图片不能超过 25 MB', 413);
    const form = await request.formData();
    const uploaded = form.get('file');
    if (!uploaded || typeof uploaded.arrayBuffer !== 'function' || uploaded.size > SINGLE_FILE_LIMIT) return fail('请选择 25 MB 以内的图片');
    return saveImage(context, db, user, String(form.get('albumId') || ''), { bytes: new Uint8Array(await uploaded.arrayBuffer()), type: uploaded.type, name: uploaded.name });
  }
  if (route === 'import-image' && method === 'POST') {
    const data = await bodyJson(request);
    const sourceUrl = plain(data.url);
    let file;
    try { file = await fetchImage(sourceUrl, env); } catch (e) { return fail(e.message, 422); }
    const name = cleanName(new URL(sourceUrl).pathname.split('/').pop()) || 'imported-image';
    return saveImage(context, db, user, String(data.albumId || ''), { ...file, name });
  }
  if (route.startsWith('files/') && method === 'DELETE') {
    const id = decodeURIComponent(route.slice(6));
    const file = await db.prepare('SELECT * FROM studio_files WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!file) return fail('图片不存在', 404);
    await env.img_r2.delete(id);
    await getDatabase(env).delete(id);
    await db.prepare('DELETE FROM studio_files WHERE id=? AND user_id=?').bind(id, user.id).run();
    await db.prepare('UPDATE studio_users SET stored_bytes=max(0,stored_bytes-?) WHERE id=?').bind(file.size_bytes, user.id).run();
    context.waitUntil(removeFileFromIndex(context, id));
    return json({ ok: true });
  }
  if (route === 'applications' && method === 'POST') {
    const data = await bodyJson(request);
    const discordId = plain(data.discordId);
    const title = plain(data.workTitle).slice(0, 120);
    const workUrl = plain(data.workUrl).slice(0, 500);
    const note = plain(data.note).slice(0, 1000);
    if (!/^\d+$/.test(discordId) || !title) return fail('请填写数字 Discord ID 和作品名称');
    const pending = await db.prepare("SELECT id FROM studio_applications WHERE user_id=? AND status='pending'").bind(user.id).first();
    if (pending) return fail('已有待审核申请', 409);
    const id = uid();
    await db.prepare('INSERT INTO studio_applications(id,user_id,discord_id,work_title,work_url,note) VALUES(?,?,?,?,?,?)').bind(id, user.id, discordId, title, workUrl || null, note || null).run();
    return json({ id, status: 'pending' }, 201);
  }
  return fail('接口不存在', 404);
}
async function handleAdmin(context, db, route, method) {
  const { env, request } = context;
  const admin = await validateSession(env, request, 'admin');
  if (!admin.valid) return fail('请先登录原图床管理后台', 401);
  if (route === 'admin/overview' && method === 'GET') {
    const [users, applications] = await Promise.all([
      db.prepare('SELECT id,username,discord_id,discord_name,account_type,tier,disabled,stored_bytes,month_key,month_uploaded_bytes,created_at FROM studio_users ORDER BY created_at DESC LIMIT 500').all(),
      db.prepare('SELECT a.*,u.username,u.discord_name FROM studio_applications a JOIN studio_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200').all()
    ]);
    return json({ users: users.results || [], applications: applications.results || [] });
  }
  if (route === 'admin/users' && method === 'POST') {
    const data = await bodyJson(request);
    const username = plain(data.username).toLowerCase();
    const password = String(data.password || '');
    if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 12) return fail('账号须为 3–32 位字母、数字或下划线；密码至少 12 位');
    const id = uid();
    const hashed = await hashPassword(password);
    try {
      await db.prepare("INSERT INTO studio_users(id,username,password_hash,account_type,tier) VALUES(?,?,?,'local','pichu')").bind(id, username, hashed).run();
      await db.prepare('INSERT INTO studio_albums(id,user_id,name) VALUES(?,?,?)').bind(uid(), id, '我的相册').run();
    } catch { return fail('账号已存在', 409); }
    return json({ id, username }, 201);
  }
  if (route.startsWith('admin/users/') && method === 'PATCH') {
    const id = route.split('/')[2];
    const data = await bodyJson(request);
    const user = await db.prepare('SELECT id FROM studio_users WHERE id=?').bind(id).first();
    if (!user) return fail('用户不存在', 404);
    if (data.tier && !['pichu', 'pikachu'].includes(data.tier)) return fail('权限等级无效');
    if (data.tier) await db.prepare('UPDATE studio_users SET tier=?,month_uploaded_bytes=0,month_key=? WHERE id=?').bind(data.tier, monthKey(), id).run();
    if (typeof data.disabled === 'boolean') await db.prepare('UPDATE studio_users SET disabled=? WHERE id=?').bind(data.disabled ? 1 : 0, id).run();
    return json({ ok: true });
  }
  if (route.startsWith('admin/applications/') && method === 'POST') {
    const id = route.split('/')[2];
    const data = await bodyJson(request);
    if (!['approved', 'rejected'].includes(data.decision)) return fail('审核结果无效');
    const application = await db.prepare("SELECT * FROM studio_applications WHERE id=? AND status='pending'").bind(id).first();
    if (!application) return fail('申请不存在或已审核', 404);
    await db.prepare('UPDATE studio_applications SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status=\'pending\'').bind(data.decision, id).run();
    if (data.decision === 'approved') await db.prepare("UPDATE studio_users SET tier='pikachu',month_key=?,month_uploaded_bytes=0 WHERE id=?").bind(monthKey(), application.user_id).run();
    return json({ ok: true });
  }
  return fail('接口不存在', 404);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/studio\/?/, '').replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return fail('不支持此请求方法', 405);
  if (method !== 'GET' && !safeOrigin(request)) return fail('请求来源无效', 403);
  try {
    const db = dbOf(env);
    if (route === 'config' && method === 'GET') return json({ discordEnabled: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET), maxFileBytes: SINGLE_FILE_LIMIT });
    if (route === 'oauth/start' && method === 'GET') return oauthStart(env, request);
    if (route === 'oauth/callback' && method === 'GET') return oauthCallback(env, db, request);
    if (route === 'login' && method === 'POST') return login(db, request);
    if (route.startsWith('admin/')) return handleAdmin(context, db, route, method);
    const user = await currentUser(db, request);
    if (!user) return fail('请先登录', 401);
    return handleUser(context, db, user, route, method);
  } catch (error) {
    console.error('Studio API error', error);
    if (error instanceof SyntaxError) return fail('请求格式错误');
    if (error.message === '请求过大') return fail(error.message, 413);
    return fail('服务暂时不可用，请检查 D1 迁移和绑定', 503);
  }
}
