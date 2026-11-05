/* SPDX-License-Identifier: AGPL-3.0-or-later
   Local appearance samples only. No chat runtime, model requests or plugin execution. */
window.createWorkshopUI = function(tell) {
 'use strict';
 const $=id=>document.getElementById(id);
 const panels={
  'left-nav-panel':['生成设置',`<div id="ai_response_configuration"><label>预设<select id="settings_preset" class="text_pole"><option>柔和对话</option><option>故事叙述</option></select></label><div class="range-block"><label>温度<input id="temp" type="range" min="0" max="2" step=".01" value=".8"></label><label>回复长度<input id="amount_gen" class="text_pole" type="number" value="400"></label></div><details class="inline-drawer" open><summary class="inline-drawer-header">采样参数</summary><label>Top P<input type="range" min="0" max="1" step=".01" value=".95"></label></details></div>`],
  'rm_api_block':['连接设置',`<label>连接方式<select id="main_api" class="text_pole"><option>聊天补全</option><option>文本补全</option></select></label><div id="openai_api"><label>接口地址<input class="text_pole" placeholder="https://…" readonly></label><label>模型<select class="text_pole"><option>示例模型</option></select></label><div id="online_status"><span>● 外观预览</span></div><button type="button" class="menu_button" data-preview-dialog="connection">连接</button></div>`],
  'AdvancedFormatting':['格式设置',`<div id="ContextSettings"><h4>上下文模板</h4><select class="text_pole"><option>默认模板</option><option>故事模板</option></select></div><div id="InstructSettingsColumn"><h4>指令模式</h4><label><input type="checkbox" checked> 启用指令模板</label><textarea class="text_pole" rows="3">{{user}} 与 {{char}} 的对话</textarea></div><div id="SystemPrompt"><h4>系统提示词</h4><textarea class="text_pole" rows="3">保持角色语气，自然地回应对话。</textarea></div>`],
  'WorldInfo':['世界书',`<div id="WorldInfoHeader"><select id="world_editor_select" class="text_pole"><option>甜品屋的日常</option><option>城市与街角</option></select></div><div id="world_popup"><input class="text_pole" type="search" placeholder="搜索条目"><details class="world_entry" open><summary class="inline-drawer-header">☷ 甜品屋 · 常驻条目</summary><div class="world_entry_form"><label>关键词<input class="text_pole" value="甜品屋, 窗边"></label><textarea class="text_pole" rows="4">街角有一家安静的甜品屋，窗边总留着两个位置。</textarea></div></details></div>`],
  'user-settings-block':['用户设置',`<div id="tauritavern_settings" hidden><button id="tauritavern_settings_button" type="button" class="menu_button menu_button_icon" data-preview-dialog="tauri"><i class="fa-solid fa-gear"></i> TauriTavern 设置</button></div><div id="UI-Theme-Block"><h4>界面主题</h4><select id="themes" class="text_pole"><option>当前美化</option></select><div id="UI-Customization"><label>字体大小<input type="range" min=".5" max="2" step=".05" value="1"></label><label><input type="checkbox" checked> 显示消息时间</label><label><input type="checkbox"> 紧凑输入框</label><div class="workshop-swatch-row"><input type="color" value="#e8bdc7" aria-label="主题颜色示例"><input type="color" value="#cfdee5" aria-label="边框颜色示例"></div></div></div><div id="power-user-options-block"><h4>聊天与显示</h4><label><input type="checkbox" checked> 显示消息操作按钮</label></div>`],
  'Backgrounds':['背景',`<div id="bg_tabs"><button type="button" class="menu_button">系统背景</button><button type="button" class="menu_button">自定义背景</button></div><div id="bg_menu_content" class="workshop-backgrounds"><button type="button" class="bg_example" aria-label="粉色背景示例"><span class="BGSampleTitle">莓果奶油</span></button><button type="button" class="bg_example" aria-label="蓝色背景示例"><span class="BGSampleTitle">午后晴空</span></button><button type="button" class="bg_example" aria-label="灰色背景示例"><span class="BGSampleTitle">安静夜晚</span></button></div>`],
  'rm_extensions_block':['扩展设置',`<div id="extensions_settings"><div class="extension_container"><h4>快捷回复</h4><label><input type="checkbox" checked> 启用示例回复</label></div><div class="extension_container"><h4>图片与语音</h4><label><input type="checkbox"> 显示图片生成按钮</label><label><input type="checkbox" checked> 显示朗读按钮</label></div><p class="workshop-note">这里只展示控件样式，扩展不会运行。</p></div>`],
  'PersonaManagement':['用户头像',`<div id="persona-management-block"><div id="persona_selector" class="workshop-personas"><div class="avatar-container"><div class="avatar"><img data-workshop-avatar="user" alt="用户示例头像"></div><span>你</span></div></div><label>用户名称<input id="persona_name" class="text_pole" value="你"></label><label>用户描述<textarea id="persona_description" class="text_pole" rows="4">喜欢温柔的颜色和安静的下午。</textarea></label><button id="persona_delete_button" type="button" class="menu_button dangerous" data-preview-dialog="delete">删除头像</button></div>`],
  'right-nav-panel':['角色管理',`<div id="rm_button_panel"><button id="rm_button_characters" type="button" class="menu_button">角色</button><button id="rm_button_create" type="button" class="menu_button" data-preview-dialog="character">新建角色</button></div><input id="character_search_bar" class="text_pole" type="search" placeholder="搜索角色"><div id="rm_print_characters_block"><div class="character_select" chid="preview"><div class="avatar"><img data-workshop-avatar="char" alt="角色示例头像"></div><div class="ch_name">浅浅丘</div></div></div><div id="character_popup"><label>角色描述<textarea class="text_pole" rows="4">在甜品屋里，与你分享今天的故事。</textarea></label><button id="delete_character_button" type="button" class="menu_button dangerous" data-preview-dialog="delete">删除角色</button></div>`]
 };
 let active='',runtime='sillytavern',oled=false,currentSample={};
 const sheetWaits=new WeakMap();
 function sheetReady(link){
  if(link.sheet)return Promise.resolve();
  if(sheetWaits.has(link))return sheetWaits.get(link);
  const wait=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>finish(new Error('预览样式未能加载，请检查工坊资源是否上传完整。')),10000);
   function finish(error){clearTimeout(timeout);link.removeEventListener('load',loaded);link.removeEventListener('error',failed);error?reject(error):resolve()}
   const loaded=()=>finish(),failed=()=>finish(new Error('预览样式读取失败'));
   link.addEventListener('load',loaded,{once:true});link.addEventListener('error',failed,{once:true});
  });sheetWaits.set(link,wait);return wait;
 }
 const action=(id,icon,label)=>`<a id="${id}" role="button" tabindex="0"><i class="fa-lg fa-solid ${icon}"></i><span>${label}</span></a>`;
 for(const [id,[title,body]]of Object.entries(panels)){
  const panel=$(id);panel.innerHTML=`<div class="workshop-panel-head"><h3>${title}</h3><button type="button" class="menu_button workshop-close" aria-label="收起${title}">×</button></div>${body}<p class="workshop-note">菜单外观示例 · 可调整控件查看状态</p>`;
  panel.setAttribute('aria-label',title);const toggle=panel.parentElement.querySelector('.drawer-toggle');
  toggle.setAttribute('role','button');toggle.tabIndex=0;toggle.setAttribute('aria-controls',id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label',title);
  toggle.querySelector('.drawer-icon')?.setAttribute('title',title);
 }
 $('options').innerHTML='<div class="options-content">'+[
  ['option_start_new_chat','fa-comments','新聊天'],['option_select_chat','fa-address-book','管理聊天'],['option_close_chat','fa-times','关闭聊天'],
  ['option_toggle_AN','fa-note-sticky','作者注释'],['option_toggle_CFG','fa-scale-balanced','CFG 设置'],['option_toggle_logprobs','fa-pie-chart','Token 概率'],
  ['option_new_bookmark','fa-flag','保存检查点'],['option_back_to_main','fa-left-long','返回父聊天'],['option_convert_to_group','fa-people-arrows','转为群聊'],
  ['option_delete_mes','fa-trash-can','删除消息'],['option_regenerate','fa-repeat','重新生成'],['option_impersonate','fa-user-secret','代写'],['option_continue','fa-arrow-right','继续']
 ].map(a=>action(...a)).join('')+'</div>';
 const extensions=document.createElement('div');extensions.id='extensionsMenu';extensions.className='font-family-reset';extensions.hidden=true;
 extensions.innerHTML=action('sd_gen','fa-paintbrush','生成图片')+action('tts_menu','fa-volume-high','朗读 / 语音')+action('attachFile','fa-paperclip','附加文件')+action('qr--popoutTrigger','fa-bolt','快捷回复');document.body.append(extensions);
 const qr=document.createElement('div');qr.id='qr--bar';qr.className='qr--bar';qr.hidden=true;qr.innerHTML='<div class="qr--buttons"><button type="button" class="qr--button menu_button">继续故事</button><button type="button" class="qr--button menu_button">换个话题</button><button type="button" class="qr--button menu_button">慢慢说</button></div>';$('send_form').prepend(qr);
 const popup=document.createElement('dialog');popup.id='workshop-popup';popup.className='popup';popup.setAttribute('aria-labelledby','workshop-popup-title');popup.innerHTML='<div class="popup-body"><h3 id="workshop-popup-title"></h3><div id="workshop-popup-content"></div><div class="popup-controls"><button type="button" class="menu_button" data-workshop-popup-close>返回预览</button></div></div>';document.body.append(popup);
 const feedback=document.createElement('div');feedback.id='workshop-feedback';feedback.setAttribute('role','status');feedback.hidden=true;document.body.append(feedback);let feedbackTimer;
 function hint(text){feedback.textContent=text;feedback.hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>feedback.hidden=true,2600)}
 function state(){tell('ui-state',{target:active,runtime})}
 function close(){
  for(const id of Object.keys(panels)){
   const panel=$(id),toggle=panel.parentElement.querySelector('.drawer-toggle');panel.classList.remove('openDrawer');panel.classList.add('closedDrawer');panel.style.display='none';panel.style.removeProperty('height');toggle.setAttribute('aria-expanded','false');
   const icon=toggle.querySelector('.drawer-icon');icon?.classList.remove('openIcon');icon?.classList.add('closedIcon');
  }
  $('options').style.display='none';extensions.hidden=true;active='';state();
 }
 function open(target){
  close();if(!target)return;
  if(panels[target]){const panel=$(target);panel.classList.remove('closedDrawer');panel.classList.add('openDrawer');panel.style.display='block';panel.style.height='auto';const toggle=panel.parentElement.querySelector('.drawer-toggle');toggle.setAttribute('aria-expanded','true');toggle.querySelector('.drawer-icon')?.classList.replace('closedIcon','openIcon');active=target;}
  else if(target==='options'){$('options').style.display='block';active=target;}
  else if(target==='extensionsMenu'){extensions.hidden=false;active=target;}
  state();
 }
 function show(title,html){close();$('workshop-popup-title').textContent=title;$('workshop-popup-content').innerHTML=html;popup.showModal()}
 function dialogFor(id){
  if(id==='tauri'){show('TauriTavern 设置','<p>外观与显示</p><label><input type="checkbox" id="workshop-oled-toggle"> OLED 纯黑背景</label><p class="workshop-note">在这里检查原版纯黑样式与当前美化的叠加效果。</p>');$('workshop-oled-toggle').checked=oled;$('workshop-oled-toggle').onchange=()=>{oled=$('workshop-oled-toggle').checked;currentSample.oled=oled;document.documentElement.classList.toggle('tt-oled-background',runtime==='tauritavern'&&oled);tell('preview-setting',{oled})};return;}
  const dialogs={
   option_toggle_AN:['作者注释','<div id="floatingPrompt"><label>注释内容<textarea id="extension_floating_prompt" class="text_pole" rows="5">保持温柔的日常氛围。</textarea></label><label>插入深度<input class="text_pole" type="number" value="4"></label></div>'],
   option_toggle_CFG:['CFG 设置','<div id="cfgConfig"><label>引导强度<input type="range" min="1" max="10" value="1"></label><textarea class="text_pole" rows="3" placeholder="正面提示词"></textarea></div>'],
   option_select_chat:['管理聊天','<div id="select_chat_popup"><input class="text_pole" placeholder="搜索聊天"><div class="select_chat_block"><b>甜品屋的午后</b><p>4 条示例消息</p></div><div class="select_chat_block"><b>街角散步</b><p>12 条示例消息</p></div></div>'],
   sd_gen:['生成图片','<label>画面提示词<textarea class="text_pole" rows="4">窗边的甜品与一杯温热的茶</textarea></label><button type="button" class="menu_button" data-workshop-demo>生成图片</button>'],
   tts_menu:['朗读 / 语音','<label>声音<select class="text_pole"><option>温柔的声音</option></select></label><label>语速<input type="range" min=".5" max="2" step=".1" value="1"></label>'],
   attachFile:['附加文件','<div class="file_attached"><i class="fa-solid fa-file-alt"></i><span class="file_name">示例笔记.txt</span><span class="file_size">1 KB</span></div>'],
   'qr--popoutTrigger':['快捷回复','<div class="qr--buttons"><button type="button" class="qr--button menu_button" data-workshop-demo>继续故事</button><button type="button" class="qr--button menu_button" data-workshop-demo>换个话题</button></div>']
  };
  const found=dialogs[id];if(found)show(...found);else hint('这是外观预览，此操作不会调用模型或改动聊天。');
 }
 async function configure(sample){
  currentSample={...currentSample,...sample};sample=currentSample;
  const next=sample.runtime==='tauritavern'?'tauritavern':'sillytavern';runtime=next;oled=!!sample.oled;
  document.body.dataset.previewRuntime=runtime;document.documentElement.classList.toggle('tt-oled-background',runtime==='tauritavern'&&oled);
  const ids=runtime==='tauritavern'?['tauritavern-icons','tauritavern-style','tauritavern-mobile','tauritavern-oled']:['sillytavern-style','sillytavern-mobile'];
  for(const id of ['sillytavern-style','sillytavern-mobile','tauritavern-icons','tauritavern-style','tauritavern-mobile','tauritavern-oled'])$(id).media=ids.includes(id)?'all':'not all';
  $('tauritavern_settings').hidden=runtime!=='tauritavern';
  for(const id of ['mes_continue','mes_impersonate'])$(id).classList.toggle('displayNone',sample.composerActions===false);
  document.body.classList.toggle('workshop-composer-actions',sample.composerActions!==false);
  qr.hidden=!sample.quickReplies;
  const script=['running','paused'].includes(sample.scriptState)?sample.scriptState:'idle';
  $('form_sheld').classList.toggle('isExecutingCommandsFromChatInput',script!=='idle');$('form_sheld').classList.toggle('script_paused',script==='paused');
  document.body.dataset.generating=String(!!sample.generating);document.body.classList.toggle('workshop-generating',!!sample.generating);
  await Promise.all(ids.map(id=>sheetReady($(id))));
  for(const img of document.querySelectorAll('[data-workshop-avatar]')){const source=document.querySelector('.mes[is_user="'+(img.dataset.workshopAvatar==='user')+'"] .avatar img');if(source)img.src=source.src;}
 }
 function handleClick(e){
  const target=e.target;
  if(target.closest('[data-workshop-popup-close]')){popup.close();return true}
  if(target===popup){popup.close();return true}
  if(target.closest('[data-workshop-demo]')){hint('示例控件 · 不会发送请求');return true}
  const toggle=target.closest('.drawer-toggle');if(toggle){const id=toggle.getAttribute('aria-controls');active===id?close():open(id);return true}
  if(target.closest('.workshop-close')){close();return true}
  const shortcut=target.closest('#options_button,#extensionsMenuButton');if(shortcut){const id=shortcut.id==='options_button'?'options':'extensionsMenu';active===id?close():open(id);return true}
  const item=target.closest('#options a,#extensionsMenu a,[data-preview-dialog]');if(item){dialogFor(item.dataset.previewDialog||item.id);return true}
  if(target.closest('.qr--button')){const textarea=$('send_textarea');textarea.value=target.closest('.qr--button').textContent;textarea.dispatchEvent(new Event('input'));return true}
  if(target.closest('#send_but,#mes_stop,#mes_continue,#mes_impersonate,.stscript_btn')){hint('仅预览按钮状态，不会发送消息或运行脚本。');return true}
  if(active&&!target.closest('.drawer-content,#options,#extensionsMenu'))close();
  return false;
 }
 for(const el of document.querySelectorAll('#options_button,#extensionsMenuButton,#send_but,#mes_stop,#mes_continue,#mes_impersonate,.stscript_btn')){el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',el.title||el.id)}
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(popup.open)popup.close();close()}if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"]')){e.preventDefault();e.target.click()}});
 return {
  configure,handleClick,
  message(data){if(data.type!=='ui')return;if(data.action==='open'&&typeof data.target==='string')open(data.target);if(data.action==='runtime')configure({runtime:data.runtime,oled}).then(state).catch(error=>tell('error',{message:error.message}));}
 };
};
