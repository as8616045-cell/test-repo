// js/components.js — small reusable UI helpers (no framework)

import { fileToDataURL, esc, download, toast, copyText } from './utils.js';

/**
 * Image dropzone: returns { el, getValue(), setValue(), clear() }
 * - multiple: allow multiple images
 */
export function imageDropzone({ label = '上传图片', multiple = false, accept = 'image/*' } = {}) {
  const id = 'dz-' + Math.random().toString(36).slice(2, 8);
  const el = document.createElement('div');
  el.innerHTML = `
    <label class="form-label">${esc(label)}</label>
    <label for="${id}" class="dropzone block">
      <div class="text-slate-500 text-sm" data-role="hint">点击或拖拽图片到此处${multiple ? '（可多张）' : ''}</div>
      <input id="${id}" type="file" accept="${accept}" ${multiple ? 'multiple' : ''} class="hidden" />
    </label>
    <div data-role="thumbs" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3"></div>
  `;
  const input = el.querySelector('input');
  const dz = el.querySelector('label.dropzone');
  const thumbs = el.querySelector('[data-role=thumbs]');
  const hint = el.querySelector('[data-role=hint]');

  /** @type {{name: string, dataURL: string}[]} */
  let files = [];

  const renderThumbs = () => {
    thumbs.innerHTML = '';
    files.forEach((f, i) => {
      const c = document.createElement('div');
      c.className = 'relative group';
      c.innerHTML = `
        <img src="${f.dataURL}" class="w-full h-24 object-cover rounded-lg border border-slate-200" />
        <button data-i="${i}" class="absolute top-1 right-1 bg-black/60 text-white text-xs rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100">删除</button>
      `;
      c.querySelector('button').onclick = (ev) => {
        ev.preventDefault();
        files.splice(i, 1);
        renderThumbs();
      };
      thumbs.appendChild(c);
    });
    hint.textContent = files.length
      ? (multiple ? `已选 ${files.length} 张，可继续添加` : '已选 1 张，再次选择会替换')
      : `点击或拖拽图片到此处${multiple ? '（可多张）' : ''}`;
  };

  async function addFiles(list) {
    const arr = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (!arr.length) return;
    const newOnes = await Promise.all(arr.map(async f => ({
      name: f.name,
      dataURL: await fileToDataURL(f),
    })));
    if (multiple) files.push(...newOnes);
    else files = [newOnes[0]];
    renderThumbs();
  }

  input.addEventListener('change', e => addFiles(e.target.files));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  return {
    el,
    getValue: () => files.map(f => f.dataURL),
    getFiles: () => files,
    clear: () => { files = []; renderThumbs(); input.value = ''; },
  };
}

/** Render a grid of result images, each with download / preview / send-to-X buttons */
export function resultGallery(images = [], { onSendTo, namePrefix = 'gen' } = {}) {
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
        <div class="space-x-1">
          <button data-action="download" class="btn-ghost">下载</button>
          ${onSendTo ? '<button data-action="send" class="btn-ghost">作为输入</button>' : ''}
        </div>
      </div>
    `;
    card.querySelector('[data-action=preview]').onclick = () => previewImage(src);
    card.querySelector('[data-action=download]').onclick = async () => {
      // For dataURL or URL, both work via <a download>
      download(`${namePrefix}-${i + 1}.png`, src);
    };
    if (onSendTo) {
      card.querySelector('[data-action=send]').onclick = () => onSendTo(src);
    }
    el.appendChild(card);
  });
  return el;
}

/** Modal preview */
export function previewImage(src) {
  const host = document.getElementById('modal-host');
  host.innerHTML = `
    <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6 cursor-zoom-out">
      <img src="${src}" class="max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  `;
  host.firstElementChild.onclick = () => host.innerHTML = '';
}

/** Copy button bound to a function returning text */
export function copyButton(label, getText) {
  const b = document.createElement('button');
  b.className = 'btn-ghost';
  b.textContent = label;
  b.onclick = () => copyText(getText());
  return b;
}

/** A "section" wrapper: title + content */
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

/** Provider select dropdown for a given capability */
import { PROVIDER_LIST } from './api/index.js';
import { loadSettings } from './settings.js';
export function providerSelect(capability) {
  const s = loadSettings();
  const cur = s.preferred[capability];
  const sel = document.createElement('select');
  sel.className = 'form-input max-w-md';
  PROVIDER_LIST.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    if (p.id === cur) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}
