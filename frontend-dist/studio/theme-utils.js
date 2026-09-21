export function imageLinks(raw) {
  JSON.parse(raw);
  const urls = raw.match(/https?:\/\/[^\s"'\\()<>]+/g) || [];
  const unique = new Set();
  for (const candidate of urls) {
    const link = candidate.replace(/[;,}]+$/, '');
    try {
      const url = new URL(link);
      if (/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(url.pathname)) unique.add(link);
    } catch { /* Ignore malformed links. */ }
  }
  return [...unique];
}

export function replaceLinks(raw, replacements) {
  let changed = raw;
  for (const [oldUrl, newUrl] of replacements) {
    changed = changed.split(oldUrl).join(newUrl);
    changed = changed.split(oldUrl.replaceAll('/', '\\/')).join(newUrl.replaceAll('/', '\\/'));
  }
  JSON.parse(changed);
  return changed;
}

export function renameTheme(raw, name) {
  const theme = JSON.parse(raw);
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error('美化 JSON 顶层必须是对象');
  const title = String(name || '').trim();
  if (!title) throw new Error('请填写搬家后的美化名称');
  theme.name = title;
  const indent = raw.match(/\r?\n([ \t]+)"/)?.[1] || '  ';
  return JSON.stringify(theme, null, indent) + (/\r?\n$/.test(raw) ? '\n' : '');
}
