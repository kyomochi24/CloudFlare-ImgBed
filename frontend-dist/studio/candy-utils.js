import { imageLinks, replaceLinks, renameTheme } from './theme-utils.js?v=20261015a';
import { cssDeclarations, cssColorText } from './css-utils.js?v=20261015a';

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

function toHsl(hex) {
  const rgb = [1, 3, 5].map(start => parseInt(colorHex(hex).slice(start, start + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  const light = (max + min) / 2;
  if (!delta) return [0, 0, light];
  const sat = delta / (1 - Math.abs(2 * light - 1));
  const hue = max === rgb[0] ? ((rgb[1] - rgb[2]) / delta) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
  return [((hue * 60) + 360) % 360, sat, light];
}

function fromHsl(hue, sat, light) {
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const section = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  const channels = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${channels.map(channel => Math.round((channel + light - chroma / 2) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// Apply the HSL difference A -> B to another original color. Alpha is retained by colorLike during export.
export function mapColor(original, sampleBefore, sampleAfter) {
  const [aHue, aSat, aLight] = toHsl(sampleBefore);
  const [bHue, bSat, bLight] = toHsl(sampleAfter);
  const [hue, sat, light] = toHsl(original);
  const hueDelta = ((bHue - aHue + 540) % 360) - 180;
  const clamp = value => Math.max(0, Math.min(1, value));
  return fromHsl(hue + hueDelta, clamp(sat + bSat - aSat), clamp(light + bLight - aLight));
}

export function isNeutralColor(hex) {
  const [,sat,light]=toHsl(hex),chroma=(1-Math.abs(2*light-1))*sat;
  return sat<=.1||light<=.015||(light>=.97&&chroma<=.025);
}
export function familyMatches(color, sample, {range=30,scope='text',protectNeutral=true}={}) {
  if(scope==='text'&&color.scope!=='text')return false;
  if(protectNeutral&&isNeutralColor(color.hex))return false;
  const [h,s]=toHsl(color.hex),[sourceHue,sourceSat]=toHsl(sample);
  if(sourceSat<.04)return false;
  return s>=.04&&Math.abs(((h-sourceHue+540)%360)-180)<=Math.max(5,Math.min(85,range));
}
export function mapFamilyColor(original, sampleBefore, sampleAfter) {
  const [h,s,l]=toHsl(original),[aH,aS]=toHsl(sampleBefore),[bH,bS]=toHsl(sampleAfter);
  return fromHsl(h+((bH-aH+540)%360)-180,Math.max(0,Math.min(1,s+bS-aS)),l);
}
const TEXT_PROPERTIES=new Set(['color','-webkit-text-fill-color','-webkit-text-stroke','-webkit-text-stroke-color','text-decoration-color','text-emphasis-color','caret-color']);
function colorScope(path,property){
  if(path.at(-1)==='custom_css')return TEXT_PROPERTIES.has(property?.toLowerCase())?'text':'style';
  return /(?:text_color|^text$|^color$)/i.test(path.at(-1)||'')?'text':'style';
}
export function inspectTheme(raw,{legacy=false}={}) {
  const theme = JSON.parse(raw);
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error('美化 JSON 顶层必须是对象');
  const colors = [];
  function walk(value, path) {
    if (typeof value === 'string') {
      let matches=[];
      if(path.at(-1)==='custom_css'&&!legacy){
        const masked=cssColorText(value);
        for(const declaration of cssDeclarations(value)){
          if(!/^--|color|background|border|shadow|outline|fill|stroke|filter/i.test(declaration.property))continue;
          const segment=masked.slice(declaration.start,declaration.end);
          for(const match of [...segment.matchAll(COLOR),...segment.matchAll(NAMED)]){
            if(NAMED_COLORS[match[0].toLowerCase()]&&/[\w-]/.test(segment[match.index-1]||''))continue;
            match.index+=declaration.start;match.property=declaration.property;matches.push(match);
          }
        }
      }else{
        matches=[...value.matchAll(COLOR)];
        if(path.at(-1)==='custom_css')matches.push(...value.matchAll(NAMED));
      }
      matches.sort((a, b) => a.index - b.index);
      for (const match of matches) {
        const label = match.property ? 'CSS › '+match.property : colorLabel(value, path, match.index);
        if (NAMED_COLORS[match[0].toLowerCase()] && label === 'CSS › 未命名颜色') continue;
        colors.push({ id: colors.length, path, start: match.index, original: match[0], hex: colorHex(match[0]), label, property:match.property||'',scope:colorScope(path,match.property) });
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
    }
  }
  walk(theme, []);
  return { images: imageLinks(raw), colors, name: String(theme.name || '').trim() };
}

export function migrateColorChanges(raw,changes){
  const old=inspectTheme(raw,{legacy:true}).colors,current=inspectTheme(raw).colors;
  const key=c=>JSON.stringify([c.path,c.start,c.original]),ids=new Map(current.map(c=>[key(c),c.id])),next={};
  for(const [id,value]of Object.entries(changes||{})){const color=old[Number(id)];if(!color)continue;const mapped=ids.get(key(color));if(mapped!==undefined)next[mapped]=value;}
  return next;
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

