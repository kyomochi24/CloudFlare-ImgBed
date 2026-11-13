// SPDX-License-Identifier: AGPL-3.0-or-later
(() => {
  const key = 'qiuqiu-studio-font-size';
  const sizes = [['small', '小', '90%'], ['default', '默认', '100%'], ['large', '大', '115%']];
  const root = document.documentElement;
  let current = 'default';
  let menu;

  function apply(value) {
    current = sizes.some(([size]) => size === value) ? value : 'default';
    root.dataset.studioFontSize = current;
    if (!menu) return;
    for (const input of menu.querySelectorAll('input')) input.checked = input.value === current;
  }

  try { apply(localStorage.getItem(key)); }
  catch { apply(null); }

  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.topbar, .app-header');
    if (!header) return;
    menu = document.createElement('details');
    menu.className = 'studio-display';
    menu.innerHTML = `
      <summary aria-label="显示设置" title="显示设置">Aa</summary>
      <fieldset>
        <legend>界面字体大小</legend>
        <div class="studio-font-options">
          ${sizes.map(([value, name, percent]) => `<label><input type="radio" name="studio-font-size" value="${value}"><span>${name}<small>${percent}</small></span></label>`).join('')}
        </div>
      </fieldset>`;
    header.append(menu);
    apply(current);
    menu.addEventListener('change', event => {
      apply(event.target.value);
      try { localStorage.setItem(key, current); } catch { /* Keep this page's setting. */ }
    });
    document.addEventListener('click', event => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
