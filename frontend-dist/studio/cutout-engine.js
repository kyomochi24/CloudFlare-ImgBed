// U2-NetP inference runs on the visitor's device. No source image leaves the browser until saved to an album.
import * as ort from './vendor/ort/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = '/studio/vendor/ort/';
ort.env.wasm.numThreads = 1;
let sessionPromise;

function session() {
  sessionPromise ||= ort.InferenceSession.create('/studio/models/u2netp.onnx', { executionProviders: ['wasm'] });
  return sessionPromise;
}
export const prepareModel = () => session();

function pngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成透明 PNG')), 'image/png'));
}

export async function removeBackground(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width, height = bitmap.height;
    if (!width || !height || width * height > 20000000) throw new Error('图片像素过大，请使用 2000 万像素以内的图片');
    const side = 320;
    const small = document.createElement('canvas'); small.width = side; small.height = side;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, side, side);
    const rgba = ctx.getImageData(0, 0, side, side).data;
    let maximum = 1;
    for (let i = 0; i < rgba.length; i += 4) maximum = Math.max(maximum, rgba[i], rgba[i + 1], rgba[i + 2]);
    const input = new Float32Array(3 * side * side);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < side * side; i++) for (let c = 0; c < 3; c++) input[c * side * side + i] = (rgba[i * 4 + c] / maximum - mean[c]) / std[c];
    const model = await session();
    const output = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, side, side]) });
    const mask = output[model.outputNames[0]].data;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < side * side; i++) { min = Math.min(min, mask[i]); max = Math.max(max, mask[i]); }
    const maskCanvas = document.createElement('canvas'); maskCanvas.width = side; maskCanvas.height = side;
    const maskCtx = maskCanvas.getContext('2d');
    const maskImage = maskCtx.createImageData(side, side);
    const divisor = max > min ? max - min : 1;
    for (let i = 0; i < side * side; i++) {
      const alpha = Math.round(255 * (mask[i] - min) / divisor);
      maskImage.data.set([alpha, alpha, alpha, 255], i * 4);
    }
    maskCtx.putImageData(maskImage, 0, 0);
    const full = document.createElement('canvas'); full.width = width; full.height = height;
    const fullCtx = full.getContext('2d', { willReadFrequently: true });
    fullCtx.drawImage(bitmap, 0, 0);
    const original = fullCtx.getImageData(0, 0, width, height);
    fullCtx.clearRect(0, 0, width, height);
    fullCtx.imageSmoothingEnabled = true;
    fullCtx.imageSmoothingQuality = 'high';
    fullCtx.drawImage(maskCanvas, 0, 0, width, height);
    const enlarged = fullCtx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < original.data.length; i += 4) original.data[i + 3] = Math.round(original.data[i + 3] * enlarged[i] / 255);
    fullCtx.putImageData(original, 0, 0);
    return pngBlob(full);
  } finally { bitmap.close(); }
}
