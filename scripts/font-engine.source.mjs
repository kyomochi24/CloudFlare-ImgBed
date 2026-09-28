import { woffDecode, woffEncode, woff2Decode, woff2Encode } from 'woff-lib';
import opentype from 'opentype.js';
import fonteditor from 'fonteditor-core';

const text = (bytes, offset = 0) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
function sfntKind(bytes) {
  if (text(bytes) === 'OTTO') return 'otf';
  if (text(bytes) === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf';
  throw new Error('字体内部格式不受支持');
}
export function identifyFont(bytes) {
  if (bytes.byteLength < 12) throw new Error('这不是有效的字体文件');
  if (text(bytes) === 'wOFF') { sfntKind(bytes.subarray(4)); return 'woff'; }
  if (text(bytes) === 'wOF2') { sfntKind(bytes.subarray(4)); return 'woff2'; }
  return sfntKind(bytes);
}
export async function convertFont(input, target) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const source = identifyFont(bytes);
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(target)) throw new Error('目标格式不受支持');
  let sfnt = source === 'woff' ? await woffDecode(bytes) : source === 'woff2' ? await woff2Decode(bytes) : bytes;
  sfnt = new Uint8Array(sfnt);
  const outlines = sfntKind(sfnt);
  if (target === 'otf' && outlines !== 'otf') {
    // TrueType quadratic outlines must be rebuilt as CFF cubic outlines.
    const sourceFont = opentype.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength));
    const glyphs = Array.from({ length: sourceFont.numGlyphs }, (_, index) => sourceFont.glyphs.get(index));
    const built = new opentype.Font({
      familyName: sourceFont.getEnglishName('fontFamily') || 'Converted Font',
      styleName: sourceFont.getEnglishName('fontSubfamily') || 'Regular',
      unitsPerEm: sourceFont.unitsPerEm, ascender: sourceFont.ascender,
      descender: sourceFont.descender, glyphs
    });
    sfnt = new Uint8Array(built.toArrayBuffer());
  } else if (target === 'ttf' && outlines !== 'ttf') {
    // CFF cubic outlines must be rebuilt as TrueType quadratic outlines.
    const editable = fonteditor.Font.create(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength), { type: 'otf' });
    sfnt = new Uint8Array(editable.write({ type: 'ttf' }));
  }
  let result = target === 'woff' ? await woffEncode(sfnt) : target === 'woff2' ? woff2Encode(sfnt, { quality: 5 }) : sfnt;
  result = new Uint8Array(result);
  if (identifyFont(result) !== target) throw new Error('生成的文件格式校验失败');
  return result;
}
