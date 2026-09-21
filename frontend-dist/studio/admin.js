(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function workReference(value) {
    if (!value) return '';
    let href = '';
    try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) href = url.href; } catch { /* Arbitrary notes are shown as text. */ }
    return `<p>作品：${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>` : escapeHtml(value)}</p>`;
  }
  const fmt = n => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;
  function notice(message, error = false) { const el = $('admin-notice'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 6500); }
  async function api(path, method = 'GET', data) { const response = await fetch(`/api/studio/admin/${path}`, { method, credentials: 'same-origin', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || `请求失败 (${response.status})`); return value; }
  const imageUrls = () => $('announcement-image-urls').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  function announcementPreview() {
    const preview = $('announcement-preview');
    preview.style.backgroundColor = $('announcement-background').value;
    preview.style.color = $('announcement-text-color').value;
    preview.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = $('announcement-title-input').value || '甜品屋公告';
    const content = document.createElement('div');
    content.textContent = $('announcement-content-input').value || '公告内容会显示在这里 ♡';
    preview.append(title, content);
    const gallery = document.createElement('div');
    gallery.className = 'announcement-preview-images';
    for (const url of imageUrls().slice(0, 10)) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') continue;
        const image = document.createElement('img');
        image.src = parsed.href;
        image.alt = '公告图片预览';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        gallery.append(image);
      } catch { /* Invalid links are rejected when saving. */ }
    }
    preview.append(gallery);
  }
  function renderAnnouncement(news) {
    $('announcement-enabled').checked = !!news.enabled;
    $('announcement-title-input').value = news.title || '';
    $('announcement-content-input').value = news.content || '';
    $('announcement-background').value = news.backgroundColor || '#fff8f2';
    $('announcement-text-color').value = news.textColor || '#604c56';
    $('announcement-image-urls').value = (news.imageUrls || []).join('\n');
    announcementPreview();
  }
  async function load() {
    try { const [data, news] = await Promise.all([api('overview'), api('announcement')]); $('needs-admin').classList.add('hidden'); $('admin-content').classList.remove('hidden'); render(data); renderAnnouncement(news.announcement); }
    catch (e) { $('admin-content').classList.add('hidden'); $('needs-admin').classList.remove('hidden'); if (!e.message.includes('请先登录')) notice(e.message, true); }
  }
  function render(data) {
    const pending = data.applications.filter(a => a.status === 'pending');
    $('application-list').innerHTML = pending.length ? pending.map(a => `<div class="admin-row"><div><strong>${escapeHtml(a.work_title)}</strong><span class="tag">${escapeHtml(a.discord_name || a.username || '用户')}</span><p>Discord ID：${escapeHtml(a.discord_id)} · 提交于 ${escapeHtml(a.created_at)}</p>${workReference(a.work_url)}${a.note ? `<p>留言：${escapeHtml(a.note)}</p>` : ''}</div><div class="admin-actions"><button class="approve" data-review="${escapeHtml(a.id)}" data-decision="approved">通过 · 皮卡丘</button><button class="reject" data-review="${escapeHtml(a.id)}" data-decision="rejected">不通过</button></div></div>`).join('') : '<div class="admin-empty">现在没有待审核的申请 ✿</div>';
    $('user-list').innerHTML = data.users.length ? data.users.map(u => { const tier = u.is_super ? 'super' : u.tier; return `<div class="admin-row"><div><strong>${escapeHtml(u.discord_name || u.username || u.id)}</strong><span class="tag">${tier === 'super' ? '超级无敌美化大师丘' : tier === 'pikachu' ? '皮卡丘' : '皮丘'}</span>${u.disabled ? '<span class="tag">已停用</span>' : ''}<p>${u.account_type === 'discord' ? 'Discord' : '专用账号'} · ${escapeHtml(u.discord_id || u.username || '')} · 已存 ${fmt(u.stored_bytes)} · 本月上传 ${fmt(u.month_uploaded_bytes)}</p></div><div class="admin-actions"><label class="tier-picker">站内身份<select data-tier-user="${escapeHtml(u.id)}"><option value="pichu" ${tier === 'pichu' ? 'selected' : ''}>皮丘</option><option value="pikachu" ${tier === 'pikachu' ? 'selected' : ''}>皮卡丘</option><option value="super" ${tier === 'super' ? 'selected' : ''}>超级无敌美化大师丘</option></select></label><button data-user="${escapeHtml(u.id)}" data-disabled="${u.disabled ? 'false' : 'true'}">${u.disabled ? '启用' : '停用'}</button></div></div>`; }).join('') : '<div class="admin-empty">还没有用户</div>';
  }
  $('application-list').addEventListener('click', async event => { const b = event.target.closest('[data-review]'); if (!b) return; if (!confirm(`确定${b.dataset.decision === 'approved' ? '通过' : '驳回'}这份申请吗？`)) return; b.disabled = true; try { await api(`applications/${encodeURIComponent(b.dataset.review)}`, 'POST', { decision: b.dataset.decision }); notice('审核已保存'); await load(); } catch (e) { notice(e.message, true); b.disabled = false; } });
  $('user-list').addEventListener('click', async event => { const b = event.target.closest('[data-user]'); if (!b) return; const data = b.dataset.tier ? { tier: b.dataset.tier } : { disabled: b.dataset.disabled === 'true' }; if (!confirm('确定修改这个用户吗？')) return; b.disabled = true; try { await api(`users/${encodeURIComponent(b.dataset.user)}`, 'PATCH', data); notice('用户权限已更新'); await load(); } catch (e) { notice(e.message, true); b.disabled = false; } });
  $('user-list').addEventListener('change', async event => { const select = event.target.closest('[data-tier-user]'); if (!select) return; const tier = select.value; if (!confirm(`确定把这个用户设为「${select.selectedOptions[0].textContent}」吗？`)) { await load(); return; } select.disabled = true; try { await api(`users/${encodeURIComponent(select.dataset.tierUser)}`, 'PATCH', { tier }); notice('用户身份已更新'); await load(); } catch (e) { notice(e.message, true); await load(); } });
  $('create-user').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button'); button.disabled = true; try { const user = await api('users', 'POST', Object.fromEntries(form)); notice(`账号 ${user.username} 已创建。请用安全方式把你设置的密码交给用户。`); event.currentTarget.reset(); await load(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; } });
  $('announcement-form').addEventListener('input', announcementPreview);
  $('announcement-file-input').addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (files.length > 4 || files.some(file => file.size > 5 * 1048576) || imageUrls().length + files.length > 10) return notice('一次最多上传 4 张图片，每张不超过 5 MB；公告最多放 10 张', true);
    const form = new FormData();
    files.forEach(file => form.append('images', file));
    $('announcement-feedback').textContent = '正在上传公告图片…';
    try {
      const response = await fetch('/api/studio/admin/announcement/images', { method: 'POST', credentials: 'same-origin', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `上传失败 (${response.status})`);
      $('announcement-image-urls').value = [...imageUrls(), ...data.urls].join('\n');
      $('announcement-feedback').textContent = `已上传 ${data.urls.length} 张图片，记得保存公告`;
      announcementPreview();
    } catch (error) { $('announcement-feedback').textContent = error.message; notice(error.message, true); }
  });
  $('announcement-form').addEventListener('submit', async event => {
    event.preventDefault();
    const urls = imageUrls();
    if (urls.length > 10 || urls.some(value => { try { const url = new URL(value); return url.protocol !== 'https:' || !!url.username || !!url.password; } catch { return true; } })) return notice('图片图链请每行填一条 HTTPS 链接，最多 10 条', true);
    const button = $('announcement-save');
    button.disabled = true;
    $('announcement-feedback').textContent = '正在保存…';
    try {
      await api('announcement', 'PATCH', { enabled: $('announcement-enabled').checked, title: $('announcement-title-input').value, content: $('announcement-content-input').value, backgroundColor: $('announcement-background').value, textColor: $('announcement-text-color').value, imageUrls: urls });
      $('announcement-feedback').textContent = '公告已保存 ✿';
      notice('公告已保存，访客刷新页面即可看到');
    } catch (error) { $('announcement-feedback').textContent = error.message; notice(error.message, true); }
    finally { button.disabled = false; }
  });
  load();
})();
