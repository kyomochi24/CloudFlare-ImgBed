// SPDX-License-Identifier: AGPL-3.0-or-later

const FONT_EXT = /\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i;
const AUDIO_EXT = /\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)(?:[?#].*)?$/i;

export function safeResourceUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^data:(?:image|audio|video|font)\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)) return value;
  try {
    const parsed = new URL(value, 'https://qiuqiu-preview.invalid/');
    if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) return '';
    return parsed.origin === 'https://qiuqiu-preview.invalid' ? value : parsed.href;
  } catch {
    return '';
  }
}

export function classifyAsset(url, context = '') {
  const value = String(url || '');
  const hint = String(context || '').toLowerCase();
  if (FONT_EXT.test(value) || /^data:font\//i.test(value) || /font-face/.test(hint)) return 'font';
  if (AUDIO_EXT.test(value) || /^data:audio\//i.test(value) || /<audio\b|type\s*=\s*["']audio\//.test(hint)) return 'music';
  if (VIDEO_EXT.test(value) || /^data:video\//i.test(value) || /<video\b|type\s*=\s*["']video\//.test(hint)) return 'video';
  return 'image';
}

function nearestTag(source, index) {
  const start = source.lastIndexOf('<', index);
  const end = source.indexOf('>', start);
  return start >= 0 && end >= index ? source.slice(start, Math.min(end + 1, start + 400)) : '';
}

export function scanAssets(source) {
  const html = String(source || '');
  const occurrences = [];
  const add = (url, start, end, context, kind) => {
    const clean = String(url || '').trim();
    if (!safeResourceUrl(clean) || clean.startsWith('https://qiuqiu-preview.invalid/')) return;
    if (occurrences.some(item => item.start === start && item.end === end)) return;
    occurrences.push({url: clean, start, end, context, type: classifyAsset(clean, context), kind});
  };

  const attributePattern = /(?<![\w:-])(src|poster)\s*=\s*(["'])(.*?)\2/gis;
  for (const match of html.matchAll(attributePattern)) {
    const tag = nearestTag(html, match.index);
    if (!/^<[a-z]/i.test(tag)) continue;
    const relative = match[0].indexOf(match[2]) + 1;
    const start = match.index + relative;
    const kind = match[1].toLowerCase();
    add(match[3], start, start + match[3].length, kind === 'poster' ? '' : tag, kind);
  }

  const cssPattern = /url\((\s*)(["']?)(.*?)\2\s*\)/gis;
  for (const match of html.matchAll(cssPattern)) {
    const value = match[3];
    const relative = 4 + match[1].length + match[2].length;
    const start = match.index + relative;
    const contextStart = Math.max(0, html.lastIndexOf('}', match.index) + 1);
    add(value, start, start + value.length, html.slice(contextStart, match.index + match[0].length), 'css');
  }

  occurrences.sort((a, b) => a.start - b.start);
  const grouped = new Map();
  for (const occurrence of occurrences) {
    const current = grouped.get(occurrence.url) || {
      key: occurrence.url,
      url: occurrence.url,
      type: occurrence.type,
      occurrences: []
    };
    if (current.type === 'image' && occurrence.type !== 'image') current.type = occurrence.type;
    current.occurrences.push(occurrence);
    grouped.set(occurrence.url, current);
  }
  return [...grouped.values()];
}

export function replaceAssetUrl(source, oldUrl, newUrl, options = {}) {
  const html = String(source || '');
  const replacement = String(newUrl || '').trim();
  if (!safeResourceUrl(replacement)) throw new Error('新的素材地址不可用');
  const asset = scanAssets(html).find(item => item.url === oldUrl);
  if (!asset) return html;
  const requested = Number.isInteger(options.occurrence) ? options.occurrence : 0;
  const targets = options.all === false ? asset.occurrences.slice(requested, requested + 1) : asset.occurrences;
  let output = html;
  for (const item of [...targets].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, item.start) + replacement + output.slice(item.end);
  }
  return output;
}

export function displayAssetName(url) {
  const value = String(url || '');
  if (value.startsWith('data:')) return '嵌入式素材';
  try {
    const parsed = new URL(value, 'https://qiuqiu-preview.invalid/');
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
    return name.length > 54 ? name.slice(0, 51) + '…' : name;
  } catch {
    return value.slice(0, 54) || '未命名素材';
  }
}

export function normalizeViewport(viewport = {}) {
  viewport ??= {};
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };
  return {
    width: clamp(viewport.width, 260, 1600, 390),
    height: clamp(viewport.height, 320, 1600, 760),
    zoom: ['fit', '0.5', '0.75', '1'].includes(String(viewport.zoom)) ? String(viewport.zoom) : 'fit'
  };
}

export function freshProject() {
  return {
    kind: 'qiuqiu-html-workbench',
    version: 1,
    name: '我的开场白',
    html: DEFAULT_HTML,
    viewport: {width: 390, height: 760, zoom: 'fit'},
    placeholders: {user: '你', char: '浅浅丘'}
  };
}

export function normalizeProject(raw) {
  const base = freshProject();
  if (!raw || raw.kind !== base.kind || raw.version !== 1 || typeof raw.html !== 'string') {
    throw new Error('这不是丘丘 HTML 工作台工程');
  }
  return {
    ...base,
    name: String(raw.name || base.name).slice(0, 100),
    html: raw.html,
    viewport: normalizeViewport(raw.viewport),
    placeholders: {
      user: String(raw.placeholders?.user || base.placeholders.user).slice(0, 60),
      char: String(raw.placeholders?.char || base.placeholders.char).slice(0, 60)
    }
  };
}

export const DEFAULT_HTML = `<style>
.opening-card {
  max-width: 620px;
  margin: 18px auto;
  padding: 22px;
  color: #5c4b52;
  border: 1px solid #efd3dc;
  border-radius: 22px;
  background: linear-gradient(145deg, #fffaf6, #fff0f5);
  box-shadow: 0 10px 26px rgba(169, 111, 137, .16);
  font-family: system-ui, sans-serif;
}
.opening-card h2 { margin: 0 0 10px; color: #b86688; }
.status-bar {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255,255,255,.75);
}
.status-bar span { flex: 1; text-align: center; }
</style>

<section class="opening-card">
  <h2>{{char}} · 今日记录</h2>
  <p>欢迎回来，{{user}}。把喜欢的图片、字体和音乐都放进这里吧。</p>
  <div class="status-bar">
    <span>♡ 心情很好</span>
    <span>☀ 天气晴朗</span>
  </div>
</section>`;

export const TEMPLATES = {
  opening: DEFAULT_HTML,
  status: `<style>
.character-status{max-width:580px;margin:16px auto;padding:16px;border-radius:18px;background:#fff8f0;color:#604f54;font-family:system-ui,sans-serif;box-shadow:0 8px 24px #bc879226}
.character-status header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.character-status img{width:64px;height:64px;object-fit:cover;border-radius:50%;background:#f2dce5}
.character-status h3{margin:0;color:#b86382}.character-status small{color:#9b7d89}
.status-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.status-grid div{padding:10px;border-radius:12px;background:#fff}
</style>
<section class="character-status">
  <header><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' rx='64' fill='%23f2dce5'/%3E%3Ctext x='128' y='156' text-anchor='middle' font-size='96' fill='%23a95f7b'%3E%E2%99%A1%3C/text%3E%3C/svg%3E" alt="角色头像"><div><h3>{{char}}</h3><small>与 {{user}} 的故事</small></div></header>
  <div class="status-grid"><div>地点 · 甜品屋</div><div>时间 · 午后</div><div>心情 · 开心</div><div>好感 · 72%</div></div>
</section>`
};
