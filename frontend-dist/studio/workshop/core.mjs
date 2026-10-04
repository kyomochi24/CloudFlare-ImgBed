// SPDX-License-Identifier: AGPL-3.0-or-later
export const DEFAULT_THEME = {
 name:'我的酒馆美化', custom_css:'/* 丘丘美化工坊 · 写下你的美化 CSS */\n\n/* 例如：修改角色姓名颜色\n#chat .mes[is_user="false"] .name_text {\n  color: #4DD0E1;\n}\n*/\n',
 main_text_color:'rgba(220,220,210,1)',italics_text_color:'rgba(145,145,145,1)',underline_text_color:'rgba(188,231,207,1)',quote_text_color:'rgba(225,138,36,1)',blur_tint_color:'rgba(23,23,23,1)',chat_tint_color:'rgba(23,23,23,1)',user_mes_blur_tint_color:'rgba(0,0,0,0.3)',bot_mes_blur_tint_color:'rgba(60,60,60,0.3)',shadow_color:'rgba(0,0,0,0.5)',border_color:'rgba(0,0,0,0.5)',blur_strength:10,shadow_width:2,font_scale:1,chat_width:100,chat_display:0,avatar_style:0,fast_ui_mode:false,noShadows:false,waifuMode:false,timer_enabled:true,timestamps_enabled:true,mesIDDisplay_enabled:true,message_token_count_enabled:true,hideChatAvatars_enabled:false,expand_message_actions:false
};
export const DEFAULT_SAMPLE={userName:'你',charName:'浅浅丘',userText:'我想把今天的心情，做成一份新的美化。\n\n你觉得粉色和蓝色怎么样？',charText:'当然可以，我们慢慢来。\n\n*窗边的光落在桌上，像一小块融化的奶油。*\n\n**这是加粗文字**，<u>这是下划线文字</u>。\n\n> “把喜欢的样子留在这里。”\n\n---\n\n```css\n.name_text { color: #4DD0E1; }\n```',userAvatar:'',charAvatar:'',background:'',count:2,generating:false};
export function freshProject(){return {kind:'qiuqiu-workshop',version:1,theme:structuredClone(DEFAULT_THEME),sample:structuredClone(DEFAULT_SAMPLE),viewport:{width:390,height:844,zoom:'fit'}};}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function parseImport(text,fileName='theme.json'){
 if(/\.css$/i.test(fileName)) return {type:'css',css:text};
 let obj;try{obj=JSON.parse(text)}catch{throw new Error('JSON 格式有误，请检查文件是否完整。')}
 if(!object(obj))throw new Error('请导入酒馆主题对象，暂不支持数组或聊天记录。');
 if(obj.kind==='qiuqiu-workshop'){
  if(obj.version!==1||!object(obj.theme)||typeof obj.theme.custom_css!=='string')throw new Error('工程格式或版本不受支持。');
  const p=freshProject();p.theme=structuredClone(obj.theme);
  if(object(obj.sample)){for(const k of Object.keys(p.sample)){if(typeof obj.sample[k]===typeof p.sample[k])p.sample[k]=obj.sample[k];}}
  p.sample.count=[1,2,4].includes(p.sample.count)?p.sample.count:2;
  if(object(obj.viewport)){p.viewport=normalizeViewport(obj.viewport)}
  return {type:'project',project:p};
 }
 if(typeof obj.custom_css!=='string'&&!['main_text_color','chat_display','blur_tint_color','font_scale'].some(k=>k in obj))throw new Error('没有识别到酒馆主题字段。请使用酒馆导出的主题 JSON 或 CSS 文件。');
 if(obj.custom_css!==undefined&&typeof obj.custom_css!=='string')throw new Error('custom_css 必须是文本。');
 return {type:'theme',theme:{...obj,custom_css:obj.custom_css??''}};
}
export function normalizeViewport(v){const num=(x,min,max,fallback)=>Number.isFinite(Number(x))?Math.min(max,Math.max(min,Math.round(Number(x)))):fallback;return {width:num(v.width,240,3840,390),height:num(v.height,320,3840,844),zoom:['fit','0.5','0.75','1','1.25'].includes(String(v.zoom))?String(v.zoom):'fit'};}
export function safeImageUrl(raw){let s=String(raw||'').trim();if(!s)return '';if(/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(s))return s;try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
export function avatarRule(css,target,values,remove=false){const key=target==='user'?'user':'char';const start=`/* 丘丘头像调整:${key}:开始 */`,end=`/* 丘丘头像调整:${key}:结束 */`;const i=css.indexOf(start),j=css.indexOf(end,i);let base=i>=0&&j>=i?css.slice(0,i)+css.slice(j+end.length):css;if(remove)return base.trimEnd()+'\n';const n=(k,min,max,def)=>Number.isFinite(+values[k])?Math.max(min,Math.min(max,+values[k])):def;const v={size:n('size',16,500,50),radius:n('radius',0,50,50),x:n('x',-1000,1000,0),y:n('y',-1000,1000,0)};const sel=`#chat .mes[is_user="${key==='user'}"]`;return base.trimEnd()+`\n\n${start}\n${sel} .avatar,\n${sel} .avatar img {\n  width: ${v.size}px !important;\n  height: ${v.size}px !important;\n  min-width: ${v.size}px;\n  aspect-ratio: 1 / 1;\n  border-radius: ${v.radius}%;\n}\n${sel} .avatar {\n  translate: ${v.x}px ${v.y}px;\n}\n${sel} .avatar img {\n  object-fit: cover;\n}\n${end}\n`;}
export function themeForExport(theme,name,css){return {...structuredClone(theme),name:String(name||'我的酒馆美化').trim()||'我的酒馆美化',custom_css:String(css)};}
