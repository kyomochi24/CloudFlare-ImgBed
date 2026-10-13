// SPDX-License-Identifier: AGPL-3.0-or-later
import {DEFAULT_THEME, DEFAULT_SAMPLE} from './workshop/core.mjs?v=20261014c';

export function initCandyThemePreview({buildSnapshot, notice}) {
  const find = id => document.getElementById('candy-theme-preview-' + id);
  const dialog = find('dialog'), frame = find('frame'), refresh = find('refresh'), state = find('state');
  const base = new URL('./workshop/', import.meta.url).href;
  let template = '', ready = false, channel = '', payload = null, revision = 0, appliedRevision = -1, request = 0, applying = false, replyTimer;
  function expectReply() {
    clearTimeout(replyTimer);
    replyTimer=setTimeout(()=>{
      if(!dialog.open||!applying)return;
      applying=false;refresh.disabled=false;state.textContent='预览没有响应，请确认工坊资源完整后重试。';
    },12000);
  }
  function dirtyText() {
    find('hint').textContent = appliedRevision < 0 ? '点击后生成当前整套效果' : revision === appliedRevision ? '预览已更新' : '有新调整 · 点击预览更新';
    if (dialog.open && !applying) state.textContent = revision === appliedRevision ? '已更新 · 调色后请点击“更新预览”' : '有新调整，点击“更新预览”查看';
  }
  function markDirty() { revision++; dirtyText(); }
  function resize() {
    const [width,height] = find('device').value.split(',').map(Number), stage = find('stage');
    frame.width = width; frame.height = height; frame.style.width = width + 'px'; frame.style.height = height + 'px';
    const scale = Math.min(1, Math.max(.08,(stage.clientWidth - 24) / width), Math.max(.08,(stage.clientHeight - 24) / height));
    find('space').style.width = width * scale + 'px'; find('space').style.height = height * scale + 'px';
    frame.style.transform = 'scale(' + scale + ')';
  }
  function send() {
    if (!ready || !payload || !dialog.open) return;
    const data = payload; payload = null;
    expectReply();
    frame.contentWindow.postMessage({channel,type:'render',theme:{...DEFAULT_THEME,...data.theme},sample:{...DEFAULT_SAMPLE},assets:data.assets},'*');
  }
  async function boot(version) {
    if (channel) return;
    if (!template) {
      const response = await fetch(new URL('frame.html?v=20261014c',base));
      if (!response.ok) throw new Error('工坊预览资源读取失败，请确认 workshop 文件夹已上传');
      template = await response.text();
    }
    if(version!==request||!dialog.open)return;
    channel = crypto.randomUUID(); const nonce = crypto.randomUUID().replaceAll('-','');
    frame.srcdoc = template.replaceAll('__BASE__',base.replaceAll('&','&amp;').replaceAll('"','&quot;')).replaceAll('__CHANNEL__',channel).replaceAll('__NONCE__',nonce);
    expectReply();
  }
  async function update() {
    if (applying) return;
    const version = ++request, snapshotRevision = revision;
    applying = true; refresh.disabled = true; state.textContent = '正在准备当前效果…';
    try {
      const data = await buildSnapshot(message => { if (version === request) state.textContent = message; }, () => version === request);
      if (version !== request || !dialog.open || !data) return;
      payload = {...data,revision:snapshotRevision};
      await boot(version);
      if (version !== request || !dialog.open) return;
      // Applied revision belongs to the snapshot, even if controls changed while processing.
      appliedRevision = snapshotRevision; send(); resize();
    } catch (error) {
      if (version !== request) return;
      applying = false; refresh.disabled = false; state.textContent = '预览未更新：' + error.message;
      notice(error.message,true);
    }
  }
  function close() {
    request++; clearTimeout(replyTimer); payload = null; ready = false; channel = ''; applying = false;
    refresh.disabled = false; frame.srcdoc = ''; appliedRevision = -1;
    if (dialog.open) dialog.close(); dirtyText();
  }
  find('open').addEventListener('click', () => { dialog.showModal(); resize(); update(); });
  refresh.addEventListener('click',update);
  find('close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  find('device').addEventListener('change',resize);
  new ResizeObserver(()=>{if(dialog.open)resize();}).observe(find('stage'));
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==frame.contentWindow || !channel || data?.channel!==channel || data.source!=='qiuqiu-preview')return;
    if(data.type==='ready'){ready=true;send();}
    if(data.type==='rendered'){clearTimeout(replyTimer);applying=false;refresh.disabled=false;dirtyText();}
    if(data.type==='error'){clearTimeout(replyTimer);applying=false;refresh.disabled=false;state.textContent='预览未更新：'+data.message;}
  });
  return {markDirty,close};
}
