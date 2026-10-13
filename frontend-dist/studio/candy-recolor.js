// Shared by the small live preview and full-resolution PNG export.
export const DEFAULT_RECOLOR = Object.freeze({ source: '#ed8fb6', target: '#87c9a1', range: 30, softness: 50 });
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = (lo, hi, n) => { const t = clamp((n - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, section = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(section % 2 - 1)), m = l - c / 2;
  const rgb = section < 1 ? [c, x, 0] : section < 2 ? [x, c, 0] : section < 3 ? [0, c, x] : section < 4 ? [0, x, c] : section < 5 ? [x, 0, c] : [c, 0, x];
  return rgb.map(v => Math.round((v + m) * 255));
}
export function hexToHsl(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('请选择有效的颜色');
  return rgbToHsl(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
}
export function sampleColor(data, width, height, x, y) {
  // Average a small patch in premultiplied alpha; invisible RGB cannot pollute the sample.
  let r = 0, g = 0, b = 0, alpha = 0;
  x = clamp(Math.floor(x), 0, width - 1); y = clamp(Math.floor(y), 0, height - 1);
  for (let py = Math.max(0, y - 1); py <= Math.min(height - 1, y + 1); py++) {
    for (let px = Math.max(0, x - 1); px <= Math.min(width - 1, x + 1); px++) {
      const i = (py * width + px) * 4, a = data[i + 3] / 255;
      r += data[i] * a; g += data[i + 1] * a; b += data[i + 2] * a; alpha += a;
    }
  }
  if (!alpha) throw new Error('这里是透明区域，请点一下有颜色的地方');
  const rgb = [r, g, b].map(v => Math.round(v / alpha));
  const [, s, l] = rgbToHsl(...rgb);
  if (s < .04 || l < .015 || l > .985) throw new Error('这里接近黑白灰，请选择粉色等有色彩的区域');
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

export function protectionAt(protection, x, y) {
  if (!protection) return 0;
  const { width, height, data } = protection;
  x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const dx = x - x0, dy = y - y0;
  return ((data[y0 * width + x0] * (1 - dx) + data[y0 * width + x1] * dx) * (1 - dy) +
    (data[y1 * width + x0] * (1 - dx) + data[y1 * width + x1] * dx) * dy) / 255;
}

export function drawProtectionMask(canvas, strokes = []) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!Array.isArray(stroke.points) || !stroke.points.length) continue;
    ctx.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    const diameter = clamp(Number(stroke.size) || .08, .01, .5) * Math.min(canvas.width, canvas.height);
    const point = p => [clamp(p[0]) * canvas.width, clamp(p[1]) * canvas.height];
    const [x, y] = point(stroke.points[0]);
    ctx.lineWidth = diameter;
    ctx.beginPath(); ctx.arc(x, y, diameter / 2, 0, Math.PI * 2); ctx.fill();
    if (stroke.points.length > 1) {
      ctx.beginPath(); ctx.moveTo(x, y);
      for (const p of stroke.points.slice(1)) ctx.lineTo(...point(p));
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function rasterizeProtection(width, height, strokes) {
  if (!strokes?.length) return null;
  // The small alpha mask keeps large PNG exports within a reasonable memory budget.
  // Vector strokes are normalized, so preview and export cover the same image region.
  const ratio = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  drawProtectionMask(canvas, strokes);
  const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  const protection = { width: canvas.width, height: canvas.height, data };
  canvas.width = 0; canvas.height = 0;
  return protection;
}

export function createRecolorTransform(rule = DEFAULT_RECOLOR, mask = false, { protection = null, width, height } = {}) {
  const rules = (Array.isArray(rule) ? rule : [rule]).map(value => {
    const [sourceHue, sourceSat] = hexToHsl(value.source);
    const [targetHue, targetSat] = hexToHsl(value.target), range = clamp(Number(value.range) || 30, 5, 85);
    const softness = clamp(Number(value.softness) / 100);
    return {sourceHue,sourceSat,targetSat,range,softness,inner:range*(1-.95*softness),
      hueDelta:((targetHue-sourceHue+540)%360)-180,minSat:Math.min(.12,Math.max(.025,sourceSat*.18))};
  });
  return (data, start = 0, end = data.length) => {
    for (let i = start; i < end; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      // Match every rule against the ORIGINAL pixel. A pink -> blue result must not
      // be caught again by a separate blue -> green rule.
      let chosen = null, match = 0, nearest = Infinity;
      for (const settings of rules) {
        const {sourceHue,sourceSat,range,softness,inner,minSat} = settings;
        const distance = Math.abs(((h - sourceHue + 540) % 360) - 180);
        const hueWeight = softness === 0 ? Number(distance <= range) : 1 - smooth(inner, range, distance);
        const amount = sourceSat < .04 ? 0 : hueWeight * smooth(minSat,minSat*2,s);
        if (amount > match || (amount > 0 && amount === match && distance < nearest)) {
          chosen = settings; match = amount; nearest = distance;
        }
      }
      const pixel = i / 4;
      const protectedAmount = protection ? protectionAt(protection,
        (pixel % width + .5) * protection.width / width - .5,
        (Math.floor(pixel / width) + .5) * protection.height / height - .5) : 0;
      const weight = (1 - protectedAmount) * match * smooth(0, .02, l) * (1 - smooth(.97, 1, l));
      if (mask) {
        const gray = .2126 * r + .7152 * g + .0722 * b;
        data[i] = gray * (1 - weight) + 243 * weight;
        data[i + 1] = gray * (1 - weight) + 111 * weight;
        data[i + 2] = gray * (1 - weight) + 162 * weight;
      } else if (weight > 0) {
        // Retain the original lightness, texture and variation within the chosen color family.
        const changed = hslToRgb(h + chosen.hueDelta, clamp(s + chosen.targetSat - chosen.sourceSat), l);
        data[i] = r + (changed[0] - r) * weight;
        data[i + 1] = g + (changed[1] - g) * weight;
        data[i + 2] = b + (changed[2] - b) * weight;
      }
    }
    return data;
  };
}

export async function recolorCanvas(canvas, rule, { mask = false, yieldToUI = false, strokes = [] } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('浏览器无法创建画布');
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const protection = rasterizeProtection(canvas.width, canvas.height, strokes);
  const transform = createRecolorTransform(rule, mask, { protection, width: canvas.width, height: canvas.height });
  const chunk = 4 * 131072;
  for (let start = 0; start < frame.data.length; start += chunk) {
    transform(frame.data, start, Math.min(start + chunk, frame.data.length));
    if (yieldToUI) await new Promise(resolve => setTimeout(resolve, 0));
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}
