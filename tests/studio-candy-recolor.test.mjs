import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecolorTransform, DEFAULT_RECOLOR, hexToHsl, rgbToHsl, sampleColor } from '../frontend-dist/studio/candy-recolor.js';

const pixels = (...rgb) => new Uint8ClampedArray(rgb.flat());
const pink = [237, 143, 182, 255];
const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('pink turns green while blue, white, gray and alpha are unchanged', () => {
  const data = pixels(pink, [40, 120, 230, 255], [255, 255, 255, 255], [155, 155, 155, 255], [237, 143, 182, 73], [237, 143, 182, 0]);
  const original = data.slice();
  createRecolorTransform()(data);
  assert.ok(hueDistance(rgbToHsl(...data.slice(0, 3))[0], hexToHsl(DEFAULT_RECOLOR.target)[0]) < 1);
  assert.deepEqual(data.slice(4, 16), original.slice(4, 16));
  assert.equal(data[19], 73);
  assert.deepEqual(data.slice(20), original.slice(20));
});

test('lightness and contrast survive replacement across light and dark pink', () => {
  const data = pixels([246, 202, 221, 255], [174, 45, 100, 255]);
  const before = [rgbToHsl(...data.slice(0, 3))[2], rgbToHsl(...data.slice(4, 7))[2]];
  createRecolorTransform()(data);
  const after = [rgbToHsl(...data.slice(0, 3))[2], rgbToHsl(...data.slice(4, 7))[2]];
  assert.ok(after[0] > after[1]);
  before.forEach((l, i) => assert.ok(Math.abs(l - after[i]) < 1 / 255));
});

test('hue matching wraps around red at zero degrees', () => {
  const data = pixels([255, 12, 0, 255]);
  createRecolorTransform({ source: '#ff000c', target: '#00ff00', range: 12, softness: 50 })(data);
  assert.ok(hueDistance(rgbToHsl(...data)[0], 126) < 1, 'keeps the small hue offset from the sampled red');
});

test('range narrows selection and soft edges blend without a hard cutoff', () => {
  const candidate = pixels([237, 143, 150, 255]);
  const narrow = candidate.slice(), wide = candidate.slice(), soft = candidate.slice();
  createRecolorTransform({ ...DEFAULT_RECOLOR, range: 5 })(narrow);
  createRecolorTransform({ ...DEFAULT_RECOLOR, range: 30, softness: 0 })(wide);
  createRecolorTransform({ ...DEFAULT_RECOLOR, range: 30, softness: 100 })(soft);
  assert.deepEqual(narrow, candidate);
  assert.notDeepEqual(wide, candidate);
  const difference = a => a.slice(0, 3).reduce((sum, v, i) => sum + Math.abs(v - candidate[i]), 0);
  assert.ok(difference(soft) > 0 && difference(soft) < difference(wide));
});

test('mask is visual only and does not change alpha', () => {
  const original = pixels(pink, [40, 120, 230, 90]);
  const mask = original.slice();
  createRecolorTransform(DEFAULT_RECOLOR, true)(mask);
  assert.deepEqual([...mask.slice(0, 3)], [243, 111, 162]);
  assert.equal(mask[4], mask[5]); assert.equal(mask[5], mask[6]); assert.equal(mask[7], 90);
  assert.deepEqual([...original.slice(0, 4)], pink);
});

test('transparent neighboring RGB is excluded from sampled color', () => {
  const data = pixels([237, 143, 182, 255], [0, 255, 0, 0], [0, 255, 0, 0]);
  assert.equal(sampleColor(data, 3, 1, 0, 0), '#ed8fb6');
  assert.throws(() => sampleColor(pixels([0, 0, 0, 0]), 1, 1, 0, 0), /透明/);
  assert.throws(() => sampleColor(pixels([200, 200, 200, 255]), 1, 1, 0, 0), /黑白灰/);
});

test('chunked export and whole-frame preview use identical transformations', () => {
  const before = pixels(pink, [255, 220, 235, 128], [100, 20, 55, 255], [0, 0, 255, 255]);
  const whole = before.slice(), chunks = before.slice();
  createRecolorTransform()(whole);
  const transform = createRecolorTransform();
  transform(chunks, 0, 8); transform(chunks, 8, chunks.length);
  assert.deepEqual(chunks, whole);
});
