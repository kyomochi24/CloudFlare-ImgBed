import { imageLinks, replaceLinks, renameTheme } from './theme-utils.js';

const COLOR = /#[\da-f]{3,8}\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0?\.\d+|1(?:\.0+)?|0))?\s*\)/gi;
const NAMED_COLORS = { white:'#ffffff', black:'#000000', red:'#ff0000', green:'#008000', blue:'#0000ff', yellow:'#ffff00', pink:'#ffc0cb', purple:'#800080', gray:'#808080', grey:'#808080', orange:'#ffa500', navy:'#000080', teal:'#008080', silver:'#c0c0c0', gold:'#ffd700', aqua:'#00ffff', lime:'#00ff00', maroon:'#800000' };
const NAMED = /\b(?:white|black|red|green|blue|yellow|pink|purple|gray|grey|orange|navy|teal|silver|gold|aqua|lime|maroon)\b(?!-)/gi;
function colorLabel(value, path, offset) {
  if (path.at(-1) !== 'custom_css') return path.join(' › ');
  const declaration = value.slice(Math.max(0, offset - 500), offset).split(/[;{}]/).at(-1);
  const property = declaration.match(/([\p{L}_-][\p{L}\p{N}_-]*)\s*:\s*[^:;{}]*$/u)?.[1];
  return property ? `CSS › ${property}` : 'CSS › 未命名颜色';
}

export function colorHex(value) {
  if (NAMED_COLORS[value.toLowerCase()]) return NAMED_COLORS[value.toLowerCase()];
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) return `#${[...hex.slice(0, 3)].map(c => c + c).join('')}`.toLowerCase();
    return `#${hex.slice(0, 6)}`.toLowerCase();
  }
  const rgb = value.match(/\d{1,3}/g)?.slice(0, 3).map(n => Math.min(255, Number(n))) || [0, 0, 0];
  return `#${rgb.map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

export function colorRgb(value) {
  const hex = colorHex(value);
  return `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`;
}

export function inspectTheme(raw) {
  const theme = JSON.parse(raw);
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error('美化 JSON 顶层必须是对象');
  const colors = [];
  function walk(value, path) {
    if (typeof value === 'string') {
      const matches = [...value.matchAll(COLOR)];
      if (path.at(-1) === 'custom_css') matches.push(...value.matchAll(NAMED));
      matches.sort((a, b) => a.index - b.index);
      for (const match of matches) {
        const label = colorLabel(value, path, match.index);
        if (NAMED_COLORS[match[0].toLowerCase()] && label === 'CSS › 未命名颜色') continue;
        colors.push({ id: colors.length, path, start: match.index, original: match[0], hex: colorHex(match[0]), label });
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
    }
  }
  walk(theme, []);
  return { images: imageLinks(raw), colors, name: String(theme.name || '').trim() };
}

export function colorLike(original, hex) {
  if (NAMED_COLORS[original.toLowerCase()]) return hex;
  if (original.startsWith('#')) {
    const alpha = original.slice(1);
    return alpha.length === 4 ? `${hex}${alpha[3]}${alpha[3]}` : alpha.length === 8 ? `${hex}${alpha.slice(6)}` : hex;
  }
  const alpha = original.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([^)]*)\)/i)?.[1];
  return `${alpha === undefined ? 'rgb' : 'rgba'}(${colorRgb(hex)}${alpha === undefined ? '' : `, ${alpha}`})`;
}

export function exportTheme(raw, name, images, changes) {
  const source = JSON.parse(raw);
  const { colors } = inspectTheme(raw);
  const groups = new Map();
  for (const color of colors) {
    const hex = changes.get(color.id);
    if (!hex || hex.toLowerCase() === color.hex || !/^#[\da-f]{6}$/i.test(hex)) continue;
    const key = JSON.stringify(color.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...color, next: colorLike(color.original, hex) });
  }
  for (const [key, group] of groups) {
    const path = JSON.parse(key); let container = source;
    for (const segment of path.slice(0, -1)) container = container[segment];
    const last = path.at(-1); let value = container[last];
    for (const color of group.reverse()) value = value.slice(0, color.start) + color.next + value.slice(color.start + color.original.length);
    container[last] = value;
  }
  return renameTheme(replaceLinks(JSON.stringify(source, null, 2), images), name);
}
