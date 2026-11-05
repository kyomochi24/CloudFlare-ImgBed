import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,sep,extname } from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(fileURLToPath(new URL('../frontend-dist/',import.meta.url)));
const audio=await readFile(new URL('./fixtures/music-tone.mp3',import.meta.url));
const server=createServer(async(req,res)=>{
 try {
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/file/')){res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length,'Accept-Ranges':'bytes'}).end(audio);return;}
  const file=resolve(root,'.'+(u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const body=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'}[extname(file)]||'application/octet-stream'}).end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const errors=[];
try {
 for(const[device,width,height]of[['desktop',1400,1000],['mobile',390,844]]) {
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(device+': '+e.message));
  await page.route('https://**',r=>r.abort());
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copied=value;}}});});
  let enabled=true,searchCalls=0,saveCalls=0,failSearch=false,failListen=false,releaseSave,waitingSave;
  const records=[];
  await page.route('**/api/studio/**',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname.slice('/api/studio/'.length);
   const data=req.method()==='POST'&&req.headers()['content-type']?.includes('application/json')?req.postDataJSON():{};
   let result={};let status=200;
   if(path==='announcement')result={announcement:{enabled:false}};
   else if(path==='config')result={discordEnabled:false};
   else if(path==='me')result={user:{id:'user',username:'音乐测试',tier:'pichu',baseLimit:200*1048576,storedBytes:records.length*audio.length},application:null};
   else if(path==='albums')result={albums:[{id:'a',name:'BGM 小收藏',file_count:records.filter(x=>x.album_id==='a').length},{id:'b',name:'另一份美化',file_count:records.filter(x=>x.album_id==='b').length}]};
   else if(path==='files')result={files:records.filter(x=>x.album_id===u.searchParams.get('album')),hasMore:false};
   else if(path.endsWith('/quota'))result={used:0,dailyLimit:3,remaining:3,batchLimit:2};
   else if(path==='music/status')result={searchEnabled:enabled};
   else if(path==='music/search'){searchCalls++;if(failSearch){status=502;result={error:'音乐平台暂时不可用'};}else result={tracks:data.q==='没有结果'?[]:[{id:'123',source:'netease',title:'测试旋律 <script>',artist:'演示音乐人',album:'午后的故事'},{id:'456',source:'netease',title:'另一段旋律',artist:'演示音乐人',album:'微风'}]};}
   else if(path==='music/resolve'){if(failListen){await route.fulfill({status:502,contentType:'text/html',body:'<html>Cloudflare Bad gateway</html>'});return;}result={url:origin+'/file/test-tone.mp3',track:{id:'123',source:'netease'}};}
   else if(path==='music/save'||path==='music/upload'){
    saveCalls++;if(waitingSave)await waitingSave;
    const albumId=path==='music/save'?data.albumId:'b';const id='studio/test-'+saveCalls+'.mp3';
    const row={id,album_id:albumId,file_name:'测试旋律.mp3',url:origin+'/file/'+id,mime_type:'audio/mpeg',size_bytes:audio.length};records.push(row);
    result={id,url:row.url,fileName:row.file_name,sizeBytes:audio.length};
   }else if(path==='logout')result={ok:true};
   else{throw new Error('Unexpected UI API request: '+path);}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(origin+'/studio/');await page.locator('#music-search-button:not([disabled])').waitFor();
  assert.equal(searchCalls,0,'No music search before submit');
  await page.locator('#music-query').fill('轻音乐');await page.locator('#music-search-button').click();await page.locator('.music-track').first().waitFor();
  assert.equal(searchCalls,1);assert.equal(await page.locator('.music-track').count(),2);assert.equal(await page.locator('#music-results script').count(),0);
  await page.locator('[data-listen="0"]').click();await page.waitForFunction(()=>document.getElementById('music-audio').currentTime>0);
  await page.locator('#music-stop').click();assert.equal(await page.locator('#music-audio').getAttribute('src'),null);
  failListen=true;await page.locator('[data-listen="0"]').click();await page.waitForFunction(()=>document.getElementById('music-status').textContent.includes('音乐服务连接异常'));failListen=false;
  waitingSave=new Promise(r=>releaseSave=r);
  await page.locator('[data-save="0"]').click();
  assert.equal(await page.locator('[data-save="1"]').isDisabled(),true);
  await page.locator('[data-id="b"]').click();
  await page.waitForFunction(()=>document.getElementById('music-album').textContent==='另一份美化');
  releaseSave();waitingSave=null;
  await page.locator('#music-saved').waitFor({state:'visible'});
  assert.equal(records[0].album_id,'a');assert.match(await page.locator('#music-saved-detail').textContent(),/BGM 小收藏/);
  await page.locator('#music-copy').click();assert.match(await page.evaluate(()=>window.copied),/\/file\/studio\/.+\.mp3$/);
  await page.locator('[data-id="a"]').click();await page.locator('[data-copy="0"]').waitFor();await page.waitForFunction(()=>document.getElementById('file-grid').textContent.includes('MP3 音频'));
  await page.locator('[data-copy="0"]').click();assert.equal(saveCalls,1);
  await page.locator('[data-id="b"]').click();
  await page.locator('#music-local-input').setInputFiles({name:'local.mp3',mimeType:'audio/mpeg',buffer:audio});
  await page.waitForFunction(()=>document.getElementById('music-status').textContent.includes('本地 MP3 已保存'));
  assert.equal(saveCalls,2);
  failSearch=true;await page.locator('#music-search-button').click();await page.waitForFunction(()=>document.getElementById('music-status').textContent.includes('暂时不可用'));
  failSearch=false;await page.locator('#music-query').fill('没有结果');await page.locator('#music-search-button').click();await page.waitForFunction(()=>document.getElementById('music-status').textContent.includes('没有搜到'));
  await page.locator('#music-query').fill('轻音乐');await page.locator('#music-search-button').click();await page.locator('.music-track').first().waitFor();
  await page.locator('#music-card').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#music-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No music card horizontal overflow');
  if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.locator('#music-card').screenshot({path:resolve(process.env.SCREENSHOT_DIR,`qiuqiu-music-${device}.png`)});}
  await page.locator('#logout').click();await page.waitForFunction(()=>document.getElementById('member').classList.contains('hidden'));
  assert.equal(await page.locator('.music-track').count(),0);assert.equal(await page.locator('#music-audio').getAttribute('src'),null);
  enabled=false;await page.reload();await page.locator('#music-config').waitFor({state:'visible'});assert.equal(await page.locator('#music-query').isDisabled(),true);assert.equal(await page.locator('#music-local-input').isEnabled(),true);
  await page.close();console.log(`${device}: search, playback, album change during save, copy, local upload, errors, logout and unconfigured mode passed.`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
