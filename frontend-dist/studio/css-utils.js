function escapeEnd(t,i){const h=t.slice(i+1).match(/^[0-9a-f]{1,6}(?:\s)?/i);return h?i+1+h[0].length:Math.min(t.length,i+2)}
function quoteEnd(t,i){const q=t[i];i++;while(i<t.length){if(t[i]==='\\')i=escapeEnd(t,i);else if(t[i++]===q)break}return i}
export function cssUrls(text){
 const urls=[];
 for(let i=0;i<text.length;){
  if(text.startsWith('/*',i)){const e=text.indexOf('*/',i+2);i=e<0?text.length:e+2;continue}
  if(text[i]==='"'||text[i]==="'"){i=quoteEnd(text,i);continue}
  const m=!/[\w-]/.test(text[i-1]||'')&&text.slice(i).match(/^url\s*\(/i);if(!m){i++;continue}
  const start=i;let p=i+m[0].length;while(p<text.length&&/\s/.test(text[p]))p++;
  const quote=['"',"'"].includes(text[p])?text[p++]:'',valueStart=p;
  if(quote)p=quoteEnd(text,p-1)-1;else while(p<text.length&&text[p]!==')')p=text[p]==='\\'?escapeEnd(text,p):p+1;
  let valueEnd=p;if(quote){if(text[p]!==quote){i=p+1;continue}p++}else while(valueEnd>valueStart&&/\s/.test(text[valueEnd-1]))valueEnd--;
  while(p<text.length&&/\s/.test(text[p]))p++;if(text[p]!==')'){i=p+1;continue}
  const url=text.slice(valueStart,valueEnd).replace(/\\(?:([0-9a-f]{1,6})\s?|([\s\S]))/gi,(_,h,c)=>{if(h){const n=parseInt(h,16);return n&&n<=0x10ffff?String.fromCodePoint(n):'\ufffd'}return /[\n\r\f]/.test(c)?'':c});
  urls.push({url,start,end:p+1,valueStart,valueEnd,quote});i=p+1;
 }return urls;
}
export function cssDeclarations(text){
 const result=[];let boundary=0,depth=0;
 const finish=end=>{const masked=text.slice(boundary,end).replace(/\/\*[\s\S]*?\*\//g,m=>' '.repeat(m.length)),m=masked.match(/^\s*([\p{L}_-][\p{L}\p{N}_-]*)\s*:\s*/u);if(m)result.push({property:m[1],start:boundary+m[0].length,end})};
 for(let i=0;i<text.length;i++){
  if(text.startsWith('/*',i)){const e=text.indexOf('*/',i+2);i=e<0?text.length:e+1;continue}
  if(text[i]==='"'||text[i]==="'"){i=quoteEnd(text,i)-1;continue}
  if(text[i]==='\\'){i=escapeEnd(text,i)-1;continue}
  if(text[i]==='(')depth++;if(text[i]===')')depth=Math.max(0,depth-1);if(depth)continue;
  if(text[i]==='{')boundary=i+1;if(text[i]===';'||text[i]==='}'){finish(i);boundary=i+1}
 }finish(text.length);return result;
}
export function cssColorText(text){
 const chars=text.split(''),blank=(a,b)=>{for(let i=a;i<b;i++)chars[i]=' '};
 for(let i=0;i<text.length;i++){if(text.startsWith('/*',i)){const e=text.indexOf('*/',i+2),stop=e<0?text.length:e+2;blank(i,stop);i=stop-1}else if(text[i]==='"'||text[i]==="'"){const stop=quoteEnd(text,i);blank(i,stop);i=stop-1}}
 for(const token of cssUrls(text))blank(token.start,token.end);return chars.join('');
}
