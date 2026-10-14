import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../frontend-dist/studio/', import.meta.url));
function fixturePng() {
  const w = 480, h = 300, bytes = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let rgb = [0, 0, 0, 0];
    const left = ((x - 155) / 80) ** 2 + ((y - 133) / 65) ** 2 < 1;
    const right = ((x - 298) / 80) ** 2 + ((y - 133) / 65) ** 2 < 1;
    const tails = y > 140 && y < 258 && ((x > 165 && x < 212) || (x > 242 && x < 289));
    if (left || right || tails) rgb = y < 150 ? [237, 143, 182, 255] : [190, 70, 120, 255];
    if (Math.abs(x - 228) < 27 && Math.abs(y - 139) < 27) rgb = [250, 201, 222, 255];
    if ((x - 421) ** 2 + (y - 76) ** 2 < 24 ** 2) rgb = [70, 149, 231, 255];
    if ((x - 50) ** 2 + (y - 225) ** 2 < 20 ** 2) rgb = [255, 211, 112, 255];
    if ((x - 400) ** 2 + (y - 240) ** 2 < 13 ** 2) rgb = [255, 255, 255, 255];
    const i = y * (w * 4 + 1) + 1 + x * 4;
    rgb.forEach((v, c) => { bytes[i + c] = v; });
  }
  const chunk = (name, data) => {
    const type = Buffer.from(name), all = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of all) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, all, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}

export async function startFixture() {
  const source = await readFile(join(root, 'index.html'), 'utf8');
  const section = source.match(/<section class="card candy-card">[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  const protectionDialog = source.match(/<dialog id="candy-protection-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(protectionDialog);
const themePreviewDialog=source.match(/<dialog id="candy-theme-preview-dialog"[\s\S]*?<\/dialog>/)?.[0];
  const png = fixturePng();
  const setup = `
import { initCandy } from '/studio/candy.js';
const $ = id => document.getElementById(id);
window.addEventListener('unhandledrejection',event=>{document.body.dataset.selectiveTest='failed: '+event.reason?.message});
const until = async fn => { for (let i=0;i<200;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,25)); } throw new Error('Timed out'); };
const pixel = (canvas,x,y) => [...canvas.getContext('2d').getImageData(x,y,1,1).data];
const uploads = [];
const api = async (path,options) => {
  if(path==='candy/quota') return {used:0,dailyLimit:20,remaining:20};
  if(path==='files') {
    const file=options.body.get('file'), bitmap=await createImageBitmap(file), c=document.createElement('canvas');
    c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0); bitmap.close(); uploads.push(c);
    return {url:location.origin+'/saved-'+uploads.length+'.png'};
  }
  return {id:'test-album'};
};
window.candyTest={uploads};
const candy=initCandy({api,state:{user:{id:'selective-test',tier:'pichu'},albumId:'album'},refreshProfile:async()=>{},refreshAlbums:async()=>{},notice:message=>{$('notice').textContent=message}});
await candy.refreshQuota();
const theme={name:'蝴蝶结 · 薄荷糖',photo:location.origin+'/fixture.png',photo2:location.origin+'/fixture2.png'};
const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(theme)],'example.json',{type:'application/json'}));
$('candy-input').files=transfer.files;$('candy-input').dispatchEvent(new Event('change',{bubbles:true}));
await until(()=>document.querySelector('[data-image-row]'));
$('candy-select-all').click();$('candy-palette-open').click();
document.querySelector('[data-candy-mode=selective]').click();
document.querySelector('[data-image-row="0"]').scrollIntoView({behavior:'instant',block:'center'});
await until(()=>document.querySelector('[data-canvas]:not(.hidden)'));
window.candyReady=true;
`;
  const checks = `
const require=(ok,message)=>{if(!ok)throw new Error(message)};
try {
  document.querySelector('[data-image-row="1"]').scrollIntoView({behavior:'instant',block:'center'});
  await until(()=>document.querySelector('[data-canvas="1"]:not(.hidden)'));
  document.querySelector('[data-image-row="0"]').scrollIntoView({behavior:'instant',block:'center'});
  const c=document.querySelector('[data-canvas="0"]');
  const green=pixel(c,150,130);require(green[1]>green[0]&&green[1]>green[2],'pink changes to green');
  require(JSON.stringify(pixel(c,421,76))===JSON.stringify([70,149,231,255]),'blue unchanged');
  require(pixel(c,0,0)[3]===0,'transparency retained');
  // Object-fit letterboxing must not pick a color outside the actual bitmap.
  $('candy-pick-color').click();
  await new Promise(r=>setTimeout(r,350));
  const img=document.querySelector('[data-before="0"]');const rect=img.getBoundingClientRect();
  img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+1,clientY:rect.top+1}));
  await until(()=>$('candy-pick-hint').textContent.includes('留白'));
  const scale=Math.min(rect.width/480,rect.height/300),left=rect.left+(rect.width-480*scale)/2,top=rect.top+(rect.height-300*scale)/2;
  img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:left+150*scale,clientY:top+130*scale}));
  await until(()=>$('candy-pick-color').getAttribute('aria-pressed')==='false');
  require($('candy-recolor-source').value==='#ed8fb6','eyedropper samples original pink');
  $('candy-show-mask').checked=true;$('candy-show-mask').dispatchEvent(new Event('change'));
  await until(()=>document.querySelector('.candy-after-title').textContent.includes('粉色标记'));
  require(pixel(c,150,130)[0]>pixel(c,150,130)[1],'mask highlights selected color');
  $('candy-save-draft').click();await until(()=>$('candy-status').textContent.includes('草稿已保存'));
  $('candy-reset-selected').click();
  $('candy-drafts').selectedIndex=1;$('candy-open-draft').click();
  await until(()=>$('notice').textContent.includes('草稿已经打开'));
  require(document.querySelector('[data-candy-mode=selective]').getAttribute('aria-pressed')==='true','selective mode restored from draft');
  await until(()=>document.querySelector('[data-canvas="0"]:not(.hidden)'));
  // Export ignores the temporary mask, regardless of whether it is currently visible.
  $('candy-show-mask').checked=true;$('candy-show-mask').dispatchEvent(new Event('change'));
  $('candy-export').click();await until(()=>uploads.length===2 && $('candy-export').disabled===false);
  require(pixel(uploads[0],150,130)[1]>pixel(uploads[0],150,130)[0],'export is green, not mask pink');
  require(JSON.stringify(pixel(uploads[0],421,76))===JSON.stringify([70,149,231,255]),'export protects blue');
  require(pixel(uploads[0],0,0)[3]===0,'export protects alpha');
  $('candy-show-mask').checked=false;$('candy-show-mask').dispatchEvent(new Event('change'));
  await until(()=>document.querySelector('.candy-after-title').textContent==='改后 · 实时预览');
  const previewCanvas=document.querySelector('[data-canvas="0"]');
  require(JSON.stringify(pixel(previewCanvas,150,130))===JSON.stringify(pixel(uploads[0],150,130)),'preview/export match');
  // Reset restores the global mode and original pixels.
  document.querySelector('[data-reset="0"]').click();
  require(document.querySelector('[data-after="0"]').style.filter.includes('hue-rotate(0deg)'),'reset global filter');
  require(document.querySelector('[data-canvas="0"]').classList.contains('hidden'),'reset hides canvas');
  document.body.dataset.selectiveTest='passed';
} catch(error) { document.body.dataset.selectiveTest='failed: '+error.message; }
`;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/fixture.png' || path === '/fixture2.png') { response.setHeader('Content-Type','image/png'); response.end(png); return; }
    if (path === '/smoke' || path === '/preview') {
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/studio/style.css"><link rel="stylesheet" href="/studio/candy.css"><body><main class="shell" style="padding-top:32px"><div class="section-heading"><span>COLOR CANDY BOX</span><h2>丘丘糖果色匣 ✿</h2><p>给喜欢的颜色，换一种心情。</p></div><div id="notice" role="status"></div>${section}</main>${protectionDialog}${themePreviewDialog}<script type="module">${setup}${path==='/smoke'?checks:''}</script></body></html>`);return;
    }
    if (/^\/studio\/(candy\.js|candy-utils\.js|css-utils\.js|candy-recolor\.js|candy-protection\.js|candy-theme-preview\.js|theme-utils\.js|style\.css|candy\.css)$/.test(path)) {
      response.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');
      response.end(await readFile(join(root,path.slice('/studio/'.length))));return;
    }
    if(path.startsWith('/studio/workshop/') && !path.includes('..')){const file=join(root,path.slice('/studio/'.length));try{response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.woff2')?'font/woff2':'text/javascript');response.end(await readFile(file));return;}catch{}}
    response.statusCode=404;response.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  return { server, url: 'http://127.0.0.1:'+server.address().port };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chrome=process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!existsSync(chrome)) throw new Error('Chrome is required for the selective color browser test.');
  const {server,url}=await startFixture(),profile=await mkdtemp(join(tmpdir(),'candy-selective-'));
  let browser, socket;
  try {
    // Use real time: virtual-time DOM dumps can finish before IntersectionObserver paints previews.
    browser=spawn(chrome,['--headless=new','--no-sandbox','--incognito','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let i=0;i<200&&!port;i++) {
      try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}
      catch {await new Promise(resolve=>setTimeout(resolve,50));}
    }
    assert.ok(port,'Chrome did not start');
    const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let sequence=0;const pending=new Map();
    socket.addEventListener('message',event=>{
      const reply=JSON.parse(event.data);if(!pending.has(reply.id))return;
      const {resolve,reject,timer}=pending.get(reply.id);pending.delete(reply.id);clearTimeout(timer);
      reply.error?reject(new Error(reply.error.message)):resolve(reply.result);
    });
    const command=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},10000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
    await command('Page.navigate',{url:url+'/smoke'});
    await command('Page.bringToFront');
    let result;
    for(let i=0;i<300&&!result;i++) {
      const evaluated=await command('Runtime.evaluate',{expression:'document.body?.dataset.selectiveTest',returnByValue:true});
      result=evaluated.result?.value;
      if(!result)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(result!=='passed') {
      const state=await command('Runtime.evaluate',{expression:"JSON.stringify({ready:window.candyReady,url:location.href,status:document.getElementById('candy-status')?.textContent,hint:document.getElementById('candy-pick-hint')?.textContent,uploads:window.candyTest?.uploads.length,body:document.body?.innerText})",returnByValue:true});
      process.stdout.write(String(state.result?.value)+'\n');
    }
    assert.equal(result,'passed');
    process.stdout.write('Selective color browser test passed: batch, picker, mask, draft, export, reset.\n');
  } finally {
    socket?.close();
    if(browser&&browser.exitCode===null){const closed=new Promise(resolve=>browser.once('close',resolve));browser.kill();await closed;}
    server.close();
    const target=resolve(profile),tempRoot=resolve(tmpdir());
    if(!target.toLowerCase().startsWith((tempRoot+sep).toLowerCase()) || !target.split(sep).at(-1).startsWith('candy-selective-')) throw new Error('Unexpected browser profile path');
    await rm(target,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
