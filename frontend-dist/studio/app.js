import { imageLinks, replaceLinks, renameTheme } from './theme-utils.js?v=20260922d';
import { initStudioTools } from './tools.js?v=20260922i';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { user: null, albums: [], albumId: '', files: [], hasMore: false, selectedFiles: new Set(), uploading: false, importing: false, rawJson: '', jsonName: '', themeTitle: '', importAlbumId: '', links: [], replacements: new Map(), application: null };
  const fmt = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const progress = document.createElement('div');
  progress.id = 'upload-progress';
  progress.className = 'upload-progress hidden';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '上传进度');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', '0');
  progress.innerHTML = '<div class="upload-progress-track"><i id="upload-progress-fill"></i></div><span id="upload-progress-label">0%</span>';
  $('upload-status').after(progress);
  const outputNameLabel = document.createElement('label');
  outputNameLabel.className = 'output-name-field';
  outputNameLabel.innerHTML = '搬家后的美化名称<input id="json-output-name" type="text" maxlength="100" placeholder="例如：像素甜点屋" disabled>';
  $('json-file-name').after(outputNameLabel);
  function notice(message, error = false) { const el = $('notice'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden'); clearTimeout(notice.timer); notice.timer = setTimeout(() => el.classList.add('hidden'), 6500); }
  async function api(path, options = {}) {
    const response = await fetch(`/api/studio/${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  }
  const jsonOptions = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  function applicationFeedback(message, error = false) { const el = $('application-feedback'); el.textContent = message; el.classList.toggle('error', error); }
  function renderSelection() {
    const count = state.selectedFiles.size;
    $('selection-count').textContent = `已选择 ${count} 张`;
    $('select-all-files').disabled = state.files.length === 0 || count === state.files.length;
    $('clear-selected-files').disabled = count === 0;
    $('copy-selected-files').disabled = count === 0;
    $('move-selected-files').disabled = count === 0 || !$('move-target').value;
    $('delete-selected-files').disabled = count === 0;
    const order = [...state.selectedFiles];
    $('file-grid').querySelectorAll('[data-select]').forEach(button => {
      const number = order.indexOf(button.dataset.select) + 1;
      button.closest('.file-card').classList.toggle('selected', number > 0);
      button.setAttribute('aria-pressed', number > 0 ? 'true' : 'false');
      button.querySelector('.selection-badge').textContent = number || '';
    });
  }
  function showMember() { $('guest').classList.toggle('hidden', !!state.user); $('member').classList.toggle('hidden', !state.user); $('logout').classList.toggle('hidden', !state.user); }
  function renderProfile() {
    const u = state.user;
    $('display-name').textContent = u.discordName || u.username || '甜品屋客人';
    const superUser = u.tier === 'super';
    const creator = u.tier === 'pikachu';
    const limit = creator ? u.creatorMonthLimit : u.baseLimit;
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const used = creator && u.monthKey === month ? u.monthUploadedBytes : creator ? 0 : u.storedBytes;
    $('tier-description').textContent = superUser ? '超级无敌美化大师丘 ✦ 站长专属授权，可上传任意类型文件，站内不设额度。' : creator ? '皮卡丘 ♡ 每月可上传 1 GB，旧图永久保留。' : '皮丘 ✿ 总共可保存 200 MB，图片永久保留。';
    $('quota-label').textContent = superUser ? '已保存文件' : creator ? '本月上传额度' : '当前存储额度';
    $('quota-value').textContent = superUser ? fmt(u.storedBytes) : `${fmt(used)} / ${fmt(limit)}`;
    $('quota-bar').style.width = superUser ? '100%' : `${Math.min(100, 100 * used / limit)}%`;
    $('quota-detail').textContent = superUser ? '站内没有上传次数、类型或总容量限制；单次传输仍受 Cloudflare 平台限制。' : creator ? `剩余 ${fmt(Math.max(0, limit - used))} · 已保存 ${fmt(u.storedBytes)}，旧图不计入本月额度` : `剩余 ${fmt(Math.max(0, limit - used))} · 删除图片可释放空间`;
    $('upload-input').accept = superUser ? '' : 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp';
    $('upload-label-text').textContent = superUser ? '＋ 上传文件' : '＋ 上传原图';
    const pending = state.application?.status === 'pending';
    $('application-form').classList.toggle('hidden', creator || superUser);
    $('application-form').querySelector('button[type=submit]').disabled = pending;
    if (pending) applicationFeedback('已提交');
    $('application-state').textContent = superUser ? '✦ 你已经是超级无敌美化大师丘啦！' : creator ? '♡ 你已经是皮卡丘啦！' : state.application?.status === 'pending' ? `✉「${state.application.work_title}」正在等待管理员审核。` : state.application?.status === 'rejected' ? '上次申请未通过，你可以修改信息后重新提交。' : '';
    if (u.discordId) $('application-form').elements.discordId.value = u.discordId;
  }
  function renderAlbums() {
    $('album-list').innerHTML = state.albums.map(a => `<button class="album-item ${a.id === state.albumId ? 'active' : ''}" data-id="${escapeHtml(a.id)}">✿ ${escapeHtml(a.name)} <small>${a.file_count}</small></button>`).join('');
    $('current-album-name').textContent = state.albums.find(a => a.id === state.albumId)?.name || '我的相册';
    const target = $('move-target');
    const previous = target.value;
    const others = state.albums.filter(a => a.id !== state.albumId);
    target.innerHTML = `<option value="">${others.length ? '移到哪个相册？' : '先新建另一个相册'}</option>${others.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}`;
    target.value = others.some(a => a.id === previous) ? previous : '';
    target.disabled = others.length === 0;
    renderSelection();
  }
  function renderFiles() {
    const previewTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
    $('file-grid').innerHTML = state.files.length ? state.files.map(f => `<div class="file-card"><button class="file-image-select ${f.mime_type === 'image/png' ? 'checker' : ''}" type="button" data-select="${escapeHtml(f.id)}" aria-label="选择文件：${escapeHtml(f.file_name)}">${previewTypes.has(f.mime_type) ? `<img loading="lazy" src="${escapeHtml(f.url)}" alt="">` : '<span class="file-placeholder" aria-hidden="true">✦<small>文件</small></span>'}${f.file_name.endsWith('-抠图.png') ? '<span class="cutout-card-badge" aria-hidden="true">透明 PNG</span>' : ''}<span class="selection-badge" aria-hidden="true"></span></button><strong title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</strong><div class="file-actions"><button type="button" data-copy="${escapeHtml(f.url)}">复制图链</button><button type="button" data-rename="${escapeHtml(f.id)}">重命名</button><button type="button" data-delete="${escapeHtml(f.id)}">删除</button></div></div>`).join('') : '<div class="empty">相册里还空空的。上传第一张图片吧 ♡</div>';
    $('more-files').classList.toggle('hidden', !state.hasMore);
    renderSelection();
  }
  async function refreshProfile() { const data = await api('me'); state.user = data.user; state.application = data.application; renderProfile(); showMember(); }
  const studioTools = initStudioTools({ api, state, refreshProfile, refreshAlbums, notice });
  async function refreshAlbums() {
    const data = await api('albums'); state.albums = data.albums;
    if (!state.albums.some(a => a.id === state.albumId)) state.albumId = state.albums[0]?.id || '';
    renderAlbums(); await refreshFiles();
  }
  async function refreshFiles(more = false) { if (!more) state.selectedFiles.clear(); if (!state.albumId) { state.files = []; state.hasMore = false; renderFiles(); return; } const offset = more ? state.files.length : 0; const data = await api(`files?album=${encodeURIComponent(state.albumId)}&offset=${offset}`); state.files = more ? [...state.files, ...data.files] : data.files; state.hasMore = data.hasMore; renderFiles(); }
  async function loadAnnouncement() {
    const { announcement } = await api('announcement');
    const news = announcement || {};
    $('announcement-open').classList.toggle('has-news', !!news.enabled);
    $('announcement-title').textContent = news.enabled ? news.title || '甜品屋公告' : '暂时没有公告 ✿';
    const content = $('announcement-content'); content.replaceChildren();
    if (news.enabled && Array.isArray(news.contentRuns) && news.contentRuns.length) {
      for (const run of news.contentRuns) {
        const span = document.createElement('span'); span.textContent = run.text;
        if (run.color) span.style.color = run.color;
        if (run.backgroundColor) span.style.backgroundColor = run.backgroundColor;
        if (run.fontSize) span.style.fontSize = `${run.fontSize}px`;
        content.append(span);
      }
    } else content.textContent = news.enabled ? news.content || '来甜品屋玩吧 ♡' : '站长还没有发布新公告。';
    $('announcement-dialog').style.backgroundColor = news.backgroundColor || '#fff8f2';
    $('announcement-dialog').style.color = news.textColor || '#604c56';
    const gallery = $('announcement-images');
    gallery.replaceChildren();
    for (const url of news.enabled ? news.imageUrls || [] : []) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '公告图片';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      gallery.append(image);
    }
    if (news.enabled) {
      const key = `studio_announcement_seen_${news.updatedAt || 'initial'}`;
      let seen = false;
      try { seen = localStorage.getItem(key) === '1'; } catch { /* Storage may be blocked. */ }
      if (!seen && !$('announcement-dialog').open) $('announcement-dialog').showModal();
      $('announcement-dialog').addEventListener('close', () => { try { localStorage.setItem(key, '1'); } catch { /* Private mode. */ } }, { once: true });
    }
  }
  async function start() {
    try { await loadAnnouncement(); } catch { /* The rest of the site remains usable if news is unavailable. */ }
    try { const c = await api('config'); $('discord-login').classList.toggle('disabled', !c.discordEnabled); $('discord-login').href = c.discordEnabled ? '/api/studio/oauth/start' : '#'; $('discord-hint').textContent = c.discordEnabled ? '请先加入管理员指定的 Discord 社区。' : '站长尚未填写 Discord 应用和社区 ID；可使用管理员发放的账号。'; } catch (e) { $('discord-hint').textContent = e.message; }
    const error = new URLSearchParams(location.search).get('error'); if (error === 'not_member') { notice('这个 Discord 账号尚未加入指定社区，暂时不能登录。', true); history.replaceState(null, '', '/studio/'); }
    try { await refreshProfile(); await refreshAlbums(); } catch { state.user = null; showMember(); }
    if (state.user) try { await studioTools.refreshQuota(); } catch (error) { $('cutout-quota').textContent = error.message; }
  }
  $('local-login').addEventListener('submit', async event => { event.preventDefault(); const formElement = event.currentTarget; const b = formElement.querySelector('button'); b.disabled = true; try { const form = new FormData(formElement); const data = await api('login', jsonOptions({ username: form.get('username'), password: form.get('password') })); state.user = data.user; await refreshProfile(); await refreshAlbums(); await studioTools.refreshQuota(); formElement.reset(); notice('欢迎回家 ♡'); } catch (e) { notice(e.message, true); } finally { b.disabled = false; } });
  $('logout').addEventListener('click', async () => { try { await api('logout', { method: 'POST' }); state.user = null; showMember(); notice('下次再来玩呀 ♡'); } catch (e) { notice(e.message, true); } });
  $('new-album').addEventListener('click', () => $('album-dialog').showModal());
  $('announcement-open').addEventListener('click', () => $('announcement-dialog').showModal());
  $('announcement-close').addEventListener('click', () => $('announcement-dialog').close());
  $('announcement-done').addEventListener('click', () => $('announcement-dialog').close());
  $('album-form').addEventListener('submit', async event => { if (event.submitter?.value !== 'create') return; event.preventDefault(); try { const data = await api('albums', jsonOptions({ name: $('album-name').value })); $('album-dialog').close(); $('album-name').value = ''; state.albumId = data.id; await refreshAlbums(); notice('新相册已经摆好啦 ✿'); } catch (e) { notice(e.message, true); } });
  $('album-list').addEventListener('click', async event => { const button = event.target.closest('[data-id]'); if (!button) return; state.albumId = button.dataset.id; renderAlbums(); await refreshFiles(); });
  $('more-files').addEventListener('click', async () => { try { await refreshFiles(true); } catch (e) { notice(e.message, true); } });
  function uploadRequest(path, method, body, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, `/api/studio/${path}`);
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', event => { if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total); });
      xhr.addEventListener('error', () => reject(new Error('网络中断，请重试')));
      xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
      xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* A proxy may return plain text. */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `上传失败 (${xhr.status})`));
      });
      xhr.send(body);
    });
  }
  function showUploadProgress(bytes, total, fileName, finished = false) {
    const percent = finished ? 100 : Math.min(99, Math.floor(100 * bytes / total));
    progress.classList.remove('hidden');
    progress.setAttribute('aria-valuenow', String(percent));
    $('upload-progress-fill').style.width = `${percent}%`;
    $('upload-progress-label').textContent = finished ? '100% · 上传完成' : `${percent}% · ${fileName}`;
  }
  async function uploadSuperFile(file, position, total, onProgress) {
    const started = await api('multipart/start', jsonOptions({ albumId: state.albumId, name: file.name, type: file.type || 'application/octet-stream', size: file.size }));
    try {
      for (let number = 1; number <= started.partCount; number++) {
        const start = (number - 1) * started.partSize;
        const piece = file.slice(start, Math.min(file.size, start + started.partSize));
        $('upload-status').textContent = `正在上传 ${position} / ${total}：${file.name}（分片 ${number} / ${started.partCount}）`;
        await uploadRequest(`multipart/${encodeURIComponent(started.id)}/parts/${number}`, 'PUT', piece, ratio => onProgress(start + piece.size * ratio));
        onProgress(start + piece.size);
      }
      $('upload-status').textContent = `正在保存 ${position} / ${total}：${file.name}`;
      await api(`multipart/${encodeURIComponent(started.id)}/complete`, { method: 'POST' });
      onProgress(file.size);
    } catch (error) {
      await api(`multipart/${encodeURIComponent(started.id)}/abort`, { method: 'POST' }).catch(() => {});
      throw error;
    }
  }
  async function uploadFiles(files) {
    if (!files.length || state.uploading) return;
    if (!state.albumId) { $('upload-status').textContent = '请先创建相册'; return; }
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
    const superUser = state.user?.tier === 'super';
    const failures = [];
    const eligible = files.filter(file => {
      let reason = '';
      if (!file.size) reason = '不能上传空文件';
      else if (!superUser && !allowed.has(file.type)) reason = '不是支持的图片格式';
      else if (!superUser && file.size > 25 * 1048576) reason = '单张图片不能超过 25 MB';
      if (reason) failures.push(`${file.name}：${reason}`);
      return !reason;
    });
    if (!eligible.length) { $('upload-status').textContent = failures[0]; return; }
    const totalBytes = eligible.reduce((sum, file) => sum + file.size, 0);
    state.uploading = true;
    let success = 0;
    let completedBytes = 0;
    showUploadProgress(0, totalBytes, eligible[0].name);
    try {
      for (let i = 0; i < eligible.length; i++) {
        const file = eligible[i];
        $('upload-status').textContent = `正在上传 ${i + 1} / ${eligible.length}：${file.name}`;
        const onProgress = uploadedBytes => showUploadProgress(completedBytes + uploadedBytes, totalBytes, file.name);
        try {
          if (superUser) await uploadSuperFile(file, i + 1, eligible.length, onProgress);
          else { const form = new FormData(); form.set('file', file); form.set('albumId', state.albumId); await uploadRequest('files', 'POST', form, ratio => onProgress(file.size * ratio)); }
          success++;
        }
        catch (e) { failures.push(`${file.name}：${e.message}`); }
        completedBytes += file.size;
        showUploadProgress(completedBytes, totalBytes, file.name);
      }
      await Promise.all([refreshProfile(), refreshAlbums()]);
      $('upload-status').textContent = `已上传 ${success} / ${files.length} 个文件${failures.length ? `；${failures[0]}${failures.length > 1 ? `，另有 ${failures.length - 1} 个失败` : ''}` : ' ♡'}`;
      if (success) showUploadProgress(totalBytes, totalBytes, '', true);
      else { $('upload-progress-label').textContent = '上传失败'; progress.setAttribute('aria-valuenow', '0'); $('upload-progress-fill').style.width = '0%'; }
    } catch (e) { $('upload-status').textContent = `上传后刷新失败：${e.message}`; }
    finally { state.uploading = false; }
  }
  $('upload-input').addEventListener('change', event => { uploadFiles([...event.target.files]); event.target.value = ''; });
  $('select-all-files').addEventListener('click', () => { state.files.forEach(file => state.selectedFiles.add(file.id)); renderSelection(); });
  $('clear-selected-files').addEventListener('click', () => { state.selectedFiles.clear(); renderSelection(); });
  $('copy-selected-files').addEventListener('click', async () => { const byId = new Map(state.files.map(file => [file.id, file.url])); const links = [...state.selectedFiles].map(id => byId.get(id)).filter(Boolean); if (!links.length) return; try { await navigator.clipboard.writeText(links.join('\n')); notice(`已复制 ${links.length} 条图链，每行一条 ✿`); } catch { notice('复制失败，请检查浏览器的剪贴板权限', true); } });
  $('move-target').addEventListener('change', renderSelection);
  $('move-selected-files').addEventListener('click', async () => {
    const ids = [...state.selectedFiles];
    const albumId = $('move-target').value;
    if (!ids.length || !albumId) return;
    const target = state.albums.find(album => album.id === albumId);
    const button = $('move-selected-files');
    button.disabled = true;
    try {
      for (let start = 0; start < ids.length; start += 100) await api('files/move', jsonOptions({ ids: ids.slice(start, start + 100), albumId }));
      await refreshAlbums();
      notice(`已把 ${ids.length} 个文件移到「${target.name}」；图链没有改变 ✿`);
    } catch (e) { notice(e.message, true); }
    finally { renderSelection(); }
  });
  $('delete-selected-files').addEventListener('click', async () => {
    const ids = [...state.selectedFiles];
    if (!ids.length || !confirm(`确定删除选中的 ${ids.length} 个文件吗？删除后图链会失效，无法恢复。`)) return;
    const button = $('delete-selected-files');
    button.disabled = true;
    let deleted = 0;
    const failures = [];
    for (const id of ids) {
      $('upload-status').textContent = `正在删除 ${deleted + failures.length + 1} / ${ids.length} 个文件…`;
      try { await api(`files/${encodeURIComponent(id)}`, { method: 'DELETE' }); deleted++; }
      catch (e) { failures.push(e.message); }
    }
    try { await Promise.all([refreshProfile(), refreshAlbums()]); }
    catch (e) { failures.push(`刷新失败：${e.message}`); }
    $('upload-status').textContent = `已删除 ${deleted} / ${ids.length} 个文件${failures.length ? `；${failures[0]}` : ' ♡'}`;
    renderSelection();
  });
  $('file-grid').addEventListener('click', async event => {
    const select = event.target.closest('[data-select]');
    if (select) {
      if (state.selectedFiles.has(select.dataset.select)) state.selectedFiles.delete(select.dataset.select);
      else state.selectedFiles.add(select.dataset.select);
      renderSelection();
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); notice('图链已复制到剪贴板 ✿'); }
      catch { notice('复制失败，请检查浏览器的剪贴板权限', true); }
      return;
    }
    const rename = event.target.closest('[data-rename]');
    if (rename) {
      const file = state.files.find(item => item.id === rename.dataset.rename);
      if (!file) return;
      $('rename-dialog').dataset.fileId = file.id;
      $('rename-name').value = file.file_name;
      $('rename-dialog').showModal();
      $('rename-name').focus();
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (!del || !confirm('确定删除这张图片吗？删除后原图链会失效。')) return;
    try { await api(`files/${encodeURIComponent(del.dataset.delete)}`, { method: 'DELETE' }); await Promise.all([refreshProfile(), refreshAlbums()]); notice('图片已删除'); }
    catch (e) { notice(e.message, true); }
  });
  $('close-rename').addEventListener('click', () => $('rename-dialog').close());
  $('rename-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('rename-dialog').dataset.fileId;
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const renamed = await api(`files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('rename-name').value }) });
      const file = state.files.find(item => item.id === id);
      if (file) file.file_name = renamed.name;
      renderFiles();
      $('rename-dialog').close();
      notice('文件名称已保存，图链没有改变 ✿');
    } catch (e) { notice(e.message, true); }
    finally { button.disabled = false; }
  });
  $('application-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const values = Object.fromEntries(new FormData(formEl));
    values.discordId = String(values.discordId || '').trim();
    values.workTitle = String(values.workTitle || '').trim();
    values.workUrl = String(values.workUrl || '').trim();
    if (!/^\d+$/.test(values.discordId)) { applicationFeedback('请填写数字 Discord ID，位数不限。', true); formEl.elements.discordId.focus(); return; }
    if (!values.workTitle) { applicationFeedback('请填写作品名称。', true); formEl.elements.workTitle.focus(); return; }
    const button = formEl.querySelector('button[type=submit]');
    button.disabled = true;
    applicationFeedback('正在提交申请信…');
    let submitted = false;
    try { await api('applications', jsonOptions(values)); submitted = true; applicationFeedback('已提交'); try { await refreshProfile(); } catch { /* Keep the local success state if refreshing fails. */ } }
    catch (e) { applicationFeedback(e.message, true); }
    finally { if (!submitted) button.disabled = false; }
  });
  async function loadJson(file) {
    if (state.importing) return notice('请等当前图片搬运完成后再选择文件', true);
    if (!file || !file.name.toLowerCase().endsWith('.json')) return notice('请选择 .json 美化文件', true);
    if (file.size > 5 * 1048576) return notice('JSON 文件不能超过 5 MB', true);
    try { const raw = await file.text(); state.links = imageLinks(raw); const theme = JSON.parse(raw); if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error('Invalid theme'); state.rawJson = raw; state.jsonName = file.name; state.themeTitle = (typeof theme.name === 'string' ? theme.name.trim() : '') || file.name.replace(/\.json$/i, ''); state.importAlbumId = ''; state.replacements.clear(); $('json-file-name').textContent = file.name; $('json-output-name').value = `${state.themeTitle}-已搬家`; $('json-output-name').disabled = false; $('theme-results').classList.remove('hidden'); $('theme-count').textContent = `发现 ${state.links.length} 条不同的图片链接`;
      $('theme-links').innerHTML = state.links.map((url, i) => `<div class="link-row" id="link-${i}">${escapeHtml(url)}</div>`).join('') || '<div class="hint">没有识别到带图片扩展名的链接。</div>';
      $('theme-progress').textContent = '图片不会被压缩。搬运前请确认你有权保存这些图片。'; $('import-all').disabled = state.links.length === 0; $('download-json').disabled = true; $('clear-json').disabled = false;
    } catch { notice('JSON 文件格式不正确，无法解析', true); }
  }
  $('json-input').addEventListener('change', event => { loadJson(event.target.files[0]); event.target.value = ''; });
  $('clear-json').addEventListener('click', () => { if (state.importing) return; state.links = []; state.rawJson = ''; state.jsonName = ''; state.themeTitle = ''; state.importAlbumId = ''; state.replacements.clear(); $('json-input').value = ''; $('json-file-name').textContent = '还没有选择文件'; $('json-output-name').value = ''; $('json-output-name').disabled = true; $('theme-results').classList.add('hidden'); $('theme-links').replaceChildren(); $('theme-count').textContent = ''; $('theme-progress').textContent = ''; $('import-all').disabled = true; $('download-json').disabled = true; $('clear-json').disabled = true; });
  $('json-drop').addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.style.background = '#f9dae7'; });
  $('json-drop').addEventListener('dragleave', event => { event.currentTarget.style.background = ''; });
  $('json-drop').addEventListener('drop', event => { event.preventDefault(); event.currentTarget.style.background = ''; loadJson(event.dataTransfer.files[0]); });
  $('import-all').addEventListener('click', async () => {
    if (!state.rawJson || !state.links.length) return notice('请先选择含图片链接的美化 JSON', true);
    if (state.importing) return;
    state.importing = true;
    const button = $('import-all');
    button.disabled = true;
    $('clear-json').disabled = true;
    let success = state.replacements.size;
    try {
      if (!state.importAlbumId) {
        const created = await api('albums', jsonOptions({ name: state.themeTitle.slice(0, 80) || '搬家美化' }));
        state.importAlbumId = created.id;
        state.albumId = created.id;
      }
      for (let i = 0; i < state.links.length; i++) {
        const link = state.links[i];
        const row = $(`link-${i}`);
        if (state.replacements.has(link)) continue;
        $('theme-progress').textContent = `正在搬运 ${i + 1} / ${state.links.length}：${link}`;
        try { const data = await api('import-image', jsonOptions({ url: link, albumId: state.importAlbumId })); state.replacements.set(link, data.url); row.classList.add('done'); row.textContent = `✓ ${link} → ${data.url}`; success++; }
        catch (e) { row.classList.add('failed'); row.textContent = `✗ ${link}：${e.message}`; }
      }
      $('theme-progress').textContent = `完成：${success} / ${state.links.length} 张图片已保存到「${state.themeTitle}」相册。失败的链接会留在原位。`;
      $('download-json').disabled = success === 0;
      await Promise.all([refreshProfile(), refreshAlbums()]);
    } catch (e) { $('theme-progress').textContent = `搬运后刷新失败：${e.message}`; }
    finally { state.importing = false; button.disabled = false; $('clear-json').disabled = !state.rawJson; }
  });
  $('download-json').addEventListener('click', () => { const title = $('json-output-name').value.trim(); if (!title) { notice('请填写搬家后的美化名称', true); $('json-output-name').focus(); return; } let changed; try { changed = renameTheme(replaceLinks(state.rawJson, state.replacements), title); } catch { return notice('替换后 JSON 校验失败，请联系管理员', true); } const blob = new Blob([changed], { type: 'application/json;charset=utf-8' }); const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '搬家后的美化') + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); });
  start();
})();
