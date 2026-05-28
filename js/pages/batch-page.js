// pages/batch-page.js — 通用批量任务面板（CSV 喂数据 → 批量生图/反推/换背景）

import { section, providerSelect, resultGallery } from '../components.js';
import * as API from '../api/index.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import { toast, uid, esc, urlToDataURL, parseCSV, timestampedName } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">⚡ 批量任务</h1>
    <p class="text-slate-500 mb-5">用 CSV 一次性跑几十上百条 prompt（适合纯文生图批量）。</p>`;

  const ctl = document.createElement('div');
  ctl.innerHTML = `
    <p class="text-sm text-slate-600 mb-2">CSV 必须包含 <span class="kbd">prompt</span> 列；可选 <span class="kbd">size</span>。</p>
    <input type="file" id="csv" accept=".csv,text/csv" class="form-input" />
    <textarea id="manual" rows="5" class="form-textarea mt-3" placeholder="或在此每行一个 prompt 直接粘贴"></textarea>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <div><label class="form-label">服务商</label><div id="prov-host"></div></div>
      <div>
        <label class="form-label">默认尺寸</label>
        <select id="size" class="form-input">
          <option value="1024x1024">1024×1024</option>
          <option value="1024x1792">1024×1792</option>
          <option value="1792x1024">1792×1024</option>
        </select>
      </div>
    </div>
  `;
  const provSel = providerSelect('image');
  ctl.querySelector('#prov-host').appendChild(provSel);
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary mt-3';
  goBtn.textContent = '开始批量';
  ctl.appendChild(goBtn);
  host.appendChild(section('输入', ctl));

  const progress = document.createElement('div');
  progress.innerHTML = '<div class="text-slate-400 text-sm">尚未开始</div>';
  host.appendChild(section('进度', progress));

  const result = document.createElement('div');
  host.appendChild(section('成品', result));


  goBtn.onclick = async () => {
    let rows = [];
    const f = ctl.querySelector('#csv').files[0];
    const manual = ctl.querySelector('#manual').value.trim();
    if (f) {
      const text = await f.text();
      rows = parseCSV(text).filter(r => r.prompt);
    } else if (manual) {
      rows = manual.split('\n').map(l => l.trim()).filter(Boolean).map(p => ({ prompt: p }));
    }
    if (!rows.length) return toast('请提供 CSV 或在文本框输入 prompt', 'warn');
    const defaultSize = ctl.querySelector('#size').value;

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 进行中...';

    const renderProgress = (state) => {
      const ok = state.results.filter(r => r.status === 'done').length;
      const err = state.results.filter(r => r.status === 'error').length;
      progress.innerHTML = `
        <div class="text-sm">完成 <b>${ok}</b> / 失败 <b class="text-red-600">${err}</b> / 共 ${state.total}</div>
        <div class="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
          <div class="h-full bg-brand-500" style="width:${(ok / state.total) * 100}%"></div>
        </div>`;
    };

    const allOutputs = [];
    try {
      const results = await runBatch(rows, async (row) => {
        const size = row.size || defaultSize;
        const { provider, images } = await API.generateImage(
          { prompt: row.prompt, size, aspectRatio: aspectOf(size) },
          provSel.value
        );
        const dataURLs = await Promise.all(images.map(u => u.startsWith('data:') ? u : urlToDataURL(u)));
        return { provider, dataURLs };
      }, { onUpdate: renderProgress });

      result.innerHTML = '';
      results.forEach((r, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'mb-5';
        wrap.innerHTML = `<div class="text-sm font-medium text-slate-700 mb-2">#${i + 1} ${esc((rows[i].prompt || '').slice(0, 60))}${(rows[i].prompt || '').length > 60 ? '…' : ''} ${r.status === 'error' ? '<span class="text-red-600 text-xs">失败</span>' : ''}</div>`;
        if (r.status === 'done') {
          wrap.appendChild(resultGallery(r.result.dataURLs, { namePrefix: `batch-${i + 1}` }));
          allOutputs.push(...r.result.dataURLs.map(d => ({ name: timestampedName(`batch-${i + 1}`), dataURL: d, mime: 'image/png' })));
        } else if (r.status === 'error') {
          const e = document.createElement('div');
          e.className = 'text-red-600 text-xs';
          e.textContent = r.error;
          wrap.appendChild(e);
        }
        result.appendChild(wrap);
      });

      await addHistory({
        id: uid(), kind: 'consistent', createdAt: Date.now(),
        prompt: '[批量任务]', model: '', provider: provSel.value,
        inputs: [], outputs: allOutputs,
        params: { count: rows.length }, note: '批量',
      });
      toast('批量完成 ✅', 'success');
    } catch (e) {
      console.error(e);
      toast(e.message, 'error', 5000);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = '开始批量';
    }
  };
}

function aspectOf(size) {
  const [w, h] = size.split('x').map(Number);
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}
