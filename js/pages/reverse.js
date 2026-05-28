// pages/reverse.js — 反推提示词

import { imageDropzone, section, providerSelect, copyButton } from '../components.js';
import * as API from '../api/index.js';
import { addHistory } from '../storage.js';
import { toast, uid, esc } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">🔍 反推提示词</h1>
    <p class="text-slate-500 mb-5">上传一张参考图，让大模型输出可直接拿去生图的 prompt。</p>`;

  const drop = imageDropzone({ label: '参考图', multiple: true });
  host.appendChild(section('图片输入', drop.el, '可上传多张图，模型会综合分析。'));

  // controls
  const controls = document.createElement('div');
  const provSel = providerSelect('vision');
  controls.innerHTML = `
    <label class="form-label">服务商</label>
  `;
  controls.appendChild(provSel);
  const instr = document.createElement('textarea');
  instr.className = 'form-textarea mt-3';
  instr.rows = 4;
  instr.placeholder = '可选：自定义指令（留空则用默认指令输出英文 prompt）';
  controls.appendChild(instr);
  const btnRow = document.createElement('div');
  btnRow.className = 'flex gap-2 mt-3';
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary';
  goBtn.textContent = '反推 prompt';
  btnRow.appendChild(goBtn);
  controls.appendChild(btnRow);
  host.appendChild(section('参数', controls));

  // result
  const result = document.createElement('div');
  result.className = 'space-y-3';
  result.innerHTML = '<div class="text-slate-400 text-sm">尚未生成</div>';
  host.appendChild(section('结果', result));

  goBtn.onclick = async () => {
    const imgs = drop.getValue();
    if (!imgs.length) return toast('请先上传至少一张图', 'warn');
    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 分析中...';
    result.innerHTML = '<div class="text-slate-400 text-sm">生成中…</div>';
    try {
      const { provider, text } = await API.reverseImage(imgs, instr.value || null, provSel.value);
      result.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'bg-slate-50 rounded-lg p-4 text-sm whitespace-pre-wrap text-slate-800';
      card.textContent = text;
      result.appendChild(card);
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      actions.appendChild(copyButton('复制 prompt', () => text));
      const tag = document.createElement('span');
      tag.className = 'text-xs text-slate-400';
      tag.textContent = `服务商：${provider}`;
      actions.appendChild(tag);
      result.appendChild(actions);
      // save history
      await addHistory({
        id: uid(), kind: 'reverse', createdAt: Date.now(),
        prompt: instr.value || '', model: '', provider,
        inputs: drop.getFiles(), outputs: [],
        params: { text }, note: '反推',
      });
      toast('已生成 ✅', 'success');
    } catch (e) {
      console.error(e);
      result.innerHTML = `<div class="text-red-600 text-sm">${esc(e.message)}</div>`;
      toast(e.message, 'error', 5000);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = '反推 prompt';
    }
  };
}
