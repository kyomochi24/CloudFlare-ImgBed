export const AUDIO_LIMIT = 25 * 1024 * 1024;

function frame(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) return null;
  const version = (bytes[offset + 1] >> 3) & 3, layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = bytes[offset + 2] >> 4, sampleIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || sampleIndex === 3) return null;
  const rate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrateIndex];
  return { length: Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + ((bytes[offset + 2] >> 1) & 1), version, rate };
}
export function isMP3(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return false;
  let start = 0;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes[3] < 2 || bytes[3] > 4 || bytes.slice(6, 10).some(x => x > 127)) return false;
    start = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9] + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0);
  }
  for (let offset = start; offset < Math.min(start + 4096, bytes.length - 8); offset++) {
    const a = frame(bytes, offset);
    const b = a && frame(bytes, offset + a.length);
    if (b && b.version === a.version && b.rate === a.rate && offset + a.length + b.length <= bytes.length) return true;
  }
  return false;
}

// R2's range getter supplies bounded streams; no whole-file buffering for playback.
export async function serveStudioAudio(bucket, key, request, encodedName, cacheControl = 'public, max-age=3600') {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const head = await bucket.head(key);
  if (!head) return new Response('Audio not found', { status: 404 });
  const size = head.size;
  const etag = head.httpEtag || `"${head.etag}"`;
  const headers = new Headers({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': `inline; filename="${encodedName}"; filename*=UTF-8''${encodedName}`, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', ETag: etag });
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  let offset = 0, length = size, status = 200;
  const range = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (range && (!ifRange || ifRange === etag) && request.method === 'GET') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      const first = Number(match[1]), last = Number(match[2]);
      offset = match[1] ? first : Math.max(0, size - last);
      const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset >= size || end < offset || (!match[1] && last === 0)) {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      length = end - offset + 1; status = 206;
      headers.set('Content-Range', `bytes ${offset}-${end}/${size}`);
    } // Malformed or multi-range headers are ignored, returning the full representation.
  }
  headers.set('Content-Length', String(length));
  if (request.method === 'HEAD') return new Response(null, { headers });
  const object = await bucket.get(key, status === 206 ? { range: { offset, length } } : undefined);
  if (!object?.body) return new Response('Audio not found', { status: 404 });
  return new Response(object.body, { status, headers });
}
