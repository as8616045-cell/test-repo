// pages/history.js — list past generations from IndexedDB

import { section, resultGallery, previewImage } from '../components.js';
import { listHistory, removeHistory, clearHistory } from '../storage.js';
import { toast, esc, copyText, download } from '../utils.js';

const KIND_LABEL = {
  reverse: '反推', consistent: '生图', 'change-product': '换产品',
  'change-bg': '换背景', video: '视频',
};

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">📚 历史记录</h1>
    <p class="text-slate-500 mb-5">所有生成记录都保存在浏览器 IndexedDB（本机），可随时回看 / 下载。</p>`;


  const filterRow = document.createElement('div');
  filterRow.className = 'flex items-center gap-2 mb-4';
  filterRow.innerHTML = `
    <select id="kind" class="form-input max-w-xs">
      <option value="">全部类型</option>
      <option value="reverse">反推</option>
      <option value="consistent">生图</option>
      <option value="change-product">换产品</option>
      <option value="change-bg">换背景</option>
    </select>
    <button id="refresh" class="btn-ghost">刷新</button>
    <button id="clear" class="btn-ghost text-red-600">清空全部</button>
  `;
  host.appendChild(filterRow);

  const list = document.createElement('div');
  list.className = 'space-y-4';
  host.appendChild(list);

  const refresh = async () => {
    const kind = filterRow.querySelector('#kind').value || null;
    list.innerHTML = '<div class="text-slate-400 text-sm">加载中…</div>';
    const records = await listHistory({ kind, limit: 200 });
    if (!records.length) {
      list.innerHTML = '<div class="text-slate-400 text-sm">暂无记录</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of records) list.appendChild(renderRecord(r, refresh));
  };

  filterRow.querySelector('#kind').onchange = refresh;
  filterRow.querySelector('#refresh').onclick = refresh;
  filterRow.querySelector('#clear').onclick = async () => {
    if (!confirm('确定清空所有历史记录？此操作不可恢复。')) return;
    await clearHistory();
    toast('已清空', 'success');
    refresh();
  };

  await refresh();
}

function renderRecord(r, onChange) {
  const card = document.createElement('div');
  card.className = 'card';
  const dt = new Date(r.createdAt).toLocaleString('zh-CN');
  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="text-xs text-slate-400">${esc(dt)} · ${esc(r.provider || '?')}</div>
        <div class="text-sm font-semibold mt-0.5">[${esc(KIND_LABEL[r.kind] || r.kind)}] ${esc((r.prompt || '').slice(0, 80))}${(r.prompt || '').length > 80 ? '…' : ''}</div>
      </div>
      <div class="flex gap-2">
        ${r.prompt ? '<button data-act="copy" class="btn-ghost">复制 prompt</button>' : ''}
        <button data-act="del" class="btn-ghost text-red-600">删除</button>
      </div>
    </div>
  `;
  card.querySelector('[data-act=del]').onclick = async () => {
    await removeHistory(r.id);
    onChange?.();
  };
  if (r.prompt) {
    card.querySelector('[data-act=copy]').onclick = () => copyText(r.prompt);
  }

  if (r.kind === 'reverse' && r.params?.text) {
    const t = document.createElement('div');
    t.className = 'mt-3 bg-slate-50 rounded p-3 text-sm whitespace-pre-wrap';
    t.textContent = r.params.text;
    card.appendChild(t);
  }
  if (r.outputs?.length) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3';
    r.outputs.forEach((o, i) => {
      const c = document.createElement('div');
      c.innerHTML = `
        <img src="${o.dataURL}" class="w-full h-24 object-cover rounded cursor-zoom-in" />
        <button class="btn-ghost text-xs w-full mt-1">下载</button>
      `;
      c.querySelector('img').onclick = () => previewImage(o.dataURL);
      c.querySelector('button').onclick = () => download(o.name || `out-${i + 1}.png`, o.dataURL);
      grid.appendChild(c);
    });
    card.appendChild(grid);
  }
  return card;
}
