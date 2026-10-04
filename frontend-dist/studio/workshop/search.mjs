// SPDX-License-Identifier: AGPL-3.0-or-later
export function findMatches(text,query,matchCase=false){
  if(!query)return [];
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(escaped,matchCase?'gu':'giu'),matches=[];
  let match,line=1,lineStart=0,scanned=0;
  while((match=pattern.exec(text))!==null){
    for(let i=scanned;i<match.index;i++)if(text[i]==='\n'){line++;lineStart=i+1;}
    scanned=match.index;
    matches.push({start:match.index,end:match.index+match[0].length,line,column:match.index-lineStart+1});
  }
  return matches;
}
export function replaceMatches(text,matches,replacement){let out='',start=0;for(const m of matches){out+=text.slice(start,m.start)+replacement;start=m.end;}return out+text.slice(start);}
export function lineOffset(text,line){const target=Math.max(1,Math.trunc(Number(line)||1));let start=0;for(let n=1;n<target;n++){const i=text.indexOf('\n',start);if(i===-1)return text.length;start=i+1;}return start;}
export function initCodeSearch({editor,$,setCss,switchView,toast}){
  let matches=[],current=-1;
  function updateCounter(){const m=matches[current];$('search-location').textContent=m?'第 '+m.line+' 行 · 第 '+m.column+' 列。':''; $('search-count').textContent=(current>=0?current+1:0)+' / '+matches.length;for(const id of ['search-prev','search-next','replace-one','replace-all'])$(id).disabled=!matches.length;}
  function selectMatch(index,focus=false){if(!matches.length){current=-1;updateCounter();return;}current=(index+matches.length)%matches.length;const m=matches[current];if(focus)editor.focus({preventScroll:true});editor.setSelectionRange(m.start,m.end);const lineHeight=parseFloat(getComputedStyle(editor).lineHeight)||23.4;editor.scrollTop=Math.max(0,(m.line-1)*lineHeight-editor.clientHeight/2);const before=editor.value.slice(editor.value.lastIndexOf('\n',m.start-1)+1,m.start);const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(editor).font;editor.scrollLeft=Math.max(0,ctx.measureText(before.replaceAll('\t','  ')).width-editor.clientWidth/2);$('line-numbers').scrollTop=editor.scrollTop;updateCounter();editor.classList.add('search-flash');setTimeout(()=>editor.classList.remove('search-flash'),450);}
  function refresh(jump=false){const prior=matches[current]?.start??editor.selectionStart;matches=findMatches(editor.value,$('code-search').value,$('search-case').checked);current=matches.findIndex(m=>m.start>=prior);if(current<0&&matches.length)current=0;if(jump)selectMatch(current<0?0:current);else updateCounter();}
  function open(query){$('search-panel').hidden=false;switchView('code');if(query!==undefined)$('code-search').value=query;refresh(false);if(matches.length)selectMatch(0,false);$('code-search').focus();$('code-search').select();}
  function next(delta){refresh(false);selectMatch(current<0?0:current+delta,true);}
  $('open-search').onclick=()=>open();$('close-search').onclick=()=>{$('search-panel').hidden=true;editor.focus()};$('code-search').oninput=()=>{matches=[];current=-1;refresh(false);if(matches.length)selectMatch(0,false)};$('search-case').onchange=()=>refresh(true);$('search-prev').onclick=()=>next(-1);$('search-next').onclick=()=>next(1);
  $('code-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();next(e.shiftKey?-1:1)}};
  $('toggle-replace').onclick=()=>{$('replace-row').hidden=!$('replace-row').hidden;};
  $('replace-one').onclick=()=>{refresh(false);const m=matches[current];if(!m)return;const replacement=$('code-replace').value;const pos=m.start+replacement.length;setCss(editor.value.slice(0,m.start)+replacement+editor.value.slice(m.end));editor.setSelectionRange(pos,pos);matches=[];current=-1;refresh(false);const i=matches.findIndex(x=>x.start>=pos);if(matches.length)selectMatch(i<0?0:i,true);toast('已替换 1 处，可撤销。')};
  $('replace-all').onclick=()=>{refresh(false);if(!matches.length)return;const total=matches.length;setCss(replaceMatches(editor.value,matches,$('code-replace').value));matches=[];current=-1;refresh(false);toast('已替换 '+total+' 处，可撤销。')};
  function jumpLine(){const offset=lineOffset(editor.value,$('goto-line').value);editor.focus();editor.setSelectionRange(offset,offset);const line=editor.value.slice(0,offset).split('\n').length;editor.scrollTop=Math.max(0,(line-1)*(parseFloat(getComputedStyle(editor).lineHeight)||23.4)-editor.clientHeight/2);editor.scrollLeft=0;$('line-numbers').scrollTop=editor.scrollTop;toast('已跳到第 '+line+' 行')}
  $('goto-submit').onclick=jumpLine;$('goto-line').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();jumpLine()}};
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();const selected=editor.value.slice(editor.selectionStart,editor.selectionEnd);open(selected&&!selected.includes('\n')?selected:undefined);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){e.preventDefault();$('search-panel').hidden=false;switchView('code');$('goto-line').focus();$('goto-line').select();}if(e.key==='Escape'&&!$('search-panel').hidden){$('search-panel').hidden=true;editor.focus();}});
  return {refresh,open};
}
