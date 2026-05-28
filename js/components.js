// js/components.js — small reusable UI helpers (no framework)

import { fileToDataURL, esc, download, toast, copyText } from './utils.js';
import { PROVIDER_LIST, providersFor } from './api/index.js';
import { loadSettings } from './settings.js';

/* ───────────────────────── Layout primitives ───────────────────────── */

/**
 * A numbered step frame. Returns { el, body }.
 *   stepFrame(1, 'Prompt', '描述...')
 * Body is where you append sub-cards / inputs.
 */
export function stepFrame(num, title, subtitle) {
  const el = document.createElement('section');
  el.className = 'step-card mb-5';
  el.innerHTML = `
    <header class="flex items-start gap-3 mb-4">
      <div class="step-bubble">${esc(String(num))}</div>
      <div class="flex-1 min-w-0">
        <h2 class="text-base font-semibold text-slate-900">${esc(title)}</h2>
        ${subtitle ? `<p class="text-sm text-slate-500 mt-0.5">${esc(subtitle)}</p>` : ''}
      </div>
    </header>
    <div data-role="body" class="space-y-4"></div>
  `;
  return { el, body: el.querySelector('[data-role=body]') };
}

/**
 * A nested sub-card inside a step. Used for distinct sub-sections like
 * "反推" / "提示词列表" / each slot. Has its own light frame + title.
 */
export function subCard(title, { hint, badge } = {}) {
  const el = document.createElement('div');
  el.className = 'sub-card';
  el.innerHTML = `
    <header class="flex items-center justify-between gap-2 mb-2">
      <h3 class="font-medium text-sm text-slate-700">${esc(title)}</h3>
      ${badge ? `<span class="sub-badge">${esc(badge)}</span>` : ''}
    </header>
    ${hint ? `<p class="text-xs text-slate-500 mb-2">${esc(hint)}</p>` : ''}
    <div data-role="body"></div>
  `;
  return { el, body: el.querySelector('[data-role=body]') };
}

/** Plain section (kept for history/settings pages) */
export function section(title, contentNode, subtitle) {
  const s = document.createElement('section');
  s.className = 'card mb-5';
  s.innerHTML = `
    <h2 class="text-base font-semibold text-slate-900 mb-1">${esc(title)}</h2>
    ${subtitle ? `<p class="text-sm text-slate-500 mb-3">${esc(subtitle)}</p>` : '<div class="mb-3"></div>'}
  `;
  s.appendChild(contentNode);
  return s;
}

/* ───────────────────────── Provider select ───────────────────────── */

/**
 * Provider dropdown filtered by capability.
 * Only providers whose meta.capabilities includes `capability` are shown.
 * Default selection comes from settings.preferred[capability] (if it supports it).
 */
export function providerSelect(capability) {
  const list = providersFor(capability);
  const s = loadSettings();
  let cur = s.preferred[capability];
  if (!list.find(p => p.id === cur)) cur = list[0]?.id || '';
  const sel = document.createElement('select');
  sel.className = 'form-input';
  if (!list.length) {
    const o = document.createElement('option');
    o.textContent = '（无可用服务商）';
    o.disabled = true; o.selected = true;
    sel.appendChild(o);
    sel.disabled = true;
  } else {
    list.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      if (p.id === cur) o.selected = true;
      sel.appendChild(o);
    });
  }
  return sel;
}

/* ───────────────────────── Image dropzone ───────────────────────── */

/**
 * Reusable image dropzone.
 *   const dz = imageDropzone({ multiple: true, onChange })
 *   dz.el         — DOM
 *   dz.getFiles() — [{ name, dataURL }]
 *   dz.setFiles([{name,dataURL}]) — replace contents
 *   dz.clear()
 *
 * "compact: true" gives a smaller frame suitable for slot sub-cards.
 */
export function imageDropzone({
  label = '',
  multiple = false,
  accept = 'image/*',
  initial = [],
  compact = false,
  onChange,
} = {}) {
  const id = 'dz-' + Math.random().toString(36).slice(2, 8);
  const el = document.createElement('div');
  el.innerHTML = `
    ${label ? `<label class="form-label">${esc(label)}</label>` : ''}
    <label for="${id}" class="dropzone block ${compact ? 'p-3 text-xs' : ''}">
      <div class="text-slate-500" data-role="hint">点击或拖拽图片到此处${multiple ? '（可多张）' : ''}</div>
      <input id="${id}" type="file" accept="${accept}" ${multiple ? 'multiple' : ''} class="hidden" />
    </label>
    <div data-role="thumbs" class="grid ${compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-4'} gap-2 mt-2"></div>
  `;
  const input = el.querySelector('input');
  const dz = el.querySelector('label.dropzone');
  const thumbs = el.querySelector('[data-role=thumbs]');
  const hint = el.querySelector('[data-role=hint]');

  let files = [...(initial || [])];
  const thumbHeight = compact ? 'h-16' : 'h-24';

  function render() {
    thumbs.innerHTML = '';
    files.forEach((f, i) => {
      const c = document.createElement('div');
      c.className = 'relative group';
      c.innerHTML = `
        <img src="${f.dataURL}" class="w-full ${thumbHeight} object-cover rounded-md border border-slate-200" />
        <button class="absolute top-0.5 right-0.5 bg-black/70 text-white text-[10px] leading-none rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100" title="删除">×</button>
      `;
      c.querySelector('button').onclick = (ev) => {
        ev.preventDefault();
        files.splice(i, 1);
        render();
        onChange?.(files);
      };
      thumbs.appendChild(c);
    });
    hint.textContent = files.length
      ? (multiple ? `已选 ${files.length} 张，可继续添加` : '已选 1 张（再次选会替换）')
      : `点击或拖拽图片到此处${multiple ? '（可多张）' : ''}`;
  }

  async function add(list) {
    const arr = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (!arr.length) return;
    const newOnes = await Promise.all(arr.map(async f => ({
      name: f.name,
      dataURL: await fileToDataURL(f),
    })));
    if (multiple) files.push(...newOnes);
    else files = [newOnes[0]];
    render();
    onChange?.(files);
  }

  input.onchange = e => add(e.target.files);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('dragover'); add(e.dataTransfer.files); };

  render();
  return {
    el,
    getFiles: () => files.slice(),
    setFiles: (next) => { files = (next || []).slice(); render(); onChange?.(files); },
    clear: () => { files = []; render(); input.value = ''; onChange?.(files); },
  };
}

/* ───────────────────────── Misc ───────────────────────── */

/** Modal preview of a single image. Click to dismiss. */
export function previewImage(src) {
  const host = document.getElementById('modal-host');
  host.innerHTML = `
    <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6 cursor-zoom-out">
      <img src="${src}" class="max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  `;
  host.firstElementChild.onclick = () => host.innerHTML = '';
}

/** Render a grid of result images with download/preview buttons. */
export function resultGallery(images = [], { namePrefix = 'gen' } = {}) {
  const el = document.createElement('div');
  if (!images.length) {
    el.innerHTML = '<div class="text-slate-400 text-sm">（暂无结果）</div>';
    return el;
  }
  el.className = 'grid grid-cols-2 sm:grid-cols-3 gap-3';
  images.forEach((src, i) => {
    const card = document.createElement('div');
    card.className = 'img-card bg-white rounded-lg border border-slate-200 p-2';
    card.innerHTML = `
      <img src="${src}" class="w-full rounded-md cursor-zoom-in" data-action="preview" />
      <div class="flex justify-between items-center mt-2 text-xs">
        <span class="text-slate-400">#${i + 1}</span>
        <button data-action="download" class="btn-ghost">下载</button>
      </div>
    `;
    card.querySelector('[data-action=preview]').onclick = () => previewImage(src);
    card.querySelector('[data-action=download]').onclick = async () => {
      download(`${namePrefix}-${i + 1}.png`, src);
    };
    el.appendChild(card);
  });
  return el;
}

/** Copy button bound to a function returning text. */
export function copyButton(label, getText) {
  const b = document.createElement('button');
  b.className = 'btn-ghost';
  b.textContent = label;
  b.onclick = () => copyText(getText());
  return b;
}
