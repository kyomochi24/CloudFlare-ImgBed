import { getDatabase } from '../../utils/databaseAdapter.js';
import { addFileToIndex, removeFileFromIndex } from '../../utils/indexManager.js';
import { hashPassword, verifyPassword } from '../../utils/auth/passwordHash.js';
import { validateSession } from '../../utils/auth/sessionManager.js';

const BASE_LIMIT = 100 * 1024 * 1024;
const CREATOR_MONTH_LIMIT = 1024 * 1024 * 1024;
const SINGLE_FILE_LIMIT = 25 * 1024 * 1024;
const MIN_PART_SIZE = 8 * 1024 * 1024;
const MAX_PART_SIZE = 80 * 1024 * 1024;
const MAX_PARTS = 10000;
const SESSION_SECONDS = 7 * 86400;
const DEFAULT_GUILD_IDS = '1291925535324110879,1379304008157499423';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
});
const fail = (message, status = 400) => json({ error: message }, status);
const uid = () => crypto.randomUUID();
const shortObjectKey = extension => `studio/${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length]).join('')}.${extension}`;
const monthKey = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(x => x.toString(16).padStart(2, '0')).join('');
const cookie = (token, age = SESSION_SECONDS) => `studio_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const getCookie = (request, key) => request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${key}=`))?.slice(key.length + 1) || '';
const cleanName = s => String(s || '').replace(/[\r\n/\\<>:"|?*\x00-\x1f]/g, '_').trim().slice(0, 100);
const plain = s => String(s || '').trim();
const safeUser = u => ({ id: u.id, username: u.username, discordId: u.discord_id, discordName: u.discord_name, accountType: u.account_type, tier: u.is_super ? 'super' : u.tier, storedBytes: u.stored_bytes, monthUploadedBytes: u.month_uploaded_bytes, monthKey: u.month_key, baseLimit: BASE_LIMIT, creatorMonthLimit: CREATOR_MONTH_LIMIT });
const userSelect = 'SELECT u.*, EXISTS(SELECT 1 FROM studio_super_users su WHERE su.user_id=u.id) AS is_super FROM studio_users u';

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
  const row = await db.prepare(`SELECT u.*, EXISTS(SELECT 1 FROM studio_super_users su WHERE su.user_id=u.id) AS is_super FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).bind(await sha(token), Date.now()).first();
  return row || null;
}
async function sessionResponse(db, user) {
  const token = uid() + uid();
  await db.prepare('INSERT INTO studio_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token), user.id, Date.now() + SESSION_SECONDS * 1000).run();
  const headers = { 'Set-Cookie': cookie(token), 'Cache-Control': 'no-store' };
  const fresh = await db.prepare(`${userSelect} WHERE u.id=?`).bind(user.id).first();
  return json({ user: safeUser(fresh) }, 200, headers);
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
async function reconcileCreatorMonth(db, id) {
  const month = monthKey();
  // A previous approval reset month_uploaded_bytes to zero. Restore at least the
  // bytes represented by files still present this month, while preserving a
  // higher historical counter for files that were later deleted.
  await db.prepare(`UPDATE studio_users SET month_key=?, month_uploaded_bytes=max(
    CASE WHEN month_key=? THEN month_uploaded_bytes ELSE 0 END,
    COALESCE((SELECT sum(f.size_bytes) FROM studio_files f WHERE f.user_id=studio_users.id
      AND strftime('%Y-%m', datetime(f.created_at, '+8 hours'))=?), 0)
  ) WHERE id=? AND tier='pikachu' AND NOT EXISTS(SELECT 1 FROM studio_super_users WHERE user_id=studio_users.id)`)
    .bind(month, month, month, id).run();
}
async function reserve(db, user, size) {
  const month = monthKey();
  if (user.tier === 'pikachu' && !user.is_super) await reconcileCreatorMonth(db, user.id);
  await db.prepare('UPDATE studio_users SET month_key=?,month_uploaded_bytes=0 WHERE id=? AND month_key<>?').bind(month, user.id, month).run();
  const result = await db.prepare("UPDATE studio_users SET stored_bytes=stored_bytes+?,month_uploaded_bytes=month_uploaded_bytes+? WHERE id=? AND disabled=0 AND (EXISTS(SELECT 1 FROM studio_super_users WHERE user_id=studio_users.id) OR (tier='pichu' AND stored_bytes+?<=?) OR (tier='pikachu' AND month_uploaded_bytes+?<=?))")
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
  const hosts = new Set(['iili.io', 'i.postimg.cc', 'img.baidu.re', ...plain(env.STUDIO_IMPORT_HOSTS).split(',').map(x => x.trim().toLowerCase()).filter(Boolean)]);
  if (!hosts.has(u.hostname.toLowerCase())) throw new Error(`暂不允许从 ${u.hostname} 导入，请联系管理员添加来源域名`);
  return u.toString();
}
async function fetchImage(raw, env) {
  let url = acceptedSource(raw, env);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'image/*' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) { url = acceptedSource(new URL(res.headers.get('Location'), url).toString(), env); continue; }
    if (res.status === 403) throw new Error('图片源站拒绝服务器读取（403）；请先把图片下载到电脑，再上传到相册');
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
    const type = actualImageType(bytes);
    if (!type || !IMAGE_TYPES.has(type)) throw new Error('源文件不是受支持的图片');
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
  if (bytes.byteLength < 1 || bytes.byteLength > SINGLE_FILE_LIMIT || (!user.is_super && (!IMAGE_TYPES.has(type) || actualImageType(bytes) !== type))) return fail('普通账号只接受 25 MB 以内的 PNG、JPEG、WebP、GIF、AVIF 或 BMP 原图', 400);
  if (!await reserve(db, user, bytes.byteLength)) return fail('上传额度不足', 403);
  const extension = user.is_super ? (cleanName(name).match(/\.([a-z0-9]{1,10})$/i)?.[1] || 'bin').toLowerCase() : EXTENSIONS[type];
  const id = shortObjectKey(extension);
  const metadata = studioMetadata(request, user, album, cleanName(name) || `file.${extension}`, type, bytes.byteLength);
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
function studioMetadata(request, user, album, name, type, size) {
  return { FileName: name, FileType: type, FileSize: (size / 1048576).toFixed(2), FileSizeBytes: size, UploadIP: request.headers.get('CF-Connecting-IP') || '', UploadAddress: '', ListType: 'None', TimeStamp: Date.now(), Label: 'None', Directory: 'studio/', Channel: 'CloudflareR2', ChannelName: 'Studio', OwnerId: user.id, Tags: [] };
}
async function multipart(context, db, user, route, method) {
  const { request, env } = context;
  if (!user.is_super) return fail('只有超级无敌美化大师丘可以上传任意文件', 403);
  if (!env.img_r2?.createMultipartUpload) return fail('R2 存储桶未绑定为 img_r2', 503);
  if (route === 'multipart/start' && method === 'POST') {
    const data = await bodyJson(request);
    const size = Number(data.size);
    const name = cleanName(data.name);
    const type = plain(data.type).split(';')[0].toLowerCase() || 'application/octet-stream';
    const album = await db.prepare('SELECT id FROM studio_albums WHERE id=? AND user_id=?').bind(String(data.albumId || ''), user.id).first();
    if (!album) return fail('相册不存在', 404);
    if (!name || !Number.isSafeInteger(size) || size < 1 || !/^[\w.+-]+\/[\w.+-]+$/.test(type)) return fail('文件信息无效');
    const partSize = Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS / 1048576) * 1048576);
    if (partSize > MAX_PART_SIZE) return fail('文件超过当前 Cloudflare 请求与 R2 分片可处理的大小', 413);
    const extension = (name.match(/\.([a-z0-9]{1,10})$/i)?.[1] || 'bin').toLowerCase();
    const key = shortObjectKey(extension);
    const upload = await env.img_r2.createMultipartUpload(key, { httpMetadata: { contentType: type } });
    const id = uid();
    try {
      await db.prepare('INSERT INTO studio_uploads(id,user_id,album_id,object_key,r2_upload_id,file_name,mime_type,size_bytes,part_size,part_count) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, user.id, album.id, key, upload.uploadId, name, type, size, partSize, Math.ceil(size / partSize)).run();
    } catch (error) { await upload.abort(); throw error; }
    return json({ id, partSize, partCount: Math.ceil(size / partSize) }, 201);
  }
  const match = /^multipart\/([^/]+)\/(parts\/(\d+)|complete|abort)$/.exec(route);
  if (!match) return fail('接口不存在', 404);
  const row = await db.prepare('SELECT * FROM studio_uploads WHERE id=? AND user_id=?').bind(match[1], user.id).first();
  if (!row) return fail('上传任务不存在，请重新选择文件', 404);
  const upload = env.img_r2.resumeMultipartUpload(row.object_key, row.r2_upload_id);
  if (match[2].startsWith('parts/') && method === 'PUT') {
    const number = Number(match[3]);
    if (!Number.isInteger(number) || number < 1 || number > row.part_count) return fail('分片编号无效');
    const expected = number === row.part_count ? row.size_bytes - row.part_size * (number - 1) : row.part_size;
    const hinted = Number(request.headers.get('Content-Length') || 0);
    if (hinted && hinted !== expected) return fail('分片大小错误', 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== expected || bytes.byteLength > MAX_PART_SIZE) return fail('分片大小错误', 413);
    const part = await upload.uploadPart(number, bytes);
    await db.prepare('INSERT INTO studio_upload_parts(upload_id,part_number,etag) VALUES(?,?,?) ON CONFLICT(upload_id,part_number) DO UPDATE SET etag=excluded.etag').bind(row.id, number, part.etag).run();
    return json({ partNumber: number });
  }
  if (match[2] === 'abort' && method === 'POST') {
    await upload.abort();
    await db.prepare('DELETE FROM studio_upload_parts WHERE upload_id=?').bind(row.id).run();
    await db.prepare('DELETE FROM studio_uploads WHERE id=?').bind(row.id).run();
    return json({ ok: true });
  }
  if (match[2] === 'complete' && method === 'POST') {
    const results = await db.prepare('SELECT part_number,etag FROM studio_upload_parts WHERE upload_id=? ORDER BY part_number').bind(row.id).all();
    const parts = results.results || [];
    if (parts.length !== row.part_count || parts.some((part, index) => part.part_number !== index + 1)) return fail('仍有文件分片未上传完成', 409);
    if (!await reserve(db, user, row.size_bytes)) return fail('账号已停用或权限已变更', 403);
    const metadata = studioMetadata(request, user, { id: row.album_id }, row.file_name, row.mime_type, row.size_bytes);
    let completed = false;
    try {
      await upload.complete(parts.map(part => ({ partNumber: part.part_number, etag: part.etag })));
      completed = true;
      await getDatabase(env).put(row.object_key, '', { metadata });
      await db.prepare('INSERT INTO studio_files(id,user_id,album_id,file_name,mime_type,size_bytes) VALUES(?,?,?,?,?,?)').bind(row.object_key, user.id, row.album_id, row.file_name, row.mime_type, row.size_bytes).run();
      await db.prepare('DELETE FROM studio_upload_parts WHERE upload_id=?').bind(row.id).run();
      await db.prepare('DELETE FROM studio_uploads WHERE id=?').bind(row.id).run();
      context.waitUntil(addFileToIndex(context, row.object_key, metadata));
      return json({ id: row.object_key, url: `${new URL(request.url).origin}/file/${row.object_key}`, fileName: row.file_name, sizeBytes: row.size_bytes });
    } catch (error) {
      console.error('Studio multipart completion failed', error);
      await Promise.allSettled([completed ? env.img_r2.delete(row.object_key) : upload.abort(), getDatabase(env).delete(row.object_key), refund(db, user.id, row.size_bytes)]);
      return fail('保存文件失败，请重试', 500);
    }
  }
  return fail('请求方法无效', 405);
}
async function handleUser(context, db, user, route, method) {
  const { request, env } = context;
  if (route === 'me' && method === 'GET') {
    if (user.tier === 'pikachu' && !user.is_super) await reconcileCreatorMonth(db, user.id);
    const fresh = await db.prepare(`${userSelect} WHERE u.id=?`).bind(user.id).first();
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
  if (route.startsWith('multipart/')) return multipart(context, db, user, route, method);
  if (route === 'import-image' && method === 'POST') {
    const data = await bodyJson(request);
    const sourceUrl = plain(data.url);
    let file;
    try { file = await fetchImage(sourceUrl, env); } catch (e) { return fail(e.message, 422); }
    const name = cleanName(new URL(sourceUrl).pathname.split('/').pop()) || 'imported-image';
    return saveImage(context, db, user, String(data.albumId || ''), { ...file, name });
  }
  if (route.startsWith('files/') && method === 'PATCH') {
    const id = decodeURIComponent(route.slice(6));
    const file = await db.prepare('SELECT id,file_name FROM studio_files WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!file) return fail('文件不存在', 404);
    const data = await bodyJson(request);
    const name = cleanName(data.name);
    if (!name) return fail('请输入文件名称');
    const metadataDb = getDatabase(env);
    const record = await metadataDb.getWithMetadata(id);
    if (!record?.metadata) return fail('文件元数据不存在，请联系管理员', 500);
    const metadata = { ...record.metadata, FileName: name };
    await db.prepare('UPDATE studio_files SET file_name=? WHERE id=? AND user_id=?').bind(name, id, user.id).run();
    try { await metadataDb.put(id, record.value ?? '', { metadata }); }
    catch (error) {
      await db.prepare('UPDATE studio_files SET file_name=? WHERE id=? AND user_id=?').bind(file.file_name, id, user.id).run();
      throw error;
    }
    context.waitUntil(addFileToIndex(context, id, metadata));
    return json({ ok: true, name });
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
      db.prepare('SELECT u.id,u.username,u.discord_id,u.discord_name,u.account_type,u.tier,u.disabled,u.stored_bytes,u.month_key,u.month_uploaded_bytes,u.created_at,EXISTS(SELECT 1 FROM studio_super_users su WHERE su.user_id=u.id) AS is_super FROM studio_users u ORDER BY u.created_at DESC LIMIT 500').all(),
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
    if (data.tier && !['pichu', 'pikachu', 'super'].includes(data.tier)) return fail('权限等级无效');
    if (data.tier === 'super') await db.prepare('INSERT OR IGNORE INTO studio_super_users(user_id) VALUES(?)').bind(id).run();
    else if (data.tier) {
      await db.prepare('UPDATE studio_users SET tier=? WHERE id=?').bind(data.tier, id).run();
      await db.prepare('DELETE FROM studio_super_users WHERE user_id=?').bind(id).run();
    }
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
    if (data.decision === 'approved') await db.prepare("UPDATE studio_users SET tier='pikachu' WHERE id=?").bind(application.user_id).run();
    return json({ ok: true });
  }
  return fail('接口不存在', 404);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/studio\/?/, '').replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) return fail('不支持此请求方法', 405);
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
