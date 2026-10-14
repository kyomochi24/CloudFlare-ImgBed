import {cssDeclarations,cssUrls} from './css-utils.js?v=20261015a';
const BITMAP=/\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const NON_IMAGE=/\.(ttf|otf|woff2?|css|js|mjs|json|html?|svg|pdf|mp[34]|webm|zip)$/i;
const IMAGE_PROPERTY=/^(?:background(?:-image)?$|border-image(?:-source)?$|(?:-webkit-)?mask(?:-image)?$|list-style(?:-image)?$|cursor$|content$|--)/i;
function candidate(raw,optional){try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!NON_IMAGE.test(u.pathname)&&(optional||BITMAP.test(u.pathname))}catch{return false}}
export function imageLinks(raw){
 const theme=JSON.parse(raw),unique=new Set();
 function walk(value,path=[]){
  if(typeof value==='string'){
   const urls=cssUrls(value),declarations=cssDeclarations(value);
   for(const token of urls){const d=declarations.find(d=>token.start>=d.start&&token.end<=d.end);if(d&&IMAGE_PROPERTY.test(d.property)&&candidate(token.url,true))unique.add(token.url)}
   const remaining=value.split('');for(const token of urls)for(let i=token.start;i<token.end;i++)remaining[i]=' ';
   const field=path.some(key=>/image|img|background|avatar|photo|icon|texture|mask|banner/i.test(key));
   if(candidate(value.trim(),field))unique.add(value.trim());
   if(path.at(-1)!=='custom_css')for(const m of remaining.join('').matchAll(/https?:\/\/[^\s"'\\<>]+/g)){const link=m[0].replace(/[;,}]+$/,'');if(candidate(link,false))unique.add(link)}
  }else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))walk(child,[...path,key]);
 }walk(theme);return [...unique];
}
export function replaceLinks(raw,replacements){
 function direct(text){
  const trimmed=text.trim(),exact=replacements.get(trimmed);
  if(exact)return text.replace(trimmed,()=>exact);
  return text.replace(/https?:\/\/[^\s"'\\<>]+/g,token=>{const link=token.replace(/[;,}]+$/,'');return replacements.has(link)?replacements.get(link)+token.slice(link.length):token});
 }
 function walk(value){
  if(typeof value==='string'){
   let result='',offset=0;
   for(const token of cssUrls(value)){
    result+=direct(value.slice(offset,token.start));
    const next=replacements.get(token.url);let replacement=next;
    if(!next){result+=value.slice(token.start,token.end);offset=token.end;continue;}
    if(token.quote)replacement=next.replace(/\\/g,'\\\\').replaceAll(token.quote,'\\'+token.quote);
    else if(/[\s"'()\\]/.test(next))replacement=JSON.stringify(next);
    result+=value.slice(token.start,token.valueStart)+replacement+value.slice(token.valueEnd,token.end);offset=token.end;
   }
   return result+direct(value.slice(offset));
  }
  if(Array.isArray(value))return value.map(walk);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,walk(child)]));
  return value;
 }return JSON.stringify(walk(JSON.parse(raw)),null,2);
}
export function renameTheme(raw,name){
 const theme=JSON.parse(raw);if(!theme||typeof theme!=='object'||Array.isArray(theme))throw new Error('美化 JSON 顶层必须是对象');
 const title=String(name||'').trim();if(!title)throw new Error('请填写搬家后的美化名称');theme.name=title;
 const indent=raw.match(/\r?\n([ \t]+)"/)?.[1]||'  ';return JSON.stringify(theme,null,indent)+(/\r?\n$/.test(raw)?'\n':'');
}
