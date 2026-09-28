const $ = id => document.getElementById(id);
const FORMATS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
const DIRECT_UPLOAD_LIMIT = 25 * 1024 * 1024;

export function initFontTool({ api, state, refreshProfile, refreshAlbums, refreshFiles, notice }) {
  const selected = { files: [], urls: [], busy: false };
  const status = $('font-status');
  const drop = $('font-drop');
  const input = $('font-input');
  const run = $('font-run');
  const clear = $('font-clear');
  const results = $('font-results');

  function reset() {
    if (selected.busy) return;
    for (const url of selected.urls) URL.revokeObjectURL(url);
    selected.urls = []; selected.files = [];
    results.replaceChildren(); $('font-picked').replaceChildren();
    run.disabled = true; input.value = ''; status.textContent = '请选择需要转换的字体文件。';
  }
  function choose(files) {
    if (selected.busy) return;
    const picked = files.filter(file => FORMATS.has(file.name.split('.').pop()?.toLowerCase()));
    if (picked.length !== files.length || !picked.length) return notice('请选择 TTF、OTF、WOFF 或 WOFF2 字体', true);
    if (picked.some(file => !file.size)) return notice('请选择非空的字体文件', true);
    reset(); selected.files = picked; run.disabled = false;
    for (const file of picked) {
      const item = document.createElement('span'); item.textContent = `✿ ${file.name}`;
      $('font-picked').append(item);
    }
    status.textContent = `已选择 ${picked.length} 份字体，请选择目标格式。`;
  }
  input.addEventListener('change', event => choose([...event.target.files]));
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', event => {
    event.preventDefault(); drop.classList.remove('dragging');
    choose([...(event.dataTransfer?.files || [])]);
  });
  clear.addEventListener('click', reset);

  function resultRow(name) {
    const card = document.createElement('article'); card.className = 'font-result';
    const top = document.createElement('div'); top.className = 'font-result-head';
    const title = document.createElement('strong'); title.textContent = name;
    const detail = document.createElement('p'); detail.textContent = '等待转换…';
    const actions = document.createElement('div'); actions.className = 'font-result-actions';
    top.append(title); card.append(top, detail, actions); results.append(card);
    return { detail, actions };
  }
  async function saveFont(blob, name, albumId, onPart) {
    if (blob.size <= DIRECT_UPLOAD_LIMIT) {
      const form = new FormData(); form.set('albumId', albumId); form.set('file', blob, name);
      return api('files', { method: 'POST', body: form });
    }
    const started = await api('multipart/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId, name, type: blob.type, size: blob.size })
    });
    try {
      for (let number = 1; number <= started.partCount; number++) {
        onPart(number, started.partCount);
        const part = blob.slice((number - 1) * started.partSize, Math.min(number * started.partSize, blob.size));
        await api(`multipart/${encodeURIComponent(started.id)}/parts/${number}`, { method: 'PUT', body: part });
      }
      return await api(`multipart/${encodeURIComponent(started.id)}/complete`, { method: 'POST' });
    } catch (error) {
      await api(`multipart/${encodeURIComponent(started.id)}/abort`, { method: 'POST' }).catch(() => {});
      throw error;
    }
  }
  run.addEventListener('click', async () => {
    if (selected.busy || !selected.files.length) return;
    if (!state.user || !state.albumId) return notice('请先登录并创建相册', true);
    selected.busy = true; run.disabled = true; clear.disabled = true;
    for (const url of selected.urls) URL.revokeObjectURL(url);
    selected.urls = []; results.replaceChildren();
    const target = $('font-format').value;
    const albumId = state.albumId;
    let savedCount = 0; let convertedCount = 0;
    try {
      status.textContent = '正在准备字体转换工具…';
      const { convertFont } = await import('./vendor/font-engine.js?v=20260928-font1');
      for (const [index, file] of selected.files.entries()) {
        const row = resultRow(file.name);
        try {
          status.textContent = `正在转换 ${index + 1} / ${selected.files.length}：${file.name}`;
          const bytes = await convertFont(await file.arrayBuffer(), target);
          if (!bytes.byteLength) throw new Error('转换后的字体为空');
          const name = `${file.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 75)}.${target}`;
          const blob = new Blob([bytes], { type: MIME[target] });
          const objectUrl = URL.createObjectURL(blob); selected.urls.push(objectUrl); convertedCount++;
          const download = document.createElement('a'); download.className = 'button secondary';
          download.href = objectUrl; download.download = name; download.textContent = '下载字体 ↓';
          row.actions.append(download);
          row.detail.textContent = `已转换为 ${target.toUpperCase()} · 正在自动保存…`;
          try {
            const saved = await saveFont(blob, name, albumId, (part, total) => {
              row.detail.textContent = `正在分片保存 ${part} / ${total}…`;
            });
            savedCount++;
            const link = document.createElement('button'); link.className = 'button primary';
            link.type = 'button'; link.textContent = '复制图床链接 ♡';
            link.addEventListener('click', async () => {
              try { await navigator.clipboard.writeText(saved.url); notice('字体链接已复制 ♡'); }
              catch { notice(`复制失败，链接：${saved.url}`, true); }
            });
            row.actions.append(link);
            row.detail.textContent = `已保存到相册 · ${(blob.size / 1048576).toFixed(1)} MB`;
          } catch (error) { row.detail.textContent = `字体已转换，自动保存失败：${error.message}。仍可下载。`; }
        } catch (error) { row.detail.textContent = `转换失败：${error.message}`; }
      }
      status.textContent = `已转换 ${convertedCount} / ${selected.files.length} 份，自动保存 ${savedCount} 份到相册。`;
      if (savedCount) await Promise.all([refreshProfile(), refreshAlbums(), refreshFiles()]);
    } catch (error) { status.textContent = `字体工具加载失败：${error.message}`; notice(error.message, true); }
    finally { selected.busy = false; run.disabled = false; clear.disabled = false; }
  });
}
