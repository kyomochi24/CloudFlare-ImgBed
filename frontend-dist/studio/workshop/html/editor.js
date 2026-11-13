// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  TEMPLATES,
  displayAssetName,
  freshProject,
  normalizeProject,
  normalizeViewport,
  replaceAssetUrl,
  safeResourceUrl,
  scanAssets
} from './core.mjs?v=20261113a';

const $ = id => document.getElementById(id);
const editor = $('html-editor');
const frame = $('preview');
const OMITTED_ELEMENTS = 'style,script,template,iframe,object,embed,form,meta,base,link,title';
let project = freshProject();
let channel = '';
let previewReady = false;
let renderTimer;
let saveTimer;
let historyTimer;
let toastTimer;
let db;
let history = [];
let historyIndex = -1;
let assets = [];
let assetFilter = 'all';
let selectedAssetUrl = '';
let selectedNode = null;
let editMode = false;
let albumOffset = 0;
let albumRequest = 0;
let albumsLoaded = false;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 3800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('qiuqiu-html-workbench', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function draftRequest(mode, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', mode);
    const store = transaction.objectStore('drafts');
    const request = mode === 'readonly' ? store.get('current') : store.put(value, 'current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('保存被中断'));
  });
}

function snapshot() {
  project.name = $('project-name').value.trim() || '我的开场白';
  project.html = editor.value;
  project.viewport = normalizeViewport(project.viewport);
  project.placeholders = {user: $('sample-user').value, char: $('sample-char').value};
  return structuredClone(project);
}

async function saveDraft(silent = false) {
  clearTimeout(saveTimer);
  try {
    if (!db) throw new Error('存储不可用');
    await draftRequest('readwrite', snapshot());
    $('save-state').textContent = '已保存到本机 · ' + new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    if (!silent) toast('草稿已经保存到当前浏览器');
  } catch {
    $('save-state').textContent = '本机保存失败，请备份工程';
    if (!silent) toast('浏览器存储不可用，请下载工程备份');
  }
}

function recordHistory() {
  clearTimeout(historyTimer);
  if (history[historyIndex] === editor.value) return;
  history = history.slice(0, historyIndex + 1);
  history.push(editor.value);
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undo').disabled = historyIndex <= 0;
  $('redo').disabled = historyIndex >= history.length - 1;
}

function setCode(html, options = {}) {
  if (options.record !== false) recordHistory();
  editor.value = String(html);
  if (options.record !== false) recordHistory();
  changed({immediate: options.immediate});
}

function moveHistory(delta) {
  recordHistory();
  const next = historyIndex + delta;
  if (next < 0 || next >= history.length) return;
  historyIndex = next;
  editor.value = history[next];
  updateHistoryButtons();
  changed({immediate: true});
}

function changed({immediate = false} = {}) {
  project.html = editor.value;
  project.name = $('project-name').value.trim() || '我的开场白';
  $('save-state').textContent = '有更改 · 即将保存';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(true), 650);
  updateLines();
  renderAssetList();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, immediate ? 0 : 260);
}

function updateLines() {
  const count = editor.value.split('\n').length;
  $('line-count').textContent = count + ' 行';
  $('line-numbers').textContent = Array.from({length: count}, (_, index) => index + 1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
}

function editableNodes(documentNode) {
  return [...documentNode.body.querySelectorAll('*')].filter(node => !node.matches(OMITTED_ELEMENTS) && !node.closest('script,iframe,object,embed,form,template'));
}

function sanitizePreviewDocument(source) {
  const previewSource = String(source)
    .replaceAll('{{user}}', escapeHtml($('sample-user').value || '你'))
    .replaceAll('{{char}}', escapeHtml($('sample-char').value || '浅浅丘'));
  const documentNode = new DOMParser().parseFromString(previewSource, 'text/html');
  documentNode.querySelectorAll('script,iframe,object,embed,form,meta[http-equiv],base').forEach(node => node.remove());
  documentNode.querySelectorAll('link').forEach(node => {
    if (!/stylesheet/i.test(node.rel || '')) node.remove();
  });
  documentNode.querySelectorAll('*').forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') node.removeAttribute(attribute.name);
      if (['href', 'src', 'poster'].includes(attribute.name) && /^\s*javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    }
  });
  editableNodes(documentNode).forEach((node, index) => node.dataset.qiuqiuNode = String(index));
  return documentNode;
}

function previewBridge(nonce) {
  const currentChannel = JSON.stringify(channel);
  return `<script nonce="${nonce}">(()=>{
const channel=${currentChannel},tell=(type,data={})=>parent.postMessage({source:'qiuqiu-html-preview',channel,type,...data},'*');
let selected=null,overlay=null,editMode=false;
const px=value=>{const number=parseFloat(value);return Number.isFinite(number)?Math.round(number):''};
function describe(element){const style=getComputedStyle(element),rect=element.getBoundingClientRect();return{id:element.dataset.qiuqiuNode,tag:element.tagName.toLowerCase(),label:(element.getAttribute('alt')||element.getAttribute('class')||element.id||element.tagName).toString().slice(0,80),width:Math.round(rect.width),height:Math.round(rect.height),radius:px(style.borderRadius),fit:style.objectFit==='fill'?'fill':['cover','contain'].includes(style.objectFit)?style.objectFit:'',position:style.objectPosition||'50% 50%',inlineStyle:element.getAttribute('style')||''}};
function ensureOverlay(){if(overlay)return overlay;overlay=document.createElement('div');overlay.id='qiuqiu-workbench-overlay';overlay.innerHTML='<button type="button" data-handle="move" aria-label="拖动元素">✥</button><button type="button" data-handle="resize" aria-label="缩放元素">↘</button>';document.body.append(overlay);overlay.querySelectorAll('button').forEach(button=>button.addEventListener('pointerdown',startDrag));return overlay}
function placeOverlay(){if(!selected)return;const rect=selected.getBoundingClientRect(),box=ensureOverlay();box.style.left=rect.left+'px';box.style.top=rect.top+'px';box.style.width=rect.width+'px';box.style.height=rect.height+'px';box.hidden=false;box.classList.toggle('editing',editMode)}
function select(element,notify=true){if(selected)selected.removeAttribute('data-qiuqiu-selected');selected=element;if(!selected){if(overlay)overlay.hidden=true;return}selected.setAttribute('data-qiuqiu-selected','');placeOverlay();if(notify)tell('selected',describe(selected))}
function startDrag(event){if(!editMode||!selected)return;event.preventDefault();event.stopPropagation();const handle=event.currentTarget.dataset.handle,startX=event.clientX,startY=event.clientY,startRect=selected.getBoundingClientRect(),raw=selected.style.translate.trim().split(/\s+/),baseX=parseFloat(raw[0])||0,baseY=parseFloat(raw[1])||0;event.currentTarget.setPointerCapture(event.pointerId);const move=moveEvent=>{const dx=moveEvent.clientX-startX,dy=moveEvent.clientY-startY;if(handle==='move')selected.style.translate=(baseX+dx)+'px '+(baseY+dy)+'px';else{selected.style.width=Math.max(12,startRect.width+dx)+'px';if(selected.matches('img,video,svg,canvas'))selected.style.height='auto';else selected.style.height=Math.max(12,startRect.height+dy)+'px'}placeOverlay()};const end=()=>{event.currentTarget.removeEventListener('pointermove',move);event.currentTarget.removeEventListener('pointerup',end);tell('style-change',{id:selected.dataset.qiuqiuNode,style:selected.getAttribute('style')||''});tell('selected',describe(selected))};event.currentTarget.addEventListener('pointermove',move);event.currentTarget.addEventListener('pointerup',end)}
document.addEventListener('click',event=>{if(event.target.closest('#qiuqiu-workbench-overlay'))return;const target=event.target.closest('[data-qiuqiu-node]');if(!target)return;event.preventDefault();event.stopPropagation();select(target)},true);
addEventListener('scroll',placeOverlay,true);addEventListener('resize',placeOverlay);
addEventListener('message',event=>{const data=event.data;if(data?.channel!==channel)return;if(data.type==='edit-mode'){editMode=!!data.enabled;placeOverlay()}if(data.type==='select'){const target=document.querySelector('[data-qiuqiu-node="'+CSS.escape(String(data.id))+'"]');select(target,false)}if(data.type==='select-asset'){let target=null;for(const element of document.querySelectorAll('[data-qiuqiu-node]')){if([element.getAttribute('src'),element.getAttribute('poster')].includes(data.url)||getComputedStyle(element).backgroundImage.includes(data.url)){target=element;break}}if(target){select(target);target.scrollIntoView({block:'center',inline:'center'})}}if(data.type==='clear')select(null,false)});
tell('ready',{width:innerWidth,height:innerHeight});
})()</script>`;
}

function buildPreviewDocument() {
  const documentNode = sanitizePreviewDocument(editor.value);
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const csp = documentNode.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src https: http: data: blob: 'unsafe-inline'; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  documentNode.head.prepend(csp);
  const helper = documentNode.createElement('style');
  helper.textContent = `html,body{min-height:100%;margin:0}*,*::before,*::after{box-sizing:border-box}[data-qiuqiu-selected]{outline:2px solid #e25f93!important;outline-offset:2px}#qiuqiu-workbench-overlay{position:fixed;z-index:2147483647;border:1px dashed #e25f93;pointer-events:none}#qiuqiu-workbench-overlay button{display:none;position:absolute;width:28px;height:28px;padding:0;border:2px solid white;border-radius:50%;background:#a94f76;color:#fff;box-shadow:0 3px 10px #4f304866;pointer-events:auto;touch-action:none;font:16px/1 system-ui;place-items:center}#qiuqiu-workbench-overlay.editing button{display:grid}#qiuqiu-workbench-overlay [data-handle=move]{left:-15px;top:-15px;cursor:move}#qiuqiu-workbench-overlay [data-handle=resize]{right:-15px;bottom:-15px;cursor:nwse-resize}`;
  documentNode.head.append(helper);
  documentNode.body.insertAdjacentHTML('beforeend', previewBridge(nonce));
  return '<!doctype html>\n' + documentNode.documentElement.outerHTML;
}

function renderPreview() {
  previewReady = false;
  channel = crypto.randomUUID();
  $('render-state').textContent = '正在更新预览…';
  try {
    frame.srcdoc = buildPreviewDocument();
  } catch (error) {
    $('render-state').textContent = '预览更新失败';
    toast(error.message || 'HTML 预览生成失败');
  }
}

function sendPreview(type, data = {}) {
  if (previewReady) frame.contentWindow.postMessage({channel, type, ...data}, '*');
}

window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== frame.contentWindow || data?.source !== 'qiuqiu-html-preview' || data.channel !== channel) return;
  if (data.type === 'ready') {
    previewReady = true;
    $('render-state').textContent = '已应用 · ' + data.width + ' × ' + data.height;
    sendPreview('edit-mode', {enabled: editMode});
    if (selectedNode) sendPreview('select', {id: selectedNode.id});
  }
  if (data.type === 'selected') selectNode(data);
  if (data.type === 'style-change') replaceNodeStyle(data.id, data.style);
});

function parseSource() {
  return new DOMParser().parseFromString(editor.value, 'text/html');
}

function serializeSource(documentNode) {
  const fullDocument = /<!doctype\s+html|<html[\s>]/i.test(editor.value);
  if (fullDocument) return '<!doctype html>\n' + documentNode.documentElement.outerHTML;
  const headContent = [...documentNode.head.children].filter(node => !node.matches('title,meta,base')).map(node => node.outerHTML).join('\n');
  const bodyContent = documentNode.body.innerHTML;
  return [headContent, bodyContent].filter(Boolean).join('\n\n');
}

function mutateNode(id, mutator) {
  const documentNode = parseSource();
  const node = editableNodes(documentNode)[Number(id)];
  if (!node) return toast('代码已经变化，请重新点选元素');
  mutator(node);
  setCode(serializeSource(documentNode), {immediate: true});
}

function replaceNodeStyle(id, styleText) {
  mutateNode(id, node => {
    if (styleText) node.setAttribute('style', styleText);
    else node.removeAttribute('style');
  });
}

function selectNode(data) {
  selectedNode = data;
  $('element-panel').hidden = false;
  $('element-label').textContent = `<${data.tag}> ${data.label || ''}`;
  $('selected-element').textContent = `已选中 <${data.tag}> ${data.label || ''}`;
  $('element-width').value = data.width || '';
  $('element-height').value = data.height || '';
  $('element-radius').value = data.radius || 0;
  $('element-fit').value = data.fit || '';
  const position = String(data.position || '50% 50%').match(/[\d.]+/g)?.slice(0, 2).map(Number) || [50, 50];
  $('object-position-x').value = position[0] ?? 50;
  $('object-position-y').value = position[1] ?? 50;
  updateObjectPositionLabel();
}

function styleSelected(properties) {
  if (!selectedNode) return toast('请先点击预览中的元素');
  mutateNode(selectedNode.id, node => {
    for (const [property, value] of Object.entries(properties)) {
      if (value === '' || value === null) node.style.removeProperty(property);
      else node.style.setProperty(property, value);
    }
  });
}

function updateObjectPositionLabel() {
  $('object-position-value').value = `${$('object-position-x').value}% ${$('object-position-y').value}%`;
}

for (const [id, property] of [['element-width', 'width'], ['element-height', 'height'], ['element-radius', 'border-radius']]) {
  $(id).addEventListener('change', () => {
    const value = $(id).value === '' ? '' : Math.max(0, Number($(id).value)) + 'px';
    styleSelected({[property]: value});
  });
}
$('element-fit').addEventListener('change', () => styleSelected({'object-fit': $('element-fit').value}));
for (const id of ['object-position-x', 'object-position-y']) $(id).addEventListener('input', () => {
  updateObjectPositionLabel();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => styleSelected({'object-position': $('object-position-value').value}), 140);
});
document.querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => {
  const align = button.dataset.align;
  styleSelected({display: 'block', 'margin-left': align === 'left' ? '0' : 'auto', 'margin-right': align === 'right' ? '0' : 'auto'});
}));
$('reset-element').addEventListener('click', () => styleSelected({width: '', height: '', 'border-radius': '', 'object-fit': '', 'object-position': '', translate: '', 'margin-left': '', 'margin-right': ''}));

function typeForFilter(asset) {
  return asset.type === 'video' ? 'music' : asset.type;
}

function renderAssetList() {
  assets = scanAssets(editor.value);
  const counts = {image: 0, font: 0, music: 0};
  for (const asset of assets) counts[typeForFilter(asset)] = (counts[typeForFilter(asset)] || 0) + 1;
  $('asset-count').textContent = assets.length + ' 个';
  $('count-all').textContent = assets.length;
  for (const type of ['image', 'font', 'music']) $(`count-${type}`).textContent = counts[type] || 0;
  const visible = assets.filter(asset => assetFilter === 'all' || typeForFilter(asset) === assetFilter);
  $('asset-list').replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = assetFilter === 'all' ? '当前代码里还没有识别到素材。' : '这一类素材还是空的。';
    $('asset-list').append(empty);
    return;
  }
  visible.forEach((asset, index) => $('asset-list').append(createAssetCard(asset, index)));
  if (selectedAssetUrl && !assets.some(asset => asset.url === selectedAssetUrl)) {
    selectedAssetUrl = '';
    $('asset-replace-panel').hidden = true;
  }
}

function createThumb(asset, index, compact = false) {
  const thumb = document.createElement('span');
  thumb.className = 'asset-thumb ' + asset.type;
  if (asset.type === 'image') {
    thumb.classList.add('checker');
    const image = new Image();
    image.src = asset.url;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => { image.remove(); thumb.textContent = '!'; };
    thumb.append(image);
  } else if (asset.type === 'font') {
    thumb.textContent = 'Aa';
    thumb.classList.add('font');
    if ('FontFace' in window) {
      const family = `qiuqiu-asset-${Date.now()}-${index}`;
      const face = new FontFace(family, `url(${JSON.stringify(asset.url)})`);
      face.load().then(font => { document.fonts.add(font); thumb.style.fontFamily = family; }).catch(() => {});
    }
  } else {
    thumb.textContent = asset.type === 'video' ? '▶' : '♫';
    if (!compact) thumb.title = '点击卡片后可试听或替换';
  }
  return thumb;
}

function createAssetCard(asset, index) {
  const card = document.createElement('div');
  card.className = 'asset-card' + (asset.url === selectedAssetUrl ? ' selected' : '');
  card.append(createThumb(asset, index));
  const copy = document.createElement('button');
  copy.className = 'asset-copy';
  copy.type = 'button';
  const name = document.createElement('strong');
  name.textContent = displayAssetName(asset.url);
  const meta = document.createElement('small');
  const label = {image: '图片', font: '字体', music: '音乐', video: '视频'}[asset.type] || '素材';
  meta.textContent = `${label} · 使用 ${asset.occurrences.length} 处`;
  copy.append(name, meta);
  copy.addEventListener('click', () => selectAsset(asset));
  if (['music', 'video'].includes(asset.type)) copy.addEventListener('dblclick', () => playAsset(asset.url));
  card.append(copy);
  const locate = document.createElement('button');
  locate.className = 'asset-locate';
  locate.type = 'button';
  locate.textContent = ['music', 'video'].includes(asset.type) ? '试听' : '定位';
  locate.addEventListener('click', () => ['music', 'video'].includes(asset.type) ? playAsset(asset.url) : locateAsset(asset));
  card.append(locate);
  return card;
}

function selectAsset(asset) {
  selectedAssetUrl = asset.url;
  $('asset-replace-panel').hidden = false;
  $('selected-asset-name').textContent = displayAssetName(asset.url);
  $('replace-scope').replaceChildren();
  asset.occurrences.forEach((occurrence, index) => {
    const tag = occurrence.context.match(/<\s*([a-z0-9-]+)/i)?.[1];
    const where = occurrence.kind === 'css' ? 'CSS 背景或字体' : tag ? `<${tag}>` : 'HTML 属性';
    $('replace-scope').append(new Option(`只替换第 ${index + 1} 处 · ${where}`, `one:${index}`));
  });
  if (asset.occurrences.length > 1) $('replace-scope').append(new Option(`替换全部 ${asset.occurrences.length} 处`, 'all'));
  renderAssetList();
  sendPreview('select-asset', {url: asset.url});
  if (albumsLoaded && $('album-list').value) loadAlbumAssets(false);
}

function locateAsset(asset = assets.find(item => item.url === selectedAssetUrl)) {
  if (!asset) return;
  const selectedOccurrence = $('replace-scope').value.match(/^one:(\d+)$/)?.[1];
  const occurrence = asset.occurrences[Number(selectedOccurrence) || 0];
  editor.focus();
  editor.setSelectionRange(occurrence.start, occurrence.end);
  const before = editor.value.slice(0, occurrence.start).split('\n').length - 1;
  editor.scrollTop = Math.max(0, (before - 4) * 19.4);
  switchView('code');
}

function playAsset(url) {
  const audio = $('audio-preview');
  audio.src = url;
  audio.hidden = false;
  audio.play().catch(() => toast('浏览器阻止了自动播放，请点播放器的播放按钮'));
}

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  assetFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
  renderAssetList();
}));
$('locate-asset').addEventListener('click', () => locateAsset());

async function api(path) {
  const response = await fetch('/api/studio/' + path, {credentials: 'same-origin'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || (response.status === 401 ? '请先回甜品屋登录，再读取相册。' : '相册读取失败'));
  return data;
}

$('load-albums').addEventListener('click', async () => {
  $('load-albums').disabled = true;
  try {
    const data = await api('albums');
    $('album-list').replaceChildren(new Option('选择相册', ''));
    for (const album of data.albums || []) $('album-list').append(new Option(`${album.name} · ${album.file_count || 0}`, album.id));
    albumsLoaded = true;
    $('album-status').textContent = '选择相册后，点击缩略图即可替换当前素材。';
  } catch (error) {
    $('album-status').textContent = error.message;
  } finally {
    $('load-albums').disabled = false;
  }
});

function fileType(file) {
  const type = String(file.mime_type || file.type || '').toLowerCase();
  const name = String(file.file_name || file.name || file.url || '').toLowerCase();
  if (type.startsWith('font/') || /\.(woff2?|ttf|otf)(?:\?|$)/.test(name)) return 'font';
  if (type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|wav|flac)(?:\?|$)/.test(name)) return 'music';
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:\?|$)/.test(name)) return 'video';
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|svg)(?:\?|$)/.test(name)) return 'image';
  return 'file';
}

function matchesSelectedType(file) {
  const selected = assets.find(asset => asset.url === selectedAssetUrl);
  if (!selected) return false;
  const expected = typeForFilter(selected);
  const actual = fileType(file);
  return expected === (actual === 'video' ? 'music' : actual);
}

async function loadAlbumAssets(more = false) {
  const album = $('album-list').value;
  if (!album) return;
  const request = ++albumRequest;
  if (!more) {
    albumOffset = 0;
    $('album-assets').replaceChildren();
  }
  $('more-assets').disabled = true;
  try {
    const data = await api(`files?album=${encodeURIComponent(album)}&offset=${albumOffset}`);
    if (request !== albumRequest) return;
    const files = data.files || [];
    files.filter(matchesSelectedType).forEach((file, index) => $('album-assets').append(createAlbumAsset(file, index)));
    albumOffset += files.length;
    $('more-assets').hidden = !data.hasMore;
    $('album-status').textContent = $('album-assets').children.length ? '点击一个缩略图，立即替换并更新预览。' : '这个相册里没有与当前素材同类型的文件。';
  } catch (error) {
    $('album-status').textContent = error.message;
  } finally {
    $('more-assets').disabled = false;
  }
}

function createAlbumAsset(file, index) {
  const url = safeResourceUrl(file.url);
  const type = fileType(file);
  const asset = {url, type};
  const button = document.createElement('button');
  button.className = 'album-asset';
  button.type = 'button';
  button.title = file.file_name || file.name || '替换素材';
  button.append(createThumb(asset, index, true));
  const label = document.createElement('small');
  label.textContent = file.file_name || file.name || displayAssetName(url);
  button.append(label);
  button.addEventListener('click', () => replaceSelectedAsset(url));
  return button;
}

function replaceSelectedAsset(newUrl) {
  const current = assets.find(asset => asset.url === selectedAssetUrl);
  if (!current) return toast('请先在“当前作品的素材”里选择要替换的素材');
  try {
    const all = $('replace-scope').value === 'all';
    const occurrence = Number($('replace-scope').value.match(/^one:(\d+)$/)?.[1]) || 0;
    const updated = replaceAssetUrl(editor.value, selectedAssetUrl, newUrl, {all, occurrence});
    selectedAssetUrl = newUrl;
    setCode(updated, {immediate: true});
    toast(all && current.occurrences.length > 1 ? `已替换全部 ${current.occurrences.length} 处引用` : '素材已替换');
  } catch (error) {
    toast(error.message);
  }
}

$('album-list').addEventListener('change', () => loadAlbumAssets(false));
$('more-assets').addEventListener('click', () => loadAlbumAssets(true));

function resizePreview() {
  project.viewport = normalizeViewport(project.viewport);
  const {width, height, zoom} = project.viewport;
  frame.width = width;
  frame.height = height;
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  const stage = $('stage');
  const availableWidth = Math.max(100, stage.clientWidth - 34);
  const availableHeight = Math.max(100, stage.clientHeight - 34);
  const scale = zoom === 'fit' ? Math.min(1, availableWidth / width, availableHeight / height) : Number(zoom);
  $('frame-wrap').style.width = width + 'px';
  $('frame-wrap').style.height = height + 'px';
  $('frame-wrap').style.transform = `scale(${scale})`;
  $('frame-space').style.width = width * scale + 'px';
  $('frame-space').style.height = height * scale + 'px';
  $('viewport-label').textContent = `${width} × ${height} · ${Math.round(scale * 100)}%`;
}

function syncDevice() {
  const value = project.viewport.width + ',' + project.viewport.height;
  $('device').value = [...$('device').options].some(option => option.value === value) ? value : 'custom';
}

$('device').addEventListener('change', () => {
  if ($('device').value !== 'custom') {
    const [width, height] = $('device').value.split(',').map(Number);
    project.viewport = {...project.viewport, width, height};
    $('vp-width').value = width;
    $('vp-height').value = height;
    resizePreview();
    changed();
  }
});
for (const id of ['vp-width', 'vp-height']) $(id).addEventListener('change', () => {
  project.viewport = normalizeViewport({width: $('vp-width').value, height: $('vp-height').value, zoom: $('zoom').value});
  $('vp-width').value = project.viewport.width;
  $('vp-height').value = project.viewport.height;
  syncDevice();
  resizePreview();
  changed();
});
$('zoom').addEventListener('change', () => { project.viewport.zoom = $('zoom').value; resizePreview(); saveDraft(true); });
new ResizeObserver(resizePreview).observe($('stage'));

function switchView(view) {
  document.querySelector('.workspace').dataset.view = view;
  document.querySelectorAll('.mobile-tabs button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  requestAnimationFrame(resizePreview);
}
document.querySelectorAll('.mobile-tabs button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('focus-preview').addEventListener('click', () => {
  const focused = document.body.classList.toggle('preview-focus');
  $('focus-preview').textContent = focused ? '↙ 返回编辑' : '⛶ 展开';
  requestAnimationFrame(resizePreview);
});

editor.addEventListener('input', () => {
  changed();
  clearTimeout(historyTimer);
  historyTimer = setTimeout(recordHistory, 450);
});
editor.addEventListener('scroll', () => $('line-numbers').scrollTop = editor.scrollTop);
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText('  ', start, editor.selectionEnd, 'end');
    changed();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); moveHistory(event.shiftKey ? 1 : -1); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); moveHistory(1); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDraft(); }
});
$('undo').addEventListener('click', () => moveHistory(-1));
$('redo').addEventListener('click', () => moveHistory(1));
$('save-draft').addEventListener('click', () => saveDraft());
$('project-name').addEventListener('input', () => changed());
$('refresh-preview').addEventListener('click', renderPreview);
$('clear-selection').addEventListener('click', () => {
  selectedNode = null;
  $('element-panel').hidden = true;
  $('selected-element').textContent = '点预览中的元素，可视化调节它';
  sendPreview('clear');
});
$('edit-mode').addEventListener('change', () => { editMode = $('edit-mode').checked; sendPreview('edit-mode', {enabled: editMode}); });

for (const id of ['sample-user', 'sample-char']) $(id).addEventListener('input', () => {
  project.placeholders = {user: $('sample-user').value, char: $('sample-char').value};
  $('placeholder-user').value = $('sample-user').value;
  changed();
});
$('placeholder-user').addEventListener('input', () => {
  $('sample-user').value = $('placeholder-user').value;
  project.placeholders.user = $('placeholder-user').value;
  changed();
});

function download(contents, name, type) {
  const blob = new Blob([contents], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function filename() {
  return ($('project-name').value.trim() || '我的开场白').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
}

$('download-html').addEventListener('click', () => download(editor.value, filename() + '.html', 'text/html'));
$('export-project').addEventListener('click', () => download(JSON.stringify(snapshot(), null, 2) + '\n', filename() + '.html-workbench.json', 'application/json'));
$('copy-html').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.value);
    toast('HTML 已复制，可以粘贴回酒馆');
  } catch {
    editor.focus();
    editor.select();
    switchView('code');
    toast('自动复制不可用，已帮你选中全部代码');
  }
});

$('import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      project = normalizeProject(JSON.parse(text));
      syncProject();
      changed({immediate: true});
      toast('工程已恢复');
    } else {
      $('project-name').value = file.name.replace(/\.(html?|txt)$/i, '') || '我的开场白';
      setCode(text, {immediate: true});
      toast('HTML 已导入');
    }
  } catch (error) {
    toast(error.message || '文件读取失败');
  } finally {
    event.target.value = '';
  }
});

$('open-templates').addEventListener('click', () => $('template-dialog').showModal());
$('close-templates').addEventListener('click', () => $('template-dialog').close());
document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => {
  setCode(TEMPLATES[button.dataset.template], {immediate: true});
  $('template-dialog').close();
  toast('模板已放入工作台，可以直接换素材和修改文字');
}));

$('format-code').addEventListener('click', () => {
  const documentNode = parseSource();
  const formatted = serializeSource(documentNode).replace(/>\s*</g, '>\n<');
  setCode(formatted, {immediate: true});
  toast('已按标签分行，复杂排版请继续在代码里微调');
});

function syncProject() {
  $('project-name').value = project.name;
  editor.value = project.html;
  project.viewport = normalizeViewport(project.viewport);
  $('vp-width').value = project.viewport.width;
  $('vp-height').value = project.viewport.height;
  $('zoom').value = project.viewport.zoom;
  $('sample-user').value = project.placeholders.user;
  $('sample-char').value = project.placeholders.char;
  $('placeholder-user').value = project.placeholders.user;
  syncDevice();
  updateLines();
  history = [];
  historyIndex = -1;
  recordHistory();
  renderAssetList();
  resizePreview();
  renderPreview();
}

window.addEventListener('pagehide', () => { if (db) saveDraft(true); });

try {
  db = await openDB();
  const draft = await draftRequest('readonly');
  if (draft) {
    project = normalizeProject(draft);
    $('save-state').textContent = '已恢复本机草稿';
  } else {
    $('save-state').textContent = '新作品 · 自动保存到本机';
  }
} catch {
  $('save-state').textContent = '本机存储不可用，请备份工程';
}
syncProject();
