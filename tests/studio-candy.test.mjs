import assert from 'node:assert/strict';
import test from 'node:test';
import { colorRgb, exportTheme, inspectTheme } from '../frontend-dist/studio/candy-utils.js';

test('finds theme images and independent RGB / hex colors in source order', () => {
  const raw = JSON.stringify({ name: '示例', text: 'rgba(44, 44, 44, 0.5)', css: 'color:#abc; background:url(https://iili.io/a.png); border:#abc' });
  const found = inspectTheme(raw);
  assert.deepEqual(found.images, ['https://iili.io/a.png']);
  assert.deepEqual(found.colors.map(color => color.hex), ['#2c2c2c', '#aabbcc', '#aabbcc']);
  assert.deepEqual(found.colors.map(color => color.path.join('.')), ['text', 'css', 'css']);
  assert.equal(colorRgb('rgba(44, 44, 44, 0.5)'), '44, 44, 44');
});

test('exports only selected changes, preserves alpha and original JSON', () => {
  const raw = JSON.stringify({ name: '原版', first: 'rgba(44, 44, 44, 0.5)', second: '#abc', css: 'border:#abc;url(https://iili.io/a.png)' });
  const changed = exportTheme(raw, '薄荷糖', new Map([['https://iili.io/a.png', 'https://771553.xyz/file/new.png']]), new Map([[0, '#99ccaa'], [2, '#ff0000']]));
  assert.equal(JSON.parse(raw).name, '原版');
  const output = JSON.parse(changed);
  assert.equal(output.name, '薄荷糖');
  assert.equal(output.first, 'rgba(153, 204, 170, 0.5)');
  assert.equal(output.second, '#abc');
  assert.equal(output.css, 'border:#ff0000;url(https://771553.xyz/file/new.png)');
});

test('labels colors by CSS variable or property inside custom_css', () => {
  const raw = JSON.stringify({ custom_css: ':root { --紫藤-墨: #314348; } .mes { border: 1px solid rgba(71, 124, 150, .5); }' });
  const colors = inspectTheme(raw).colors;
  assert.deepEqual(colors.map(color => color.label), ['CSS › --紫藤-墨', 'CSS › border']);
  assert.equal(JSON.parse(exportTheme(raw, '新版本', new Map(), new Map([[1, '#abcabc']]))).custom_css.includes('rgba(171, 202, 188, .5)'), true);
});

test('finds named white in multiline CSS values without treating white-space or transparent as editable colors', () => {
  const raw = JSON.stringify({ custom_css: '.a { white-space: nowrap; border: 1px solid white; box-shadow:\n  0 0 2px white,\n  0 0 3px #abc; background: transparent; }' });
  const colors = inspectTheme(raw).colors;
  assert.deepEqual(colors.map(color => [color.original, color.label]), [['white','CSS › border'],['white','CSS › box-shadow'],['#abc','CSS › box-shadow']]);
  const output = JSON.parse(exportTheme(raw, '测试', new Map(), new Map([[0, '#ffccaa']])));
  assert.match(output.custom_css, /border: 1px solid #ffccaa/);
  assert.match(output.custom_css, /background: transparent/);
});
