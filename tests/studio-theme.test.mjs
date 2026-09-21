import assert from 'node:assert/strict';
import test from 'node:test';
import { imageLinks, replaceLinks } from '../frontend-dist/studio/theme-utils.js';

test('finds unique image URLs and skips stylesheet and font URLs', () => {
  const raw = JSON.stringify({ css: '@import url(https://font.example/theme.css); background:url(https://iili.io/a.png); border:url(https://iili.io/a.png)', icon: 'https://i.postimg.cc/b.webp?x=1', font: 'https://font.example/font.woff2' });
  assert.deepEqual(imageLinks(raw), ['https://iili.io/a.png', 'https://i.postimg.cc/b.webp?x=1']);
});

test('replaces all occurrences without changing the JSON structure', () => {
  const raw = JSON.stringify({ css: 'url(https://iili.io/a.png)', icon: 'https://iili.io/a.png' }, null, 2);
  const changed = replaceLinks(raw, new Map([['https://iili.io/a.png', 'https://771553.xyz/file/new.png']]));
  assert.equal(JSON.parse(changed).icon, 'https://771553.xyz/file/new.png');
  assert.match(JSON.parse(changed).css, /771553\.xyz/);
  assert.match(changed, /\n  "css"/);
});

test('rejects invalid JSON before import', () => assert.throws(() => imageLinks('{oops')));
