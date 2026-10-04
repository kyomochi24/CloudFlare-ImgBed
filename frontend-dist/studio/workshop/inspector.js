/* SPDX-License-Identifier: AGPL-3.0-or-later */
// DOM-derived selector inspection; never evaluates user JavaScript.
window.createWorkshopInspector = function(tell) {
  let selected = null, selectedExact = '', enabled = false, hover = null;
  let scope = 'role', pseudo = '', nodes = [], generation = 0;
  const transient = /^(workshop-|fa-|fas$|far$|fab$|flex|align|justify|gap|margin|padding|display|hidden$|open|closed|last_mes$)/;
  const classes = el => [...el.classList].filter(c => !transient.test(c));
  function token(el) {for(let p=el;p;p=p.parentElement){if(p.id)return '#'+CSS.escape(p.id);if(classes(p)[0])return '.'+CSS.escape(classes(p)[0]);}return el.localName;}
  function segment(el) {
    if(el.id) return '#'+CSS.escape(el.id);
    const cls=classes(el);
    if(cls.length) return '.'+cls.map(CSS.escape).join('.');
    let result=el.localName;
    const siblings=el.parentElement ? [...el.parentElement.children].filter(x=>x.localName===el.localName) : [];
    if(siblings.length>1) result+=':nth-of-type('+(siblings.indexOf(el)+1)+')';
    return result;
  }
  function exact(el) {
    const parts=[];for(let p=el;p;p=p.parentElement){parts.unshift(p.id?'#'+CSS.escape(p.id):!p.parentElement?p.localName:p.localName+':nth-of-type('+([...p.parentElement?.children||[]].filter(n=>n.localName===p.localName).indexOf(p)+1)+')');if(p.id||p===document.documentElement)break;}
    return parts.join(' > ');
  }
  function selector(el) {
    if(scope==='one')return exact(el);
    const mes=el.closest('.mes');
    const anchor=mes ? '#chat .mes'+(scope==='role'?'[is_user="'+mes.getAttribute('is_user')+'"]':'') : '';
    if(el===mes)return anchor;
    const parts=[];
    for(let p=el;p&&p!==mes;p=p.parentElement){parts.unshift(segment(p));if(p.id||classes(p).length||p===document.documentElement)break;}
    return (anchor ? anchor+' ' : '')+parts.join(' > ');
  }
  function description(el) {
    const raw=el.localName+(el.id?'#'+el.id:'')+[...el.classList].filter(c=>!c.startsWith('workshop-')).map(c=>'.'+c).join('');
    return raw.length>140?raw.slice(0,137)+'…':raw;
  }
  function listFor(el,x,y) {
    generation++;nodes=[];
    const add=(node,kind)=>{if(!(node instanceof Element)||node.id.startsWith('workshop-')||node.closest('template')||nodes.some(n=>n.el===node))return;nodes.push({el:node,id:generation+':'+nodes.length,label:kind+' · '+description(node)});};
    add(el,'点选节点');for(let p=el.parentElement;p;p=p.parentElement)add(p,'父级');
    if(Number.isFinite(x)&&Number.isFinite(y)){for(const n of document.elementsFromPoint(x,y).slice(0,16))add(n,'同位置下层');}
  }
  function details() {
    if(!selected?.isConnected)return;
    const base=selector(selected),style=getComputedStyle(selected,pseudo||null),rect=selected.getBoundingClientRect();
    let count=0;try{count=document.querySelectorAll(base).length}catch{}
    const keys=['display','position','width','height','margin','padding','z-index','font-size','color','background-color','overflow','transform','content'];
    const computed=Object.fromEntries(keys.filter(k=>pseudo||k!=='content').map(k=>[k,style.getPropertyValue(k)]));
    const visible=selected.getClientRects().length>0&&getComputedStyle(selected).visibility!=='hidden';
    const generated=pseudo?style.content!=='none'&&style.content!=='normal'&&style.display!=='none':true;
    tell('selected',{selector:base+pseudo,searchToken:token(selected),nodeId:nodes.find(n=>n.el===selected)?.id||'',nodes:nodes.map(n=>({id:n.id,label:n.label})),computed,count,visible,generated,pseudo,scope,size:Math.round(rect.width)+' × '+Math.round(rect.height),nodeLabel:description(selected)});
  }
  function select(el,x,y) {
    if(!(el instanceof Element))return;
    selected=el;selectedExact=exact(el);pseudo='';listFor(el,x,y);details();
  }
  document.addEventListener('pointerover',e=>{if(!enabled)return;hover?.removeAttribute('data-workshop-hover');hover=e.target;hover.setAttribute('data-workshop-hover','')});
  return {
    select,
    setEnabled(value){enabled=!!value;document.body.classList.toggle('workshop-inspect',enabled);if(!enabled)hover?.removeAttribute('data-workshop-hover');},
    message(data){
      if(data.type==='catalog-query'){const rows=(Array.isArray(data.selectors)?data.selectors:[]).slice(0,80).map(selector=>{try{const list=[...document.querySelectorAll(selector)];return {selector,count:list.length,visible:list.some(el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden')};}catch{return {selector,count:0,visible:false};}});tell('catalog-status',{version:data.version,rows});}
      if(data.type==='inspect-node'){const node=nodes.find(n=>n.id===data.id);if(node?.el.isConnected){selected=node.el;selectedExact=exact(selected);details();}}
      if(data.type==='inspect-options'){if(['role','all','one'].includes(data.scope))scope=data.scope;if(['','::before','::after'].includes(data.pseudo))pseudo=data.pseudo;details();}
      if(data.type==='inspect-query'){try{const el=document.querySelector(data.selector);if(el){select(el);if(el.getClientRects().length)el.scrollIntoView({block:'nearest',inline:'nearest'});}else {selected=null;selectedExact='';nodes=[];tell('inspect-missing',{selector:data.selector});}}catch{tell('warning',{message:'该选择器暂时无法定位。'});}}
    },
    refresh(){if(selected&&!selected.isConnected){try{selected=document.querySelector(selectedExact)}catch{selected=null}if(selected)listFor(selected);}if(selected)details();},
  };
};
