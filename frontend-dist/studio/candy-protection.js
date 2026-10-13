import { drawProtectionMask, recolorCanvas } from './candy-recolor.js?v=20261014b';

export function initProtectionEditor({ sourceFor, onApply, notice }) {
  const dialog = document.getElementById('candy-protection-dialog');
  const find = id => document.getElementById('candy-protection-' + id);
  const original = find('original'), overlay = find('overlay'), after = find('after'), cursor = find('cursor');
  let session = null, opening = 0, tool = 'protect', drawing = null, frame = 0, previewTimer;
  function buttons() {
    find('undo').disabled = !session?.history.length;
    find('clear').disabled = !session?.strokes.length;
    find('save').disabled = !session || !!drawing;
    dialog.querySelectorAll('[data-protection-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.protectionTool === tool)));
    find('size-value').textContent = find('size').value + '%';
    find('hint').textContent = tool === 'erase' ? '擦除紫色保护，重新允许这些位置换色。' : '在左侧涂抹要保留原色的部分，右侧查看结果。';
  }
  function paint() {
    if (!session) return;
    drawProtectionMask(overlay, session.strokes);
    const ctx = overlay.getContext('2d');
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#9691d7'; ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.globalCompositeOperation = 'source-over';
    clearTimeout(previewTimer);
    const current = session;
    previewTimer = setTimeout(async () => {
      if (session !== current) return;
      after.getContext('2d').clearRect(0, 0, after.width, after.height);
      after.getContext('2d').drawImage(current.source, 0, 0);
      await recolorCanvas(after, current.rule, { strokes: current.strokes });
    }, 100);
    buttons();
  }
  function schedulePaint() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paint(); });
  }
  function stopDrawing() {
    if (!drawing) return;
    const pointer = drawing.pointer;
    drawing = null;
    if (overlay.hasPointerCapture(pointer)) overlay.releasePointerCapture(pointer);
    paint();
  }
  function close() {
    opening++; stopDrawing(); clearTimeout(previewTimer); cancelAnimationFrame(frame); frame = 0;
    session = null; cursor.hidden = true;
    if (dialog.open) dialog.close();
    for (const canvas of [original, overlay, after]) { canvas.width = 1; canvas.height = 1; }
  }
  async function open(item, index) {
    const version = ++opening;
    try {
      const source = await sourceFor(item);
      if (version !== opening) return;
      if (dialog.open) close();
      session = { item, index, source, rule: structuredClone(item.recolors?.length ? item.recolors : [item.recolor]), strokes: structuredClone(item.protection || []), history: [] };
      for (const canvas of [original, overlay, after]) { canvas.width = source.width; canvas.height = source.height; }
      original.getContext('2d').drawImage(source, 0, 0);
      find('title').textContent = '保护第 ' + (index + 1) + ' 张图片';
      tool = 'protect'; find('size').value = 8;
      dialog.showModal(); paint();
    } catch (error) { notice('图片无法打开：' + error.message, true); }
  }
  function coordinates(event, constrain = false) {
    const rect = overlay.getBoundingClientRect(), scale = Math.min(rect.width / overlay.width, rect.height / overlay.height);
    const left = rect.left + (rect.width - overlay.width * scale) / 2;
    const top = rect.top + (rect.height - overlay.height * scale) / 2;
    let x = (event.clientX - left) / scale / overlay.width, y = (event.clientY - top) / scale / overlay.height;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    const diameter = Number(find('size').value) / 100 * Math.min(overlay.width, overlay.height) * scale;
    cursor.hidden = !inside;
    cursor.style.width = diameter + 'px'; cursor.style.height = diameter + 'px';
    cursor.style.left = event.clientX - rect.left + 'px'; cursor.style.top = event.clientY - rect.top + 'px';
    if (!inside && !constrain) return null;
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    return [x, y];
  }
  overlay.addEventListener('pointerdown', event => {
    if (!session || drawing || event.button !== 0) return;
    const point = coordinates(event); if (!point) return;
    event.preventDefault();
    const stroke = { tool, size: Number(find('size').value) / 100, points: [point] };
    session.strokes.push(stroke); session.history.push({ kind: 'stroke' });
    drawing = { pointer: event.pointerId, stroke };
    overlay.setPointerCapture(event.pointerId); schedulePaint();
  });
  overlay.addEventListener('pointermove', event => {
    if (!session) return;
    const point = coordinates(event, !!drawing);
    if (!drawing || drawing.pointer !== event.pointerId || !point) return;
    event.preventDefault();
    const points = drawing.stroke.points, last = points.at(-1);
    if (Math.hypot((point[0] - last[0]) * overlay.width, (point[1] - last[1]) * overlay.height) < .7) return;
    // Bound each stroke's saved size while retaining its full path.
    if (points.length >= 8192) drawing.stroke.points = points.filter((_, i) => i % 2 === 0);
    drawing.stroke.points.push(point); schedulePaint();
  });
  overlay.addEventListener('pointerup', event => { if (drawing?.pointer === event.pointerId) stopDrawing(); });
  overlay.addEventListener('pointercancel', event => { if (drawing?.pointer === event.pointerId) stopDrawing(); });
  overlay.addEventListener('lostpointercapture', stopDrawing);
  overlay.addEventListener('pointerleave', () => { if (!drawing) cursor.hidden = true; });
  dialog.querySelectorAll('[data-protection-tool]').forEach(button => button.addEventListener('click', () => {
    stopDrawing(); tool = button.dataset.protectionTool; buttons();
  }));
  find('size').addEventListener('input', buttons);
  function undo() {
    if (!session || drawing) return;
    const action = session.history.pop(); if (!action) return;
    if (action.kind === 'clear') session.strokes = action.previous;
    else session.strokes.pop();
    paint();
  }
  find('undo').addEventListener('click', undo);
  find('clear').addEventListener('click', () => {
    if (!session || drawing || !session.strokes.length) return;
    session.history.push({ kind: 'clear', previous: session.strokes }); session.strokes = []; paint();
  });
  dialog.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input,textarea')) {
      event.preventDefault(); undo();
    }
  });
  find('save').addEventListener('click', () => {
    if (!session || drawing) return;
    const { item, index, strokes } = session;
    onApply(item, index, structuredClone(strokes)); close();
  });
  find('close').addEventListener('click', close);
  find('cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  return { open, close };
}
