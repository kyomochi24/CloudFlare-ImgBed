// SPDX-License-Identifier: AGPL-3.0-or-later
(() => {
  const key = 'qiuqiu-studio-font-size';
  const defaultKey = 'qiuqiu-studio-default-font-size';
  const sizes = [['small', '小', 90], ['default', '默认', 100], ['large', '大', 115]];
  const min = 70;
  const max = 170;
  const root = document.documentElement;
  let current = 100;
  let defaultSize = 100;
  let menu;
  let slider;
  let readout;

  function normalize(value, fallback = 100) {
    const number = value == null || value === '' ? NaN : Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  }

  function apply(value) {
    const legacy = sizes.find(([name]) => name === value);
    current = value === 'default' ? defaultSize : legacy?.[2] ?? normalize(value, defaultSize);
    root.style.setProperty('--studio-font-scale', `${current}%`);
    root.toggleAttribute('data-studio-font-enlarged', current > 115);
    if (!menu) return;
    const active = current === defaultSize ? 'default' : sizes.find(([name, , percent]) => name !== 'default' && percent === current)?.[0];
    for (const input of menu.querySelectorAll('input[type="radio"]')) {
      input.checked = input.value === active;
    }
    menu.querySelector('[data-default-percent]').textContent = `${defaultSize}%`;
    slider.value = String(current);
    slider.setAttribute('aria-valuetext', `${current}%`);
    readout.value = `${current}%`;
  }

  function save(name, value) {
    try { localStorage.setItem(name, String(value)); } catch { /* Keep this page's setting. */ }
  }

  try {
    defaultSize = normalize(localStorage.getItem(defaultKey));
    apply(localStorage.getItem(key));
  }
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
          ${sizes.map(([value, name, percent]) => `<label><input type="radio" name="studio-font-size" value="${value}"><span>${name}<small ${value === 'default' ? 'data-default-percent' : ''}>${percent}%</small></span></label>`).join('')}
        </div>
        <div class="studio-font-custom">
          <div><label for="studio-font-slider">自定义字号</label><output for="studio-font-slider"></output></div>
          <input id="studio-font-slider" type="range" min="${min}" max="${max}" step="1">
          <div class="studio-font-limits" aria-hidden="true"><span>${min}%</span><span>${max}%</span></div>
        </div>
        <div class="studio-font-actions">
          <button type="button" data-set-default>设为默认</button>
          <button type="button" data-reset-font>恢复初始设置</button>
        </div>
        <p class="studio-font-status" role="status" hidden></p>
      </fieldset>`;
    slider = menu.querySelector('#studio-font-slider');
    readout = menu.querySelector('output');
    header.append(menu);
    apply(current);
    const status = menu.querySelector('.studio-font-status');
    const setDefault = menu.querySelector('[data-set-default]');
    const reset = menu.querySelector('[data-reset-font]');
    function announce(message) {
      status.hidden = false;
      status.textContent = message;
    }
    slider.addEventListener('input', () => {
      status.hidden = true;
      apply(slider.value);
    });
    menu.addEventListener('change', event => {
      status.hidden = true;
      apply(event.target.value);
      save(key, current);
    });
    setDefault.addEventListener('click', () => {
      defaultSize = current;
      save(defaultKey, defaultSize);
      save(key, current);
      apply(current);
      announce(`默认字号已设为 ${defaultSize}%`);
    });
    reset.addEventListener('click', () => {
      defaultSize = 100;
      save(defaultKey, 100);
      save(key, 100);
      apply(100);
      announce('已恢复初始字号 100%');
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
    if (event.key === key) apply(event.newValue);
    if (event.key === defaultKey) {
      defaultSize = normalize(event.newValue);
      apply(current);
    }
    if (event.key === null) {
      defaultSize = 100;
      apply(100);
    }
  });
})();
