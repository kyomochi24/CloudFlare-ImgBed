export const VIDEO_LIMIT = 50 * 1048576, DURATION_LIMIT = 300;
export function validateVideo(file) {
  if (!file?.size || file.size > VIDEO_LIMIT) throw Error('请选择 50 MB 以内的视频。');
  if (!/\.(mp4|m4v|mov|webm)$/i.test(file.name)) throw Error('请选择 MP4、MOV、M4V 或 WebM 视频。');
}
export function mp3Name(name) { return (name.replace(/\.[^.]+$/, '').slice(0, 120) || '视频音频') + '.mp3'; }
export function validateDuration(n) {
  if (!Number.isFinite(n) || n <= 0) throw Error('无法读取视频时长。');
  if (n > DURATION_LIMIT) throw Error('第一版支持 5 分钟以内的视频，请先裁剪后再试。');
  return n;
}
function durationOf(file, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video'), url = URL.createObjectURL(file);
    const timer = setTimeout(() => finish(Error('无法读取视频时长，请换一个视频文件。')), 15000);
    function finish(error, duration) {
      clearTimeout(timer); signal.removeEventListener('abort', cancel); video.onloadedmetadata = video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      error ? reject(error) : resolve(duration);
    }
    const cancel = () => finish(new DOMException('已取消', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    video.preload = 'metadata'; video.onloadedmetadata = () => {
      const n = video.duration;
      try { finish(null, validateDuration(n)); } catch (error) { finish(error); }
    };
    video.onerror = () => finish(Error('浏览器无法读取这个视频，请换用 MP4 或 WebM 文件。'));
    if (signal.aborted) cancel(); else video.src = url;
  });
}
export function initVideoMP3({ root, upload, stopOtherAudio = () => {} }) {
  const $ = id => root.querySelector('#video-' + id);
  let selected = null, output = null, outputURL = '', engine = null, aborter = null, revision = 0, saving = false;
  function say(text, error = false) { $('status').textContent = text; $('status').classList.toggle('music-error', error); }
  function progress(n) { $('progress').value = n; }
  function clearOutput() {
    output = null; $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load();
    if (outputURL) URL.revokeObjectURL(outputURL); outputURL = ''; $('result').hidden = true;
  }
  function cancel(announce = true) {
    revision++; aborter?.abort(); aborter = null; engine?.terminate(); engine = null;
    root.removeAttribute('aria-busy'); $('cancel').hidden = true; $('progress').hidden = true;
    $('convert').disabled = !selected; $('input').disabled = saving;
    if (announce) say('已取消转换，可以重新开始。');
  }
  $('input').addEventListener('change', event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || saving) return;
    cancel(false); clearOutput(); selected = null; $('convert').disabled = true;
    try { validateVideo(file); selected = file; $('filename').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`; $('convert').disabled = false; say('准备好了，点击开始转换。'); }
    catch (error) { $('filename').textContent = '选择一个本地视频'; say(error.message, true); }
  });
  $('cancel').addEventListener('click', () => cancel());
  $('audio').addEventListener('play', stopOtherAudio);
  $('convert').addEventListener('click', async () => {
    if (!selected || aborter || saving) return;
    clearOutput(); const file = selected, version = ++revision, controller = new AbortController(); aborter = controller;
    const alive = () => version === revision && !controller.signal.aborted;
    $('convert').disabled = true; $('input').disabled = true; $('cancel').hidden = false; $('progress').hidden = false;
    root.setAttribute('aria-busy', 'true'); progress(0); let converter;
    try {
      validateVideo(file); say('正在读取视频时长…'); await durationOf(file, controller.signal);
      if (!alive()) return;
      say('正在加载转换工具，首次约需下载 31 MB…');
      const { loadEngine } = await import('./video-mp3-engine.js?v=20261106video1');
      if (!alive()) return;
      converter = await loadEngine(controller.signal, n => { if (alive()) progress(n); });
      if (!alive()) { converter.terminate(); return; } engine = converter;
      say('正在提取音频，请保持页面打开…'); progress(0);
      converter.on('progress', ({ progress: p }) => { if (alive() && Number.isFinite(p)) progress(Math.max(0, Math.min(99, Math.round(p * 100)))); });
      const inputName = 'input.' + file.name.split('.').pop().toLowerCase();
      await converter.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      if (!alive()) return;
      const code = await converter.exec(['-i', inputName, '-map', '0:a:0', '-vn', '-t', '300', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', 'output.mp3'], 180000);
      if (!alive()) return;
      if (code !== 0) throw Error('视频可能没有音轨、编码不支持或转换超时，请换一个视频。');
      const bytes = await converter.readFile('output.mp3');
      if (!alive()) return;
      if (!bytes.length || bytes.length > 25 * 1048576) throw Error('输出音频为空或超过 25 MB，无法保存。');
      output = new File([bytes], mp3Name(file.name), { type: 'audio/mpeg' });
      outputURL = URL.createObjectURL(output); $('audio').src = outputURL;
      $('download').href = outputURL; $('download').download = output.name;
      $('output-name').textContent = `${output.name} · ${(output.size / 1048576).toFixed(2)} MB`;
      $('save').disabled = false; $('result').hidden = false; progress(100);
      say('转换完成。可以先试听，再下载或保存到相册。');
    } catch (error) {
      if (alive()) say(/memory/i.test(error?.message || String(error)) ? '设备内存不足，请换一个更小的视频。' : /[\u3400-\u9fff]/.test(error?.message || '') ? error.message : '转换未完成，请重试或换一个更短的视频。', true);
    }
    finally {
      converter?.terminate();
      if (version === revision) { engine = null; aborter = null; $('cancel').hidden = true; $('input').disabled = false; $('convert').disabled = !selected; root.removeAttribute('aria-busy'); }
    }
  });
  $('save').addEventListener('click', async () => {
    if (!output || saving) return;
    saving = true; const version = revision; $('save').disabled = true; $('input').disabled = true; $('convert').disabled = true;
    say('正在保存 MP3 到当前相册…');
    try { const saved = await upload(output); if (version === revision) { if (saved) say('已保存到相册，可在上方复制 BGM 链接。'); else { say('保存未完成，请查看上方提示后重试。', true); $('save').disabled = false; } } }
    catch (error) { if (version === revision) { say(error.message || '保存失败，可以重试或下载到本机。', true); $('save').disabled = false; } }
    finally { saving = false; $('input').disabled = false; $('convert').disabled = !selected; }
  });
  return { reset() { cancel(false); clearOutput(); selected = null; $('filename').textContent = '选择一个本地视频'; $('convert').disabled = true; say('视频在当前设备转换，仅保存时上传 MP3。'); } };
}
