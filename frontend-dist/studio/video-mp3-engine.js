// Local conversion. Only the pinned conversion engine is fetched; files stay on-device.
const hosts = ['https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/', 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/'];
const assets = [
  ['ffmpeg-core.js', 'text/javascript', 111804, '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3'],
  ['ffmpeg-core.wasm', 'application/wasm', 32232419, '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7']
];
export async function loadEngine(signal, report) {
  const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
  const engine = new FFmpeg();
  const abort = () => engine.terminate();
  signal.addEventListener('abort', abort, { once: true });
  const urls = [];
  try {
    let blobs;
    for (const host of hosts) {
      try {
        blobs = [];
        let total = 0;
        for (const [name, type, expectedSize, expectedHash] of assets) {
          signal.throwIfAborted();
          const response = await fetch(host + name, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), credentials: 'omit' });
          if (!response.ok || !response.body) throw Error('下载失败');
          const reader = response.body.getReader(), chunks = []; let size = 0;
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > expectedSize) { await reader.cancel(); throw Error('工具资源大小不符'); }
            chunks.push(value); report(Math.min(99, Math.floor((total + size) / 32344223 * 100)));
          }
          if (size !== expectedSize) throw Error('工具资源不完整');
          const blob = new Blob(chunks, { type });
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
          if ([...digest].map(x => x.toString(16).padStart(2, '0')).join('') !== expectedHash) throw Error('工具资源校验失败');
          blobs.push(blob); total += size;
        }
        break;
      } catch (error) { if (signal.aborted) throw error; blobs = null; }
    }
    if (!blobs) throw Error('转换工具下载失败，请检查网络后重试。');
    signal.throwIfAborted();
    urls.push(...blobs.map(blob => URL.createObjectURL(blob)));
    // The single-thread build works without changing the site's isolation headers.
    await engine.load({ coreURL: urls[0], wasmURL: urls[1] }, { signal });
    signal.throwIfAborted(); report(100);
    return engine;
  } catch (error) { engine.terminate(); throw error; }
  finally { signal.removeEventListener('abort', abort); for (const url of urls) URL.revokeObjectURL(url); }
}
