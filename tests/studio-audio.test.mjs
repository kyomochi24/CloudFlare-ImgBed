import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMP3, serveStudioAudio } from '../functions/utils/studioAudio.js';
import { acceptedAudioURL } from '../functions/utils/studioMusic.js';
const bytes = readFileSync(new URL('./fixtures/music-tone.mp3', import.meta.url));
test('MP3 signature accepts encoded audio and rejects a forged ID3 envelope or a truncated frame', () => {
  assert.equal(isMP3(bytes), true);
  assert.equal(isMP3(Buffer.from('ID3\x04\0\0\0\0\0\0<html>not audio</html>')), false);
  assert.equal(isMP3(bytes.slice(0, 32)), false);
  assert.equal(isMP3(Buffer.from('RIFF0000WAVEfake audio data')), false);
});
test('audio origin validation accepts only public HTTPS platform CDN hosts', () => {
  assert.equal(acceptedAudioURL('https://m8.music.126.net/song.mp3').hostname, 'm8.music.126.net');
  for (const url of ['http://m8.music.126.net/a','https://m8.music.126.net.evil.com/a','https://127.0.0.1/a','https://m8.music.126.net:8443/a','https://u:p@m8.music.126.net/a','file:///a']) assert.throws(() => acceptedAudioURL(url));
});
test('R2 audio supports full GET, HEAD, closed, open and suffix byte ranges, ETags and invalid ranges', async () => {
  const calls = [];
  const bucket = { async head() { return { size: bytes.length, httpEtag: '"test-etag"' }; }, async get(key, options) { calls.push(options); const r=options?.range;return { body: r ? bytes.subarray(r.offset,r.offset+r.length) : bytes }; } };
  const call = (method='GET',headers={}) => serveStudioAudio(bucket,'studio/a.mp3',new Request('https://host.test/file/studio/a.mp3',{method,headers}),encodeURIComponent('旋律.mp3'));
  const full = await call(); assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'audio/mpeg');assert.match(full.headers.get('content-disposition'),/^inline;/);assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
  const before=calls.length;const head=await call('HEAD');assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(calls.length,before);
  for (const [range,start,end] of [['bytes=3-12',3,12],['bytes=4-',4,bytes.length-1],['bytes=-11',bytes.length-11,bytes.length-1]]) {
    const r=await call('GET',{Range:range});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(start,end+1));
  }
  assert.equal((await call('GET',{Range:'bytes=999999999-'})).status,416);
  assert.equal((await call('GET',{Range:'bytes=-0'})).status,416);
  assert.equal((await call('GET',{Range:'bytes=9-2'})).status,416);
  assert.equal((await call('GET',{'If-None-Match':'"test-etag"'})).status,304);
  assert.equal((await call('GET',{Range:'bytes=2-4','If-Range':'"old"'})).status,200);
  assert.equal((await call('GET',{Range:'bytes=1-2,4-5'})).status,200);
  assert.equal((await call('POST')).status,405);
});
