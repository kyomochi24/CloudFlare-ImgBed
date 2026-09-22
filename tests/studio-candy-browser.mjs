import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../frontend-dist/studio/', import.meta.url));
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!existsSync(chrome)) { process.stdout.write('Candy browser smoke skipped: Chrome is not installed.\n'); process.exit(0); }
const source = await readFile(join(root, 'index.html'), 'utf8');
const section = source.match(/<section class="card candy-card">[\s\S]*?<\/section>/)?.[0];
assert.ok(section, 'Candy editor section exists');
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/studio/style.css"><link rel="stylesheet" href="/studio/candy.css"><body><main class="shell"><div id="notice"></div>${section}</main><script type="module">
import { initCandy } from '/studio/candy.js';
const state = {user:{id:'browser-test',tier:'pichu'},albumId:'album',albums:[]};
const api = async path => path === 'candy/quota' ? {used:0,dailyLimit:2,remaining:2} : {id:'album'};
const candy = initCandy({api,state,refreshProfile:async()=>{},refreshAlbums:async()=>{},notice:message=>{document.querySelector('#notice').textContent=message}});
await candy.refreshQuota();
const input=document.querySelector('#candy-input'), transfer=new DataTransfer();
transfer.items.add(new File([JSON.stringify({name:'示例',text:'rgba(44, 44, 44, 0.5)',photo:'https://iili.io/test.png'})], 'example.json', {type:'application/json'}));
input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
await new Promise(resolve=>setTimeout(resolve,300));
const color=document.querySelector('[data-color="0"]'); color.value='#99ccaa'; color.dispatchEvent(new Event('input',{bubbles:true}));
document.querySelector('#candy-hue').value='45'; document.querySelector('#candy-hue').dispatchEvent(new Event('input',{bubbles:true}));
document.body.dataset.smoke=JSON.stringify({editor:!document.querySelector('#candy-editor').classList.contains('hidden'),images:document.querySelectorAll('[data-image-row]').length,colors:document.querySelectorAll('[data-color-row]').length,rgb:document.querySelector('[data-color-row] code').textContent,filter:document.querySelector('[data-after]').style.filter});
</script></body></html>`;
const server = createServer(async (request, response) => {
  if (request.url === '/smoke') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture); return; }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (/^\/studio\/(candy\.js|candy-utils\.js|theme-utils\.js|style\.css|candy\.css)$/.test(pathname)) {
    const file = join(root, pathname.slice('/studio/'.length));
    response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await readFile(file)); return;
  }
  response.statusCode = 404; response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'candy-browser-'));
try {
  const address = `http://127.0.0.1:${server.address().port}/smoke`;
  const browser = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu',`--user-data-dir=${profile}`,'--virtual-time-budget=3000','--dump-dom',address], { windowsHide: true });
  const deadline = setTimeout(() => browser.kill(), 20000);
  let html = '', stderr = '';
  browser.stdout.on('data', bytes => { html += bytes; });
  browser.stderr.on('data', bytes => { stderr += bytes; });
  const exit = await new Promise(resolve => browser.on('close', resolve));
  clearTimeout(deadline);
  assert.equal(exit, 0, stderr.slice(-1000));
  const match = html.match(/data-smoke="([^"]+)"/);
  assert.ok(match, `Smoke marker missing: ${stderr.slice(-1000)}`);
  const result = JSON.parse(match[1].replaceAll('&quot;', '"'));
  assert.deepEqual([result.editor,result.images,result.colors,result.rgb], [true,1,1,'RGB(153, 204, 170)']);
  assert.match(result.filter, /hue-rotate\(45deg\)/);
  process.stdout.write('Candy browser smoke passed.\n');
} finally {
  server.close();
  const target = resolve(profile), tempRoot = resolve(tmpdir());
  if (!target.toLowerCase().startsWith((tempRoot + sep).toLowerCase()) || !target.split(sep).at(-1).startsWith('candy-browser-')) throw new Error('Unexpected browser profile path');
  await rm(target, { recursive: true, force: true });
}
