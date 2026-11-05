import { AUDIO_LIMIT, isMP3 } from './studioAudio.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
class MusicError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
async function readBounded(response, max, message) {
  if (Number(response.headers.get('Content-Length')) > max) throw new MusicError(message, 413);
  const reader = response.body?.getReader(); const chunks = []; let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new MusicError(message, 413); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function publicHTTPS(value) {
  let u; try { u = new URL(value); } catch { throw new MusicError('音乐服务地址配置无效', 503); }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname) || /^\d/.test(u.hostname)) throw new MusicError('音乐服务必须使用公网 HTTPS 地址', 503);
  return u;
}
export function acceptedAudioURL(value) {
  const u = publicHTTPS(value);
  if (!(u.hostname.endsWith('.music.126.net') || u.hostname === 'music.163.com')) throw new MusicError('音乐平台返回了不支持的音源地址', 502);
  return u;
}
const configured = env => !!(env.MUSIC_API_URL && env.MUSIC_API_TOKEN && env.MUSIC_API_TOKEN.length >= 32);
function track(value, expectedId) {
  if (!value || value.source !== 'netease' || !/^\d{1,20}$/.test(String(value.id)) || (expectedId && String(value.id) !== expectedId)) throw new MusicError('音乐服务返回了无效的歌曲信息', 502);
  return { id: String(value.id), source: 'netease', title: String(value.title || '未命名歌曲').slice(0, 160), artist: String(value.artist || '未知歌手').slice(0, 160), album: String(value.album || '').slice(0, 160) };
}
async function service(env, path, body) {
  if (!configured(env)) throw new MusicError('搜索尚未启用，请站长配置音乐服务；也可以直接上传本地 MP3', 503);
  const url = publicHTTPS(env.MUSIC_API_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`; url.search = ''; url.hash = '';
  const response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MUSIC_API_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const bytes = await readBounded(response, 1024 * 1024, '音乐服务返回内容过大');
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MusicError('音乐服务返回格式错误', 502); }
  if (!response.ok) throw new MusicError(response.status === 401 ? '音乐服务密钥不匹配，请联系站长' : String(data.error || '音乐平台暂时不可用').slice(0, 240), 502);
  return data;
}
async function resolve(env, id) {
  const result = await service(env, 'resolve', { id });
  return { track: track(result.track, id), url: acceptedAudioURL(result.url).href, sizeBytes: Number(result.sizeBytes) || null };
}
async function fetchAudio(value) {
  let url = acceptedAudioURL(value);
  const signal = AbortSignal.timeout(45000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(url.href, { redirect: 'manual', signal, headers: { Accept: 'audio/mpeg,application/octet-stream;q=0.8', Referer: 'https://music.163.com/' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location || redirects === 4) throw new MusicError('音乐平台跳转失败', 502);
      url = acceptedAudioURL(new URL(location, url).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new MusicError('音源已过期或暂时不可用，请重新试听', 502); }
    const bytes = await readBounded(response, AUDIO_LIMIT, '这首歌超过 25 MB，请选择较小的 MP3');
    if (!isMP3(bytes)) throw new MusicError('平台没有返回有效的 MP3，无法保存；可以上传本地 MP3', 422);
    return bytes;
  }
}
export async function handleStudioMusic(context, db, user, route, method, { saveFile, rateLimited }) {
  const { env, request } = context;
  if (route === 'music/status' && method === 'GET') return json({ searchEnabled: configured(env), maxFileBytes: AUDIO_LIMIT, sources: ['netease'] });
  if (!['music/search', 'music/resolve', 'music/save', 'music/upload'].includes(route)) return json({ error: '接口不存在' }, 404);
  if (method !== 'POST') return json({ error: '请使用 POST' }, 405);
  try {
    if (await rateLimited()) throw new MusicError('操作太频繁，请十分钟后再试', 429);
    if (route === 'music/upload') {
      if (Number(request.headers.get('Content-Length')) > AUDIO_LIMIT + 65536) throw new MusicError('MP3 不能超过 25 MB', 413);
      // Bound the multipart envelope as well as the file (including chunked requests).
      const bytes = await readBounded(request, AUDIO_LIMIT + 65536, 'MP3 不能超过 25 MB');
      const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function' || !/\.mp3$/i.test(file.name)) throw new MusicError('请选择 MP3 音频文件');
      if (!file.size || file.size > AUDIO_LIMIT) throw new MusicError('MP3 不能超过 25 MB', 413);
      const audio = new Uint8Array(await file.arrayBuffer());
      if (!isMP3(audio)) throw new MusicError('这个文件不是有效的 MP3，不能只修改扩展名');
      return saveFile(String(form.get('albumId') || ''), { bytes: audio, type: 'audio/mpeg', name: file.name });
    }
    let data;
    try { data = JSON.parse(new TextDecoder().decode(await readBounded(request, 16384, '请求过大'))); }
    catch (error) { if (error instanceof MusicError) throw error; throw new MusicError('请求格式错误'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new MusicError('请求格式错误');
    if (data.source && data.source !== 'netease') throw new MusicError('目前支持网易云音乐');
    if (route === 'music/search') {
      const q = String(data.q || '').trim();
      if (!q || q.length > 120) throw new MusicError('请输入 120 字以内的歌名、歌手或网易云歌曲链接');
      const result = await service(env, 'search', { q });
      if (!Array.isArray(result.tracks)) throw new MusicError('音乐服务返回格式错误', 502);
      return json({ tracks: result.tracks.slice(0, 12).map(value => track(value)) });
    }
    const id = String(data.id || '');
    if (!/^\d{1,20}$/.test(id)) throw new MusicError('歌曲 ID 无效');
    if (route === 'music/resolve') return json(await resolve(env, id));
    const albumId = String(data.albumId || '');
    const album = await db.prepare('SELECT id FROM studio_albums WHERE id=? AND user_id=?').bind(albumId, user.id).first();
    if (!album) throw new MusicError('相册不存在', 404);
    const sourceUrl = `https://music.163.com/song?id=${id}`;
    const previous = await db.prepare('SELECT id,file_name,size_bytes FROM studio_files WHERE user_id=? AND album_id=? AND source_url=? AND mime_type=? LIMIT 1').bind(user.id, albumId, sourceUrl, 'audio/mpeg').first();
    if (previous) return json({ id: previous.id, url: `${new URL(request.url).origin}/file/${previous.id}`, fileName: previous.file_name, sizeBytes: previous.size_bytes, alreadySaved: true });
    const result = await resolve(env, id);
    if (result.sizeBytes > AUDIO_LIMIT) throw new MusicError('这首歌超过 25 MB，请选择较小的 MP3', 413);
    const bytes = await fetchAudio(result.url);
    const name = `${result.track.title} - ${result.track.artist}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 90) + '.mp3';
    return saveFile(albumId, { bytes, type: 'audio/mpeg', name, sourceUrl });
  } catch (error) {
    return json({ error: error instanceof MusicError ? error.message : '音乐服务连接失败，请稍后再试' }, error.status || 502);
  }
}
