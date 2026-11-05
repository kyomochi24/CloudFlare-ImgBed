export function initMusic({ api: studioApi, state, refreshProfile, refreshAlbums, notice }) {
  const $ = id => document.getElementById(id);
  const root = $('music-card');
  if (!root) return { refresh() {}, updateAlbum() {}, reset() {} };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
  const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  async function api(path, options) {
    try { return await studioApi(path, options); }
    catch (error) {
      if (/^请求失败 \((502|503|504)\)$/.test(error.message)) throw new Error('音乐服务连接异常，请稍后重试；如果持续出现，请检查音乐 Worker 的运行日志。');
      throw error;
    }
  }
  let tracks = [], searchVersion = 0, previewVersion = 0, activeId = '', searchEnabled = false;
  let saving = false, uploading = false, lifecycle = 0;
  const saved = new Map();
  const player = $('music-audio');
  function message(text, error = false) { $('music-status').textContent = text; $('music-status').classList.toggle('music-error', error); }
  function updateAlbum() {
    $('music-album').textContent = state.albums.find(x => x.id === state.albumId)?.name || '请先新建相册';
    render();
  }
  function render() {
    $('music-results').innerHTML = tracks.map((t, i) => {
      const result = saved.get(`${state.albumId}:${t.id}`);
      return `<article class="music-track ${t.id === activeId ? 'is-playing' : ''}"><span class="music-number">${String(i + 1).padStart(2, '0')}</span><span class="music-track-art" aria-hidden="true">♫</span><div class="music-track-info"><h4 title="${escape(t.title)}">${escape(t.title)}</h4><p title="${escape(t.artist)}">${escape(t.artist)}</p><small>${escape(t.album)}</small></div><div class="music-track-actions"><button type="button" class="music-listen" data-listen="${i}" aria-label="试听 ${escape(t.title)}">${t.id === activeId ? '重新试听' : '▷ 试听'}</button><button type="button" class="music-save ${result ? 'is-saved' : ''}" data-${result ? 'copy' : 'save'}="${i}" ${!result && (saving || !state.albumId) ? 'disabled' : ''}>${result ? '复制 BGM 链接' : '＋ 保存到相册'}</button></div></article>`;
    }).join('');
    $('music-count').textContent = tracks.length ? `${tracks.length} 首结果 · 网易云音乐` : '';
    $('music-empty').hidden = tracks.length > 0;
  }
  function stop() {
    previewVersion++; activeId = ''; player.pause(); player.removeAttribute('src'); player.load();
    $('music-player').hidden = true;
  }
  async function refresh() {
    try {
      const config = await api('music/status'); searchEnabled = !!config.searchEnabled;
      $('music-config').hidden = searchEnabled;
      $('music-search-button').disabled = !searchEnabled;
      $('music-query').disabled = !searchEnabled;
      message(searchEnabled ? '搜一首喜欢的歌，先试听，再收藏。' : '搜索尚未启用，仍可上传本地 MP3。');
    } catch (error) { searchEnabled = false; $('music-config').hidden = false; $('music-search-button').disabled = true; $('music-query').disabled = true; message(error.message, true); }
    updateAlbum();
  }
  async function syncAfterSave() {
    const results = await Promise.allSettled([refreshProfile(), refreshAlbums()]);
    if (results.some(x => x.status === 'rejected')) notice('音频已保存；相册列表刷新失败，可以稍后刷新页面。');
  }
  $('music-search').addEventListener('submit', async event => {
    event.preventDefault();
    const q = $('music-query').value.trim();
    if (!searchEnabled || !q) return;
    const version = ++searchVersion;
    $('music-search-button').disabled = true; root.setAttribute('aria-busy', 'true'); message('正在寻找这段旋律…');
    try {
      const data = await api('music/search', post({ q, source: 'netease' }));
      if (version !== searchVersion) return;
      stop(); tracks = data.tracks || []; render();
      message(tracks.length ? '试听链接可能过期；保存后会生成本站 BGM 链接。' : '没有搜到，试试歌手名或粘贴网易云歌曲链接。');
    } catch (error) { if (version === searchVersion) message(error.message, true); }
    finally { if (version === searchVersion) { $('music-search-button').disabled = !searchEnabled; root.removeAttribute('aria-busy'); } }
  });
  $('music-results').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const index = Number(button.dataset.listen ?? button.dataset.save ?? button.dataset.copy);
    const t = tracks[index]; if (!t) return;
    if ('listen' in button.dataset) {
      const version = ++previewVersion; button.disabled = true; player.pause();
      message(`正在加载「${t.title}」…`);
      try {
        const result = await api('music/resolve', post({ id: t.id, source: t.source }));
        if (version !== previewVersion) return;
        activeId = t.id; player.src = result.url;
        $('music-player-title').textContent = t.title; $('music-player-artist').textContent = t.artist;
        $('music-player').hidden = false; render();
        try { await player.play(); message('正在试听 · 满意后可以保存到相册。'); }
        catch (error) { message(error.name === 'NotAllowedError' ? '音源已就绪，点播放器的播放按钮试听。' : '音源暂时无法播放，可以重新试听或上传本地 MP3。', error.name !== 'NotAllowedError'); }
      } catch (error) { if (version === previewVersion) message(error.message, true); }
      finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    if ('copy' in button.dataset) { await copy(saved.get(`${state.albumId}:${t.id}`)?.url); return; }
    if (saving) return;
    const owner = lifecycle, albumId = state.albumId, albumName = state.albums.find(x => x.id === albumId)?.name;
    if (!albumId) { message('请先新建一个相册。', true); return; }
    saving = true; render(); message(`正在保存「${t.title}」到「${albumName}」，请稍等…`);
    try {
      const result = await api('music/save', post({ id: t.id, source: t.source, albumId }));
      if (owner !== lifecycle) return;
      saved.set(`${albumId}:${t.id}`, result);
      showSaved(result, albumName);
      message(result.alreadySaved ? '这首歌已在该相册中，可以直接复制 BGM 链接。' : `已保存到「${albumName}」，现在可以复制 BGM 链接。`);
      await syncAfterSave();
    } catch (error) { if (owner === lifecycle) message(error.message, true); }
    finally { saving = false; render(); }
  });
  async function copy(url) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); notice('BGM 链接已复制 ♫'); }
    catch { $('music-saved-url').value = url; $('music-saved').hidden = false; $('music-saved-url').focus(); $('music-saved-url').select(); message('请选中链接手动复制。'); }
  }
  function showSaved(result, albumName) {
    $('music-saved').hidden = false;
    $('music-saved-name').textContent = result.fileName;
    $('music-saved-detail').textContent = `已收藏到「${albumName || '相册'}」 · ${(result.sizeBytes / 1048576).toFixed(2)} MB`;
    $('music-saved-url').value = result.url;
    $('music-saved-listen').href = result.url;
  }
  $('music-copy').addEventListener('click', () => copy($('music-saved-url').value));
  $('music-stop').addEventListener('click', () => { stop(); render(); message('已停止试听。'); });
  player.addEventListener('error', () => { if (player.getAttribute('src')) message('试听链接可能已过期，请点「重新试听」；保存后的本站链接可直接使用。', true); });
  $('music-local-input').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || uploading) return;
    if (!/\.mp3$/i.test(file.name)) { message('请选择 MP3 文件。', true); return; }
    if (!file.size || file.size > 25 * 1048576) { message('请选择 25 MB 以内的 MP3。', true); return; }
    const owner = lifecycle, albumId = state.albumId, albumName = state.albums.find(x => x.id === albumId)?.name;
    if (!albumId) { message('请先新建一个相册。', true); return; }
    uploading = true; $('music-local-input').disabled = true; message(`正在上传「${file.name}」到「${albumName}」…`);
    const form = new FormData(); form.set('albumId', albumId); form.set('file', file);
    try {
      const result = await api('music/upload', { method: 'POST', body: form });
      if (owner !== lifecycle) return;
      showSaved(result, albumName); message('本地 MP3 已保存，可以复制 BGM 链接。'); await syncAfterSave();
    } catch (error) { if (owner === lifecycle) message(error.message, true); }
    finally { uploading = false; $('music-local-input').disabled = false; }
  });
  function reset() {
    lifecycle++; searchVersion++; stop(); tracks = []; saved.clear(); $('music-saved').hidden = true;
    $('music-query').value = ''; root.removeAttribute('aria-busy'); render();
  }
  render();
  return { refresh, updateAlbum, reset };
}
