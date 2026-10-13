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

export function createRecolorTransform(rule = DEFAULT_RECOLOR, mask = false) {
  const [sourceHue, sourceSat] = hexToHsl(rule.source);
  const [targetHue, targetSat] = hexToHsl(rule.target);
  const range = clamp(Number(rule.range) || 30, 5, 85);
  const softness = clamp(Number(rule.softness) / 100);
  const inner = range * (1 - .95 * softness);
  const hueDelta = ((targetHue - sourceHue + 540) % 360) - 180;
  const minSat = Math.min(.12, Math.max(.025, sourceSat * .18));
  return (data, start = 0, end = data.length) => {
    for (let i = start; i < end; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const distance = Math.abs(((h - sourceHue + 540) % 360) - 180);
      const hueWeight = softness === 0 ? Number(distance <= range) : 1 - smooth(inner, range, distance);
      const weight = sourceSat < .04 ? 0 : hueWeight * smooth(minSat, minSat * 2, s) * smooth(0, .02, l) * (1 - smooth(.97, 1, l));
      if (mask) {
        const gray = .2126 * r + .7152 * g + .0722 * b;
        data[i] = gray * (1 - weight) + 243 * weight;
        data[i + 1] = gray * (1 - weight) + 111 * weight;
        data[i + 2] = gray * (1 - weight) + 162 * weight;
      } else if (weight > 0) {
        // Retain the original lightness, texture and variation within the chosen color family.
        const changed = hslToRgb(h + hueDelta, clamp(s + targetSat - sourceSat), l);
        data[i] = r + (changed[0] - r) * weight;
        data[i + 1] = g + (changed[1] - g) * weight;
        data[i + 2] = b + (changed[2] - b) * weight;
      }
    }
    return data;
  };
}

export async function recolorCanvas(canvas, rule, { mask = false, yieldToUI = false } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('浏览器无法创建画布');
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const transform = createRecolorTransform(rule, mask);
  const chunk = 4 * 131072;
  for (let start = 0; start < frame.data.length; start += chunk) {
    transform(frame.data, start, Math.min(start + chunk, frame.data.length));
    if (yieldToUI) await new Promise(resolve => setTimeout(resolve, 0));
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}
