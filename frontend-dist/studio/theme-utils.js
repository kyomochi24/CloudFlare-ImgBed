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
