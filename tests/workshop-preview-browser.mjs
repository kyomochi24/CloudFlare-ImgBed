import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve}from'node:path';
import {serveWorkshop}from'./workshop-preview-server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const {server,url}=await serveWorkshop();
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const errors=[],failures=[],requests=[];
try{
 for(const [device,width,height]of [['desktop',1500,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(device+': '+e.message));
  page.on('response',r=>{if(r.status()>=400)failures.push(r.status()+': '+r.url())});
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))requests.push(r.method()+': '+r.url())});
  await page.goto(url);await page.waitForFunction(()=>document.getElementById('render-state').textContent.startsWith('已应用'));
  const child=page.frames().find(f=>f!==page.mainFrame());
  // Account for the editor's CSS scale; inner-frame bounding boxes in CDP use CSS pixels.
  async function click(locator){
   await locator.waitFor({state:'visible'});await locator.scrollIntoViewIfNeeded();
   await child.waitForFunction(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))},await locator.elementHandle());
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rect=await locator.evaluate(el=>el.getBoundingClientRect().toJSON()),box=await (await child.frameElement()).boundingBox(),size=await child.evaluate(()=>({w:innerWidth,h:innerHeight}));
   await page.mouse.click(box.x+(rect.x+rect.width/2)*box.width/size.w,box.y+(rect.y+rect.height/2)*box.height/size.h);
  }
  const drawerIds=['left-nav-panel','rm_api_block','AdvancedFormatting','WorldInfo','user-settings-block','Backgrounds','rm_extensions_block','PersonaManagement','right-nav-panel'];
  for(const id of drawerIds){
   const toggle=child.locator('[aria-controls="'+id+'"]');await click(toggle);
   await child.locator('#'+id).waitFor({state:'visible'});
   const bounds=await child.locator('#'+id).boundingBox();assert.ok(bounds.height>80,id+' has visible content');
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   await click(child.locator('#'+id+' .workshop-close'));
   await child.waitForFunction(id=>document.querySelector('[aria-controls="'+id+'"]').getAttribute('aria-expanded')==='false',id,{timeout:3000});
  }
  for(const id of ['extensionsMenuButton','mes_continue','mes_impersonate','send_but'])assert.ok(await child.locator('#'+id).isVisible(),id+' is visible');
  await click(child.locator('#extensionsMenuButton'));await child.locator('#extensionsMenu').waitFor({state:'visible'});
  await click(child.locator('#sd_gen'));await child.locator('#workshop-popup').waitFor({state:'visible'});
  await click(child.locator('[data-workshop-popup-close]'));
  await click(child.locator('#options_button'));assert.equal(await child.locator('#options a').count(),13);
  await click(child.locator('#option_toggle_AN'));await child.locator('#extension_floating_prompt').waitFor({state:'visible'});await click(child.locator('[data-workshop-popup-close]'));
  await page.locator('#css-editor').evaluate(el=>{el.value='#chat .mes_text {color:rgb(17,101,83)!important} #top-settings-holder::after {content:"";position:fixed;inset:0;pointer-events:auto;z-index:99999}';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await child.waitForFunction(()=>document.getElementById('custom-style').textContent.includes('99999'));
  // The trusted editor controls must still open the menu when theme decorations cover it.
  await page.locator('#preview-menu').selectOption('user-settings-block');await child.locator('#user-settings-block').waitFor({state:'visible'});
  await page.locator('#preview-menu').selectOption('');
  await page.locator('#css-editor').evaluate(el=>{el.value='#chat .mes_text {color:rgb(17,101,83)!important}';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.locator('#preview-runtime').selectOption('tauritavern');
  await child.waitForFunction(()=>document.body.dataset.previewRuntime==='tauritavern'&&document.getElementById('tauritavern-style').sheet);
  await page.waitForFunction(()=>!document.getElementById('oled-control').hidden);
  await child.waitForFunction(()=>!['none','normal',''].includes(getComputedStyle(document.getElementById('leftNavDrawerIcon'),'::before').content));
  for(const id of ['send_but','mes_continue','extensionsMenuButton'])assert.ok(!['none','normal',''].includes(await child.locator('#'+id).evaluate(el=>getComputedStyle(el,'::before').content)),id+' retains its Tauri icon glyph');
  if(device==='desktop'){await page.locator('#device').selectOption('1280,800');await child.waitForFunction(()=>innerWidth===1280);}
  assert.equal(await child.locator('.mes_text').first().evaluate(el=>getComputedStyle(el).color),'rgb(17, 101, 83)');
  await page.locator('#preview-menu').selectOption('user-settings-block');await child.locator('#tauritavern_settings_button').waitFor({state:'visible'});
  await click(child.locator('#tauritavern_settings_button'));await click(child.locator('#workshop-oled-toggle'));
  await page.waitForFunction(()=>document.getElementById('preview-oled').checked);
  await click(child.locator('[data-workshop-popup-close]'));
  assert.equal(await child.locator('#chat').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
  await page.locator('#preview-oled').uncheck();
  // Settings are outside the preview on mobile; use the supported UI tabs.
  if(device==='mobile')await page.locator('[data-view="settings"]').click();
  await page.locator('#generating').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))});
  if(device==='mobile')await page.locator('[data-view="preview"]').click();
  await child.waitForFunction(()=>getComputedStyle(document.getElementById('mes_stop')).display!=='none');
  assert.ok(!await child.locator('#send_but').isVisible());assert.ok(!await child.locator('#mes_continue').isVisible());
  await page.locator('#generating').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.locator('#script-state').evaluate(el=>{el.value='paused';el.dispatchEvent(new Event('change',{bubbles:true}))});
  await child.locator('#stscript_continue').waitFor({state:'visible'});assert.ok(!await child.locator('#stscript_pause').isVisible());
  await page.locator('#script-state').evaluate(el=>{el.value='idle';el.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.locator('#quick-replies').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))});
  await child.locator('#qr--bar').waitFor({state:'visible'});
  await click(child.locator('#qr--bar .qr--button').first());assert.equal(await child.locator('#send_textarea').inputValue(),'继续故事');
  assert.ok(await child.evaluate(()=>{try{parent.document.body;return false}catch{return true}}),'opaque sandbox retained');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'editor has no horizontal overflow');
  if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'workshop-'+device+'.png')});}
  await page.locator('#save-draft').click();await page.waitForFunction(()=>document.getElementById('save-state').textContent.startsWith('已保存'));
  await page.reload();await page.waitForFunction(()=>document.getElementById('render-state').textContent.startsWith('已应用'));
  assert.equal(await page.locator('#preview-runtime').inputValue(),'tauritavern');
  if(device==='mobile')await page.locator('[data-view="settings"]').click();
  assert.ok(await page.locator('#quick-replies').isChecked());
  if(device==='mobile')await page.locator('[data-view="preview"]').click();
  await page.locator('#preview-runtime').selectOption('sillytavern');
  await page.frames().find(f=>f!==page.mainFrame()).waitForFunction(()=>document.body.dataset.previewRuntime==='sillytavern');
  console.log(device+': menus, composer, Tauri/OLED, CSS preservation, drafts and isolation passed.');
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(requests,[]);
}catch(error){
 for(const page of browser.contexts().flatMap(c=>c.pages())){
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'workshop-test-failure.png')});
  console.log('Failure state',await page.frames().find(f=>f!==page.mainFrame())?.evaluate(()=>({popup:document.getElementById('workshop-popup').outerHTML,menu:document.getElementById('options').style.cssText,errors:document.body.dataset.previewRuntime})));
 }console.log('Browser errors',errors,failures);throw error;
}finally{await browser.close();server.close();}
