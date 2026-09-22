import { colorRgb, exportTheme, inspectTheme } from './candy-utils.js?v=20260923a';

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const uploadTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const draftDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('studio-candy-drafts', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function drafts(mode, callback) {
  const db = await draftDb();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', mode), request = callback(transaction.objectStore('drafts'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}
const waitImage = blob => createImageBitmap(blob);
const filter = item => `hue-rotate(${item.hue}deg) saturate(${item.sat}%) brightness(${item.light}%)`;
const edited = item => !!item.override || item.hue !== 0 || item.sat !== 100 || item.light !== 100;
const shortName = (name, index) => `${String(name || '糖果色').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 58)}-${index + 1}.png`;

export function initCandy({ api, state, refreshProfile, refreshAlbums, notice }) {
  let project = null, busy = false;
  const selected = new Set();
  const status = message => { $('candy-status').textContent = message; };
  function release() { for (const item of project?.images || []) if (item.overrideUrl) URL.revokeObjectURL(item.overrideUrl); }
  async function refreshQuota() {
    if (!state.user) return;
    const q = await api('candy/quota');
    $('candy-quota').textContent = q.dailyLimit === null ? `今天已生成 ${q.used} 份 · 超级无敌美化大师丘不限量 · 北京时间 00:00 重置` : `今天已生成 ${q.used} / ${q.dailyLimit} 份 · 还可生成 ${q.remaining} 份 · 北京时间 00:00 重置`;
    return q;
  }
  async function refreshDrafts() {
    if (!state.user) return;
    try {
      const all = await drafts('readonly', store => store.getAll());
      const own = all.filter(draft => draft.userId === state.user.id).sort((a, b) => b.updatedAt - a.updatedAt);
      $('candy-drafts').innerHTML = `<option value="">本机保存的草稿（${own.length}）</option>${own.map(d => `<option value="${safe(d.id)}">${safe(d.name)} · ${new Date(d.updatedAt).toLocaleDateString('zh-CN')}</option>`).join('')}`;
    } catch { $('candy-drafts').innerHTML = '<option value="">此浏览器无法保存草稿</option>'; }
  }
  function preview(item) { return item.overrideUrl || item.url; }
  function updateSelection() {
    $('candy-selected-count').textContent = `已选 ${selected.size} 张`;
    $('candy-images').querySelectorAll('[data-image-row]').forEach(row => row.classList.toggle('is-selected', selected.has(Number(row.dataset.imageRow))));
    const first = project?.images[[...selected][0]];
    if (first) for (const [key, slider, output, unit] of [['hue','candy-hue','candy-hue-value','°'],['sat','candy-sat','candy-sat-value','%'],['light','candy-light','candy-light-value','%']]) {
      $(slider).value = first[key]; $(output).textContent = `${first[key]}${unit}`;
    }
  }
  function updatePreview() {
    $('candy-images').querySelectorAll('[data-after]').forEach(img => {
      const item = project.images[Number(img.dataset.after)];
      img.src = item.keep ? item.url : preview(item);
      img.style.filter = item.keep ? 'none' : filter(item);
    });
  }
  function renderImages() {
    $('candy-image-count').textContent = `共 ${project.images.length} 张`;
    $('candy-images').innerHTML = project.images.map((item, i) => `<article class="candy-image-row" data-image-row="${i}"><div class="candy-row-top"><label><input type="checkbox" data-pick="${i}" ${selected.has(i) ? 'checked' : ''}> 第 ${i + 1} 张</label><small id="candy-size-${i}">像素尺寸：加载中…</small><small>色相 ${item.hue}° · 饱和度 ${item.sat}% · 亮度 ${item.light}%</small></div><div class="candy-compare"><div class="candy-side"><strong>改前 · 原图</strong><img loading="lazy" data-before="${i}" src="${safe(item.url)}" alt="第 ${i + 1} 张原图"></div><div class="candy-side"><strong>改后 · 实时预览</strong><img loading="lazy" data-after="${i}" src="${safe(item.keep ? item.url : preview(item))}" style="filter:${item.keep ? 'none' : filter(item)}" alt="第 ${i + 1} 张改色预览"></div></div><div class="candy-row-tools"><button class="drawer-button" type="button" data-edit="${i}">单独调这张</button><button class="drawer-button" type="button" data-reset="${i}">恢复原色</button><button class="drawer-button" type="button" data-download="${i}">下载这张原图 ↓</button><button class="drawer-button" type="button" data-save-original="${i}">原图存入当前相册</button><label class="drawer-button">上传手改图<input data-override="${i}" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" hidden></label><label><input type="checkbox" data-keep="${i}" ${item.keep ? 'checked' : ''}> 保持原图链</label></div><small class="candy-link">${safe(item.url)}</small></article>`).join('') || '<div class="empty">没有找到图片图链，仍可以修改下方颜色。</div>';
    $('candy-images').querySelectorAll('[data-before]').forEach(img => {
      img.onload = () => { const size = $(`candy-size-${img.dataset.before}`); if (size) size.textContent = `像素尺寸：${img.naturalWidth} × ${img.naturalHeight} px`; };
      img.onerror = () => { const size = $(`candy-size-${img.dataset.before}`); if (size) size.textContent = '原站无法预览，可尝试下载或上传手改图'; };
      if (img.complete && img.naturalWidth) img.onload();
    });
    updateSelection();
  }
  function renderColors() {
    $('candy-color-count').textContent = `共 ${project.colors.length} 处`;
    $('candy-colors').innerHTML = project.colors.map((color, i) => `<div class="candy-color-row" data-color-row="${i}"><span>${i + 1}. ${safe(color.label)}</span><span title="原值：${safe(color.original)}"><i class="candy-swatch" style="background:${safe(color.hex)}"></i>原色 RGB(${colorRgb(color.original)})</span><label><input type="color" data-color="${i}" value="${safe(project.changes[i] || color.hex)}" aria-label="修改第 ${i + 1} 处颜色"><code>RGB(${colorRgb(project.changes[i] || color.hex)})</code><button type="button" data-color-reset="${i}">还原</button></label></div>`).join('') || '<div class="hint">没有识别到十六进制或 RGB / RGBA 颜色。</div>';
  }
  function render() {
    $('candy-editor').classList.remove('hidden'); $('candy-title').value = project.name;
    selected.clear(); if (project.images.length) selected.add(0);
    renderImages(); renderColors(); status(`找到 ${project.images.length} 张图、${project.colors.length} 处颜色。预览与草稿仅保存在本机，最终导出时才上传新图片。`);
  }
  async function load(file) {
    if (busy) return notice('请等当前改色任务完成', true);
    if (!file?.name.toLowerCase().endsWith('.json') || file.size > 5 * 1048576) return notice('请选择 5 MB 以内的美化 .json', true);
    try {
      const raw = await file.text(), inspected = inspectTheme(raw);
      release();
      project = { id: crypto.randomUUID(), raw, name: `${inspected.name || file.name.replace(/\.json$/i, '')}-糖果色`, images: inspected.images.map(url => ({ url, hue: 0, sat: 100, light: 100, keep: false, override: null, savedUrl: '' })), colors: inspected.colors, changes: {} };
      render();
    } catch (error) { notice(`美化 JSON 无法读取：${error.message}`, true); }
  }
  $('candy-input').addEventListener('change', event => { load(event.target.files[0]); event.target.value = ''; });
  $('candy-drop').addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.classList.add('dragging'); });
  $('candy-drop').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragging'));
  $('candy-drop').addEventListener('drop', event => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); load(event.dataTransfer.files[0]); });
  $('candy-open-draft').addEventListener('click', async () => {
    const id = $('candy-drafts').value; if (!id) return notice('先选一份本机草稿', true);
    try {
      const saved = await drafts('readonly', store => store.get(id));
      if (!saved || saved.userId !== state.user?.id) throw new Error('没有找到这份草稿');
      release(); project = saved.project;
      project.colors = inspectTheme(project.raw).colors;
      for (const item of project.images) if (item.override) item.overrideUrl = URL.createObjectURL(item.override);
      render(); notice('草稿已经打开 ♡');
    } catch (error) { notice(`打开草稿失败：${error.message}`, true); }
  });
  $('candy-save-draft').addEventListener('click', async () => {
    if (!project) return;
    project.name = $('candy-title').value.trim();
    if (!project.name) return notice('先给新美化起一个名字', true);
    try {
      const copy = { ...project, images: project.images.map(({ overrideUrl, ...image }) => image), colors: undefined };
      await drafts('readwrite', store => store.put({ id: project.id, userId: state.user.id, name: project.name, updatedAt: Date.now(), project: copy }));
      await refreshDrafts(); status('草稿已保存到此浏览器。清除浏览器网站数据会同时删除草稿。');
    } catch (error) { notice(`草稿保存失败：${error.message}`, true); }
  });
  $('candy-images').addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.pick !== undefined) { const n = Number(target.dataset.pick); target.checked ? selected.add(n) : selected.delete(n); updateSelection(); }
    if (target.dataset.keep !== undefined) { const item = project.images[Number(target.dataset.keep)]; item.keep = target.checked; item.savedUrl = ''; updatePreview(); }
    if (target.dataset.override !== undefined) {
      const file = target.files[0], item = project.images[Number(target.dataset.override)];
      if (!file) return;
      if (!uploadTypes.has(file.type) || file.size > 25 * 1048576) return notice('请选择 25 MB 以内的 PNG、JPEG、WebP、GIF、AVIF 或 BMP 图片', true);
      if (item.overrideUrl) URL.revokeObjectURL(item.overrideUrl);
      item.override = file; item.overrideUrl = URL.createObjectURL(file); item.keep = false; item.savedUrl = '';
      renderImages(); status(`第 ${Number(target.dataset.override) + 1} 张已换成你上传的手改图。`);
    }
  });
  $('candy-images').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || !project) return;
    if (button.dataset.edit !== undefined) { selected.clear(); selected.add(Number(button.dataset.edit)); renderImages(); $('candy-hue').focus(); }
    if (button.dataset.reset !== undefined) {
      const item = project.images[Number(button.dataset.reset)];
      if (item.overrideUrl) URL.revokeObjectURL(item.overrideUrl);
      Object.assign(item, { hue: 0, sat: 100, light: 100, override: null, overrideUrl: '', keep: false, savedUrl: '' }); renderImages();
    }
    if (button.dataset.download !== undefined) try { await downloadOriginal(Number(button.dataset.download)); } catch (error) { notice(error.message, true); }
    if (button.dataset.saveOriginal !== undefined) {
      if (!state.albumId) return notice('请先创建一个相册', true);
      button.disabled = true;
      try {
        const i = Number(button.dataset.saveOriginal), blob = await sourceBlob(project.images[i].url), form = new FormData();
        form.set('albumId', state.albumId); form.set('file', blob, shortName(`${project.name}-原图`, i));
        await api('files', { method: 'POST', body: form });
        await Promise.all([refreshProfile(), refreshAlbums()]); notice('原图已放进当前相册 ♡');
      } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
    }
  });
  $('candy-select-all').addEventListener('click', () => { project?.images.forEach((_, i) => selected.add(i)); renderImages(); });
  $('candy-select-none').addEventListener('click', () => { selected.clear(); renderImages(); });
  $('candy-reset-selected').addEventListener('click', () => { for (const n of selected) { const item = project.images[n]; if (item.overrideUrl) URL.revokeObjectURL(item.overrideUrl); Object.assign(item, { hue: 0, sat: 100, light: 100, override: null, overrideUrl: '', keep: false, savedUrl: '' }); } renderImages(); });
  for (const [key, slider, output, unit] of [['hue','candy-hue','candy-hue-value','°'],['sat','candy-sat','candy-sat-value','%'],['light','candy-light','candy-light-value','%']]) {
    $(slider).addEventListener('input', event => {
      $(output).textContent = `${event.target.value}${unit}`;
      if (!project || !selected.size) return status('先选中一张或多张图片再调色。');
      for (const n of selected) { const item = project.images[n]; item[key] = Number(event.target.value); item.savedUrl = ''; item.keep = false; }
      updatePreview();
      $('candy-images').querySelectorAll('[data-image-row]').forEach(row => {
        const n = Number(row.dataset.imageRow);
        if (selected.has(n)) row.querySelector('.candy-row-top small:last-child').textContent = `色相 ${project.images[n].hue}° · 饱和度 ${project.images[n].sat}% · 亮度 ${project.images[n].light}%`;
      });
    });
  }
  $('candy-colors').addEventListener('input', event => {
    const input = event.target.closest('[data-color]'); if (!input || !project) return;
    const n = Number(input.dataset.color), row = input.closest('.candy-color-row');
    project.changes[n] = input.value; row.querySelector('code').textContent = `RGB(${colorRgb(input.value)})`;
  });
  $('candy-colors').addEventListener('click', event => {
    const button = event.target.closest('[data-color-reset]'); if (!button || !project) return;
    const n = Number(button.dataset.colorReset), row = button.closest('.candy-color-row');
    delete project.changes[n]; row.querySelector('input[type=color]').value = project.colors[n].hex;
    row.querySelector('code').textContent = `RGB(${colorRgb(project.colors[n].hex)})`;
  });
  async function sourceBlob(url) {
    const source = new URL(url);
    const response = source.origin === location.origin
      ? await fetch(source.href, { credentials: 'same-origin' })
      : await fetch('/api/studio/candy/source', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `图片读取失败 (${response.status})，可下载后手动上传替换`); }
    const blob = await response.blob(); if (!uploadTypes.has(blob.type) || blob.size > 25 * 1048576) throw new Error('原图不是受支持的 25 MB 以内图片');
    return blob;
  }
  async function downloadOriginal(index) {
    const item = project.images[index], blob = await sourceBlob(item.url), objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `${String(project.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}-原图-${index + 1}.${blob.type.split('/')[1].replace('jpeg', 'jpg')}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  $('candy-download-all').addEventListener('click', async event => {
    if (!project || busy) return; busy = true; event.currentTarget.disabled = true;
    try { for (let i = 0; i < project.images.length; i++) { status(`正在下载第 ${i + 1} / ${project.images.length} 张原图…`); await downloadOriginal(i); } status('原图已逐张下载；如果浏览器拦截多文件下载，请允许本站下载多个文件。'); }
    catch (error) { notice(error.message, true); } finally { busy = false; event.currentTarget.disabled = false; }
  });
  async function recolored(item) {
    const blob = item.override || await sourceBlob(item.url), bitmap = await waitImage(blob);
    try {
      if (bitmap.width * bitmap.height > 20_000_000) throw new Error('单张图片超过 2000 万像素，请先缩小原图');
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建画布');
      if (typeof ctx.filter !== 'string' && (item.hue !== 0 || item.sat !== 100 || item.light !== 100)) throw new Error('此浏览器不支持画布调色，请换用新版浏览器');
      ctx.filter = filter(item); ctx.drawImage(bitmap, 0, 0);
      const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      canvas.width = 0; canvas.height = 0;
      if (!output || output.size > 25 * 1048576) throw new Error('生成的 PNG 超过单张 25 MB，请缩小图片');
      return output;
    } finally { bitmap.close(); }
  }
  $('candy-export').addEventListener('click', async event => {
    if (!project || busy) return;
    const title = $('candy-title').value.trim(); if (!title) return notice('请先填写新美化名称', true);
    const modified = project.images.map((item, i) => ({ item, i })).filter(({ item }) => !item.keep && edited(item));
    const changes = new Map(Object.entries(project.changes).map(([index, hex]) => [Number(index), hex]));
    if (!modified.length && !changes.size) return notice('请至少修改一张图片或一处颜色', true);
    busy = true; event.currentTarget.disabled = true;
    try {
      await refreshQuota();
      project.name = title;
      await api('candy/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) });
      await refreshQuota();
      const replacements = new Map();
      if (modified.length) {
        if (modified.some(({ item }) => !item.savedUrl) && !project.albumId) { const album = await api('albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: title.slice(0, 80) }) }); project.albumId = album.id; }
        for (const { item, i } of modified) {
          if (!item.savedUrl) {
            status(`正在处理并保存第 ${i + 1} / ${project.images.length} 张图片…`);
            const blob = await recolored(item), form = new FormData();
            form.set('albumId', project.albumId); form.set('file', blob, shortName(title, i));
            const saved = await api('files', { method: 'POST', body: form }); item.savedUrl = saved.url;
          }
          replacements.set(item.url, item.savedUrl);
        }
        await Promise.all([refreshProfile(), refreshAlbums()]);
      }
      const output = exportTheme(project.raw, title, replacements, changes);
      const objectUrl = URL.createObjectURL(new Blob([output], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100)}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      project.id = crypto.randomUUID(); project.albumId = '';
      status(`完成！新美化「${title}」已下载。修改后的图片保存在刚创建的相册，原图和原美化均未改动。`);
    } catch (error) { status(`暂停：${error.message}。已完成的图片仍在相册里，可保存草稿后重试。`); notice(error.message, true); }
    finally { busy = false; event.currentTarget.disabled = false; }
  });
  return { refreshQuota, refreshDrafts };
}
