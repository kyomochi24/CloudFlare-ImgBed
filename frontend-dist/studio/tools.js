const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const fileStem = name => String(name || '图片').replace(/\.[^.]+$/, '').slice(0, 60);
const blobUrl = blob => URL.createObjectURL(blob);

export function initStudioTools({ api, state, refreshProfile, refreshAlbums, notice }) {
  const cutout = { files: [], results: [], quota: null, busy: false };
  const cake = { file: null, url: '', bitmap: null, vertical: [], horizontal: [], slices: [], busy: false };
  const tierBatch = () => state.user?.tier === 'super' ? 8 : state.user?.tier === 'pikachu' ? 4 : 2;
  async function saveBlob(blob, name, albumId) {
    if (blob.size <= 25 * 1048576) {
      const form = new FormData(); form.set('albumId', albumId); form.set('file', blob, name);
      return api('files', { method: 'POST', body: form });
    }
    if (state.user?.tier !== 'super') throw new Error('这张 PNG 超过单张 25 MB 限制，请先缩小图片再保存');
    const started = await api('multipart/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ albumId, name, type: 'image/png', size: blob.size }) });
    try {
      for (let number = 1; number <= started.partCount; number++) {
        const part = blob.slice((number - 1) * started.partSize, Math.min(number * started.partSize, blob.size));
        await api(`multipart/${encodeURIComponent(started.id)}/parts/${number}`, { method: 'PUT', body: part });
      }
      return await api(`multipart/${encodeURIComponent(started.id)}/complete`, { method: 'POST' });
    } catch (error) {
      await api(`multipart/${encodeURIComponent(started.id)}/abort`, { method: 'POST' }).catch(() => {});
      throw error;
    }
  }

  function dropTarget(element, callback) {
    for (const name of ['dragenter', 'dragover']) element.addEventListener(name, event => { event.preventDefault(); element.classList.add('dragging'); });
    for (const name of ['dragleave', 'drop']) element.addEventListener(name, event => { event.preventDefault(); element.classList.remove('dragging'); });
    element.addEventListener('drop', event => callback([...event.dataTransfer.files]));
  }
  function renderQuota() {
    const q = cutout.quota;
    $('cutout-quota').textContent = q ? `今天已抠 ${q.used} / ${q.dailyLimit} 张 · 还可抠 ${q.remaining} 张 · 一次最多 ${q.batchLimit} 张 · 北京时间 00:00 重置` : '正在读取今日次数…';
    $('cutout-select-hint').textContent = `点击或拖入图片 · 一次最多 ${q?.batchLimit || tierBatch()} 张`;
  }
  async function refreshQuota() {
    if (!state.user) return;
    cutout.quota = await api('cutout/quota'); renderQuota();
  }
  function clearCutoutResults() {
    for (const result of cutout.results) { URL.revokeObjectURL(result.originalUrl); URL.revokeObjectURL(result.outputUrl); }
    cutout.results = []; $('cutout-results').replaceChildren();
  }
  function selectCutout(files) {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) return notice('请先选择图片文件', true);
    const max = cutout.quota?.batchLimit || tierBatch();
    if (images.length > max) return notice(`你的身份一次最多选择 ${max} 张`, true);
    if (images.some(file => file.size > 25 * 1048576)) return notice('单张图片请控制在 25 MB 以内', true);
    cutout.files = images;
    $('cutout-picked').innerHTML = images.map(file => `<span>✿ ${safe(file.name)}</span>`).join('');
    $('cutout-run').disabled = false;
    clearCutoutResults();
  }
  $('cutout-input').addEventListener('change', event => { selectCutout([...event.target.files]); event.target.value = ''; });
  dropTarget($('cutout-drop'), selectCutout);
  $('cutout-clear').addEventListener('click', () => { cutout.files = []; $('cutout-picked').replaceChildren(); $('cutout-run').disabled = true; clearCutoutResults(); });
  function renderCutoutResults() {
    const box = $('cutout-results'); box.replaceChildren();
    for (const [index, item] of cutout.results.entries()) {
      const card = document.createElement('article'); card.className = 'tool-result-card';
      card.innerHTML = `<div class="tool-result-title">${safe(item.file.name)}</div><div class="compare-stage checker"><img class="compare-after" alt="透明抠图结果"><img class="compare-before" alt="原图"><span class="compare-label">← 原图　｜　透明结果 →</span></div><label class="compare-control">拖动查看前后对比<input type="range" min="0" max="100" value="50" aria-label="查看第 ${index + 1} 张图片的抠图前后对比"></label><div class="tool-result-actions"><a class="button secondary" download="${safe(fileStem(item.file.name))}-抠图.png">下载透明 PNG ↓</a><button class="button primary save-cutout" type="button">保存到当前相册 ♡</button></div><p class="tool-status" role="status"></p>`;
      card.querySelector('.compare-after').src = item.outputUrl;
      card.querySelector('.compare-before').src = item.originalUrl;
      card.querySelector('a').href = item.outputUrl;
      card.querySelector('input[type=range]').addEventListener('input', event => card.querySelector('.compare-before').style.clipPath = `inset(0 ${100 - Number(event.target.value)}% 0 0)`);
      card.querySelector('.compare-before').style.clipPath = 'inset(0 50% 0 0)';
      card.querySelector('.save-cutout').addEventListener('click', async event => {
        const button = event.currentTarget;
        if (!state.albumId) return notice('请先创建相册', true);
        button.disabled = true; card.querySelector('.tool-status').textContent = '正在保存…';
        try {
          await saveBlob(item.blob, `${fileStem(item.file.name)}-抠图.png`, state.albumId);
          button.textContent = '已保存 ♡'; card.querySelector('.tool-status').textContent = '已放进当前相册';
          await Promise.all([refreshProfile(), refreshAlbums()]);
        } catch (error) { button.disabled = false; card.querySelector('.tool-status').textContent = error.message; }
      });
      box.append(card);
    }
  }
  $('cutout-run').addEventListener('click', async () => {
    if (cutout.busy || !cutout.files.length) return;
    cutout.busy = true; $('cutout-run').disabled = true; clearCutoutResults();
    try {
      const count = cutout.files.length;
      $('cutout-status').textContent = '正在加载抠图模型，首次使用需要一点时间…';
      const { removeBackground, prepareModel } = await import('./cutout-engine.js?v=20260922g');
      await prepareModel();
      cutout.quota = await api('cutout/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) });
      renderQuota();
      for (let i = 0; i < count; i++) {
        const file = cutout.files[i];
        $('cutout-status').textContent = `正在抠第 ${i + 1} / ${count} 张：${file.name}。首次使用需要加载模型，请稍等…`;
        try {
          const blob = await removeBackground(file);
          cutout.results.push({ file, blob, originalUrl: blobUrl(file), outputUrl: blobUrl(blob) });
          renderCutoutResults();
        } catch (error) { notice(`${file.name} 抠图失败：${error.message}`, true); }
      }
      $('cutout-status').textContent = `完成 ${cutout.results.length} / ${count} 张。每日次数按开始处理的张数计算。`;
    } catch (error) { $('cutout-status').textContent = error.message; notice(error.message, true); }
    finally { cutout.busy = false; $('cutout-run').disabled = !cutout.files.length; }
  });

  function clearSlices() {
    for (const slice of cake.slices) URL.revokeObjectURL(slice.url);
    cake.slices = []; $('cake-results').replaceChildren(); $('cake-save').disabled = true;
  }
  function resetCake() {
    clearSlices(); if (cake.url) URL.revokeObjectURL(cake.url); cake.bitmap?.close();
    Object.assign(cake, { file: null, url: '', bitmap: null, vertical: [], horizontal: [] });
    $('cake-stage').classList.add('hidden'); $('cake-edit').classList.add('hidden'); $('cake-name').textContent = '还没有选择图片';
  }
  async function selectCake(files) {
    const file = files[0]; if (!file?.type.startsWith('image/')) return notice('请选择一张图片', true);
    resetCake();
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 20000000) throw new Error('图片像素过大，请使用 2000 万像素以内的图片');
      cake.file = file; cake.bitmap = bitmap; cake.url = blobUrl(file);
      $('cake-photo').src = cake.url; $('cake-name').textContent = `${file.name} · ${bitmap.width} × ${bitmap.height}`;
      $('cake-stage').classList.remove('hidden'); $('cake-edit').classList.remove('hidden');
      renderCakeLines();
    } catch (error) { resetCake(); notice(error.message, true); }
  }
  $('cake-input').addEventListener('change', event => { selectCake([...event.target.files]); event.target.value = ''; });
  dropTarget($('cake-drop'), selectCake);
  $('cake-clear').addEventListener('click', resetCake);
  function addLine(axis, value = null) {
    const list = axis === 'v' ? cake.vertical : cake.horizontal;
    if (list.length >= 20) return notice('每个方向最多 20 条分割线', true);
    if (value === null) {
      const sorted = [0, ...list].sort((a, b) => a - b).concat(1);
      let widest = 0;
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] > sorted[widest + 1] - sorted[widest]) widest = i;
      value = (sorted[widest] + sorted[widest + 1]) / 2;
    }
    list.push(Math.max(.01, Math.min(.99, value))); renderCakeLines(); clearSlices();
  }
  $('cake-add-v').addEventListener('click', () => addLine('v'));
  $('cake-add-h').addEventListener('click', () => addLine('h'));
  $('cake-equal').addEventListener('click', () => {
    const cols = Number($('cake-cols').value), rows = Number($('cake-rows').value);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 20 || rows > 20 || cols * rows > 80) return notice('横向与纵向各最多 20 份，总共最多 80 张', true);
    cake.vertical = Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols);
    cake.horizontal = Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows);
    renderCakeLines(); clearSlices();
  });
  $('cake-remove-lines').addEventListener('click', () => { cake.vertical = []; cake.horizontal = []; renderCakeLines(); clearSlices(); });
  function renderCakeLines() {
    const overlay = $('cake-lines'); overlay.replaceChildren();
    for (const [axis, list] of [['v', cake.vertical], ['h', cake.horizontal]]) for (let i = 0; i < list.length; i++) {
      const line = document.createElement('div'); line.className = `cake-line cake-line-${axis}`; line.dataset.axis = axis;
      line.style[axis === 'v' ? 'left' : 'top'] = `${list[i] * 100}%`;
      line.innerHTML = `<button type="button" class="cake-line-handle" aria-label="拖动${axis === 'v' ? '竖' : '横'}向分割线 ${i + 1}">↔</button><button type="button" class="cake-line-remove" aria-label="删除分割线">×</button>`;
      line.querySelector('.cake-line-remove').addEventListener('click', () => { list.splice(i, 1); renderCakeLines(); clearSlices(); });
      line.querySelector('.cake-line-handle').addEventListener('pointerdown', event => {
        event.preventDefault(); event.target.setPointerCapture(event.pointerId); line.classList.add('moving');
        const move = e => { const rect = overlay.getBoundingClientRect(); const fraction = axis === 'v' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height; list[i] = Math.max(.01, Math.min(.99, fraction)); line.style[axis === 'v' ? 'left' : 'top'] = `${list[i] * 100}%`; clearSlices(); };
        const done = () => { event.target.removeEventListener('pointermove', move); line.classList.remove('moving'); };
        event.target.addEventListener('pointermove', move); event.target.addEventListener('pointerup', done, { once: true }); event.target.addEventListener('pointercancel', done, { once: true });
      });
      overlay.append(line);
    }
    $('cake-line-summary').textContent = `${cake.vertical.length} 条竖线 + ${cake.horizontal.length} 条横线 → ${(cake.vertical.length + 1) * (cake.horizontal.length + 1)} 张切片`;
  }
  function boundaries(lines, pixels) {
    const sorted = [...new Set([0, ...lines.map(x => Math.round(x * pixels)), pixels])].sort((a, b) => a - b);
    return sorted.filter((x, i) => i === 0 || x > sorted[i - 1]);
  }
  function renderSlices() {
    $('cake-results').replaceChildren();
    for (const [index, slice] of cake.slices.entries()) {
      const card = document.createElement('article'); card.className = 'cake-slice';
      card.innerHTML = `<img alt="第 ${index + 1} 张切片"><div><label><input type="checkbox" checked> 保留第 ${index + 1} 张</label><small>${slice.width} × ${slice.height}</small></div><button type="button" class="drawer-button">移除这张</button>`;
      card.querySelector('img').src = slice.url;
      card.querySelector('input').addEventListener('change', event => { slice.keep = event.target.checked; card.classList.toggle('discarded', !slice.keep); });
      card.querySelector('button').addEventListener('click', () => { slice.keep = false; card.classList.add('discarded'); card.querySelector('input').checked = false; });
      $('cake-results').append(card);
    }
    $('cake-save').disabled = !cake.slices.length;
  }
  $('cake-split').addEventListener('click', async () => {
    if (!cake.bitmap || cake.busy) return;
    const xs = boundaries(cake.vertical, cake.bitmap.width), ys = boundaries(cake.horizontal, cake.bitmap.height);
    if ((xs.length - 1) * (ys.length - 1) > 80) return notice('切片超过 80 张，请减少分割线', true);
    clearSlices(); cake.busy = true; $('cake-split').disabled = true;
    try {
      for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
        const width = xs[x + 1] - xs[x], height = ys[y + 1] - ys[y];
        if (!width || !height) continue;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(cake.bitmap, xs[x], ys[y], width, height, 0, 0, width, height);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('生成切片失败')), 'image/png'));
        cake.slices.push({ blob, url: blobUrl(blob), width, height, keep: true, row: y + 1, column: x + 1 });
      }
      renderSlices(); $('cake-status').textContent = `切出 ${cake.slices.length} 张。请勾选需要保留的图片，再保存到分割相册。`;
    } catch (error) { notice(error.message, true); } finally { cake.busy = false; $('cake-split').disabled = false; }
  });
  $('cake-save').addEventListener('click', async () => {
    if (cake.busy) return;
    const chosen = cake.slices.filter(slice => slice.keep && !slice.saved);
    if (!chosen.length) return notice('请勾选还没保存的切片', true);
    cake.busy = true; $('cake-save').disabled = true;
    let saved = 0;
    try {
      let album = state.albums.find(item => item.name === '分割相册');
      if (!album) { album = await api('albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分割相册' }) }); await refreshAlbums(); }
      for (const slice of chosen) {
        $('cake-status').textContent = `正在保存第 ${saved + 1} / ${chosen.length} 张…`;
        try { await saveBlob(slice.blob, `${fileStem(cake.file.name)}-第${slice.row}行第${slice.column}列.png`, album.id); slice.saved = true; saved++; }
        catch (error) { $('cake-status').textContent = `已保存 ${saved} 张；${error.message}`; throw error; }
      }
      await Promise.all([refreshProfile(), refreshAlbums()]);
      $('cake-status').textContent = `已保存 ${saved} 张到「分割相册」♡`;
    } catch (error) { notice(error.message, true); if (saved) await Promise.all([refreshProfile(), refreshAlbums()]); }
    finally { cake.busy = false; $('cake-save').disabled = false; }
  });
  return { refreshQuota };
}
