import { imageLinks, replaceLinks } from './theme-utils.js';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { user: null, albums: [], albumId: '', files: [], hasMore: false, selectedFiles: new Set(), uploading: false, rawJson: '', jsonName: '', links: [], replacements: new Map(), application: null };
  const fmt = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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
  }
  function showMember() { $('guest').classList.toggle('hidden', !!state.user); $('member').classList.toggle('hidden', !state.user); $('logout').classList.toggle('hidden', !state.user); }
  function renderProfile() {
    const u = state.user;
    $('display-name').textContent = u.discordName || u.username || '甜品屋客人';
    const creator = u.tier === 'pikachu';
    const limit = creator ? u.creatorMonthLimit : u.baseLimit;
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const used = creator && u.monthKey === month ? u.monthUploadedBytes : creator ? 0 : u.storedBytes;
    $('tier-description').textContent = creator ? '皮卡丘 ♡ 每月可上传 1 GB，旧图永久保留。' : '皮丘 ✿ 总共可保存 100 MB，图片永久保留。';
    $('quota-label').textContent = creator ? '本月上传额度' : '当前存储额度';
    $('quota-value').textContent = `${fmt(used)} / ${fmt(limit)}`;
    $('quota-bar').style.width = `${Math.min(100, 100 * used / limit)}%`;
    $('quota-detail').textContent = creator ? `剩余 ${fmt(Math.max(0, limit - used))} · 已保存 ${fmt(u.storedBytes)}，旧图不计入本月额度` : `剩余 ${fmt(Math.max(0, limit - used))} · 删除图片可释放空间`;
    $('application-form').classList.toggle('hidden', creator || state.application?.status === 'pending');
    $('application-state').textContent = creator ? '♡ 你已经是皮卡丘啦！' : state.application?.status === 'pending' ? `✉「${state.application.work_title}」正在等待管理员审核。` : state.application?.status === 'rejected' ? '上次申请未通过，你可以修改信息后重新提交。' : '';
    if (u.discordId) $('application-form').elements.discordId.value = u.discordId;
  }
  function renderAlbums() {
    $('album-list').innerHTML = state.albums.map(a => `<button class="album-item ${a.id === state.albumId ? 'active' : ''}" data-id="${escapeHtml(a.id)}">✿ ${escapeHtml(a.name)} <small>${a.file_count}</small></button>`).join('');
    $('current-album-name').textContent = state.albums.find(a => a.id === state.albumId)?.name || '我的相册';
  }
  function renderFiles() {
    $('file-grid').innerHTML = state.files.length ? state.files.map(f => `<div class="file-card ${state.selectedFiles.has(f.id) ? 'selected' : ''}"><label class="file-select"><input type="checkbox" data-file-id="${escapeHtml(f.id)}" ${state.selectedFiles.has(f.id) ? 'checked' : ''}><span>选中</span></label><img loading="lazy" src="${escapeHtml(f.url)}" alt="${escapeHtml(f.file_name)}"><strong title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</strong><div class="file-actions"><button data-copy="${escapeHtml(f.url)}">复制图链</button><button data-delete="${escapeHtml(f.id)}">删除</button></div></div>`).join('') : '<div class="empty">相册里还空空的。上传第一张图片吧 ♡</div>';
    $('more-files').classList.toggle('hidden', !state.hasMore);
    renderSelection();
  }
  async function refreshProfile() { const data = await api('me'); state.user = data.user; state.application = data.application; renderProfile(); showMember(); }
  async function refreshAlbums() {
    const data = await api('albums'); state.albums = data.albums;
    if (!state.albums.some(a => a.id === state.albumId)) state.albumId = state.albums[0]?.id || '';
    renderAlbums(); await refreshFiles();
  }
  async function refreshFiles(more = false) { if (!more) state.selectedFiles.clear(); if (!state.albumId) { state.files = []; state.hasMore = false; renderFiles(); return; } const offset = more ? state.files.length : 0; const data = await api(`files?album=${encodeURIComponent(state.albumId)}&offset=${offset}`); state.files = more ? [...state.files, ...data.files] : data.files; state.hasMore = data.hasMore; renderFiles(); }
  async function start() {
    try { const c = await api('config'); $('discord-login').classList.toggle('disabled', !c.discordEnabled); $('discord-login').href = c.discordEnabled ? '/api/studio/oauth/start' : '#'; $('discord-hint').textContent = c.discordEnabled ? '请先加入管理员指定的 Discord 社区。' : '站长尚未填写 Discord 应用和社区 ID；可使用管理员发放的账号。'; } catch (e) { $('discord-hint').textContent = e.message; }
    const error = new URLSearchParams(location.search).get('error'); if (error === 'not_member') { notice('这个 Discord 账号尚未加入指定社区，暂时不能登录。', true); history.replaceState(null, '', '/studio/'); }
    try { await refreshProfile(); await refreshAlbums(); } catch { state.user = null; showMember(); }
  }
  $('local-login').addEventListener('submit', async event => { event.preventDefault(); const b = event.currentTarget.querySelector('button'); b.disabled = true; try { const form = new FormData(event.currentTarget); const data = await api('login', jsonOptions({ username: form.get('username'), password: form.get('password') })); state.user = data.user; await refreshProfile(); await refreshAlbums(); event.currentTarget.reset(); notice('欢迎回家 ♡'); } catch (e) { notice(e.message, true); } finally { b.disabled = false; } });
  $('logout').addEventListener('click', async () => { try { await api('logout', { method: 'POST' }); state.user = null; showMember(); notice('下次再来玩呀 ♡'); } catch (e) { notice(e.message, true); } });
  $('new-album').addEventListener('click', () => $('album-dialog').showModal());
  $('album-form').addEventListener('submit', async event => { if (event.submitter?.value !== 'create') return; event.preventDefault(); try { const data = await api('albums', jsonOptions({ name: $('album-name').value })); $('album-dialog').close(); $('album-name').value = ''; state.albumId = data.id; await refreshAlbums(); notice('新相册已经摆好啦 ✿'); } catch (e) { notice(e.message, true); } });
  $('album-list').addEventListener('click', async event => { const button = event.target.closest('[data-id]'); if (!button) return; state.albumId = button.dataset.id; renderAlbums(); await refreshFiles(); });
  $('more-files').addEventListener('click', async () => { try { await refreshFiles(true); } catch (e) { notice(e.message, true); } });
  async function uploadFiles(files) {
    if (!files.length || state.uploading) return;
    if (!state.albumId) { $('upload-status').textContent = '请先创建相册'; return; }
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
    state.uploading = true;
    let success = 0;
    const failures = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        $('upload-status').textContent = `正在上传 ${i + 1} / ${files.length}：${file.name}`;
        if (!allowed.has(file.type)) { failures.push(`${file.name}：不是支持的图片格式`); continue; }
        if (file.size > 25 * 1048576) { failures.push(`${file.name}：单张图片不能超过 25 MB`); continue; }
        const form = new FormData();
        form.set('file', file);
        form.set('albumId', state.albumId);
        try { await api('files', { method: 'POST', body: form }); success++; }
        catch (e) { failures.push(`${file.name}：${e.message}`); }
      }
      await Promise.all([refreshProfile(), refreshAlbums()]);
      $('upload-status').textContent = `已上传 ${success} / ${files.length} 张${failures.length ? `；${failures[0]}${failures.length > 1 ? `，另有 ${failures.length - 1} 张失败` : ''}` : ' ♡'}`;
    } catch (e) { $('upload-status').textContent = `上传后刷新失败：${e.message}`; }
    finally { state.uploading = false; }
  }
  $('upload-input').addEventListener('change', event => { uploadFiles([...event.target.files]); event.target.value = ''; });
  const imageDrop = $('image-drop');
  imageDrop.addEventListener('click', () => $('upload-input').click());
  imageDrop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('upload-input').click(); } });
  imageDrop.addEventListener('dragenter', event => { event.preventDefault(); imageDrop.classList.add('drag-active'); });
  imageDrop.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; imageDrop.classList.add('drag-active'); });
  imageDrop.addEventListener('dragleave', event => { if (!imageDrop.contains(event.relatedTarget)) imageDrop.classList.remove('drag-active'); });
  imageDrop.addEventListener('drop', event => { event.preventDefault(); imageDrop.classList.remove('drag-active'); uploadFiles([...event.dataTransfer.files]); });
  $('file-grid').addEventListener('change', event => { const box = event.target.closest('[data-file-id]'); if (!box) return; if (box.checked) state.selectedFiles.add(box.dataset.fileId); else state.selectedFiles.delete(box.dataset.fileId); box.closest('.file-card').classList.toggle('selected', box.checked); renderSelection(); });
  $('select-all-files').addEventListener('click', () => { state.files.forEach(file => state.selectedFiles.add(file.id)); renderFiles(); });
  $('clear-selected-files').addEventListener('click', () => { state.selectedFiles.clear(); renderFiles(); });
  $('copy-selected-files').addEventListener('click', async () => { const links = state.files.filter(file => state.selectedFiles.has(file.id)).map(file => file.url); if (!links.length) return; try { await navigator.clipboard.writeText(links.join('\n')); notice(`已复制 ${links.length} 条图链，每行一条 ✿`); } catch { notice('复制失败，请检查浏览器的剪贴板权限', true); } });
  $('file-grid').addEventListener('click', async event => { const copy = event.target.closest('[data-copy]'); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); notice('图链已复制到剪贴板 ✿'); } catch { notice('复制失败，请在图片上点右键复制链接', true); } return; } const del = event.target.closest('[data-delete]'); if (!del || !confirm('确定删除这张图片吗？删除后原图链会失效。')) return; try { await api(`files/${encodeURIComponent(del.dataset.delete)}`, { method: 'DELETE' }); await Promise.all([refreshProfile(), refreshAlbums()]); notice('图片已删除'); } catch (e) { notice(e.message, true); } });
  $('application-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const values = Object.fromEntries(new FormData(formEl));
    values.discordId = String(values.discordId || '').trim();
    values.workTitle = String(values.workTitle || '').trim();
    values.workUrl = String(values.workUrl || '').trim();
    if (!/^\d{15,25}$/.test(values.discordId)) { applicationFeedback('请填写完整的 Discord 数字 ID（15–25 位）。你现在填写的可能是用户名或不完整的 ID。', true); formEl.elements.discordId.focus(); return; }
    if (!values.workTitle) { applicationFeedback('请填写作品名称。', true); formEl.elements.workTitle.focus(); return; }
    if (values.workUrl) { try { const url = new URL(values.workUrl); if (url.protocol !== 'https:') throw new Error(); } catch { applicationFeedback('作品链接请填写以 https:// 开头的完整网址，或留空。', true); formEl.elements.workUrl.focus(); return; } }
    const button = formEl.querySelector('button[type=submit]');
    button.disabled = true;
    applicationFeedback('正在提交申请信…');
    try { await api('applications', jsonOptions(values)); await refreshProfile(); applicationFeedback('申请信已寄出，等待管理员审核 ✉'); }
    catch (e) { applicationFeedback(e.message, true); }
    finally { button.disabled = false; }
  });
  async function loadJson(file) {
    if (!file || !file.name.toLowerCase().endsWith('.json')) return notice('请选择 .json 美化文件', true);
    if (file.size > 5 * 1048576) return notice('JSON 文件不能超过 5 MB', true);
    try { const raw = await file.text(); state.links = imageLinks(raw); state.rawJson = raw; state.jsonName = file.name; state.replacements.clear(); $('json-file-name').textContent = file.name; $('theme-results').classList.remove('hidden'); $('theme-count').textContent = `发现 ${state.links.length} 条不同的图片链接`;
      $('theme-links').innerHTML = state.links.map((url, i) => `<div class="link-row" id="link-${i}">${escapeHtml(url)}</div>`).join('') || '<div class="hint">没有识别到带图片扩展名的链接。</div>';
      $('theme-progress').textContent = '图片不会被压缩。搬运前请确认你有权保存这些图片。'; $('import-all').disabled = state.links.length === 0; $('download-json').disabled = true;
    } catch { notice('JSON 文件格式不正确，无法解析', true); }
  }
  $('json-input').addEventListener('change', event => loadJson(event.target.files[0]));
  $('json-drop').addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.style.background = '#f9dae7'; });
  $('json-drop').addEventListener('dragleave', event => { event.currentTarget.style.background = ''; });
  $('json-drop').addEventListener('drop', event => { event.preventDefault(); event.currentTarget.style.background = ''; loadJson(event.dataTransfer.files[0]); });
  $('import-all').addEventListener('click', async () => { if (!state.albumId) return notice('请先创建相册', true); const button = $('import-all'); button.disabled = true; let success = 0; for (let i = 0; i < state.links.length; i++) { const link = state.links[i]; const row = $(`link-${i}`); $('theme-progress').textContent = `正在搬运 ${i + 1} / ${state.links.length}：${link}`; try { const data = await api('import-image', jsonOptions({ url: link, albumId: state.albumId })); state.replacements.set(link, data.url); row.classList.add('done'); row.textContent = `✓ ${link} → ${data.url}`; success++; } catch (e) { row.classList.add('failed'); row.textContent = `✗ ${link}：${e.message}`; } } $('theme-progress').textContent = `完成：${success} / ${state.links.length} 张图片已保存。失败的链接会留在原位。`; $('download-json').disabled = success === 0; button.disabled = false; await Promise.all([refreshProfile(), refreshAlbums()]); });
  $('download-json').addEventListener('click', () => { let changed; try { changed = replaceLinks(state.rawJson, state.replacements); } catch { return notice('替换后 JSON 校验失败，请联系管理员', true); } const blob = new Blob([changed], { type: 'application/json;charset=utf-8' }); const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = state.jsonName.replace(/\.json$/i, '') + '-图链已替换.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); });
  start();
})();
