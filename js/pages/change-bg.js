// pages/change-bg.js — 固定模特+产品 换背景
// 输入：1 张"模特+产品"已合好的图 + N 个背景描述（或背景参考图）→ 批量出图

import { imageDropzone, section, providerSelect, resultGallery } from '../components.js';
import * as API from '../api/index.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import { toast, uid, esc, urlToDataURL, timestampedName } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">🌆 固定模特+产品换背景</h1>
    <p class="text-slate-500 mb-5">上传 1 张已合成的"模特+产品"图，再批量提供背景描述，自动换背景。</p>`;

  const subjectDrop = imageDropzone({ label: '主体图（模特+产品已合好）', multiple: false });
  host.appendChild(section('① 主体图', subjectDrop.el, '模型会尽量保留主体不变，只改背景。'));

  const bgDrop = imageDropzone({ label: '背景参考图（可选，多张）', multiple: true });
  host.appendChild(section('② 背景参考图（可选）', bgDrop.el, '若提供，每张背景图都会和主体合成一张成品；可与下方背景描述列表叠加。'));

  const ctl = document.createElement('div');
  ctl.innerHTML = `
    <label class="form-label">背景描述（每行一个，将分别批量生成）</label>
    <textarea class="form-textarea" rows="6" id="lines" placeholder="海边日落沙滩
极简白色摄影棚
东京街头夜景，霓虹灯
森林晨雾"></textarea>
    <label class="form-label mt-3">编辑指令模板（{bg} 会被替换为单条背景描述）</label>
    <textarea class="form-textarea" rows="3" id="tpl">完全保留主体（模特和产品）的外观、姿态、比例与光影协调，仅将背景换成：{bg}。整体光线与主体融合自然，电商级摄影质感。</textarea>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <div><label class="form-label">服务商</label><div id="prov-host"></div></div>
      <div>
        <label class="form-label">尺寸</label>
        <select id="size" class="form-input">
          <option value="1024x1024">1024×1024</option>
          <option value="1024x1792">1024×1792 竖</option>
          <option value="1792x1024">1792×1024 横</option>
        </select>
      </div>
    </div>
  `;
  const provSel = providerSelect('edit');
  ctl.querySelector('#prov-host').appendChild(provSel);
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary mt-3';
  goBtn.textContent = '开始批量换背景';
  ctl.appendChild(goBtn);
  host.appendChild(section('③ 参数', ctl));

  const progressBox = document.createElement('div');
  progressBox.innerHTML = '<div class="text-slate-400 text-sm">尚未开始</div>';
  host.appendChild(section('进度', progressBox));

  const resultBox = document.createElement('div');
  host.appendChild(section('成品', resultBox));

  goBtn.onclick = async () => {
    const subj = subjectDrop.getValue();
    if (subj.length !== 1) return toast('请上传 1 张主体图', 'warn');
    const lines = ctl.querySelector('#lines').value.split('\n').map(s => s.trim()).filter(Boolean);
    const bgImgs = bgDrop.getValue();
    if (!lines.length && !bgImgs.length) return toast('请提供至少 1 个背景描述或背景图', 'warn');
    const tpl = ctl.querySelector('#tpl').value.trim() || '更换背景';
    const size = ctl.querySelector('#size').value;

    /** Build task list: 文字描述 + 背景图 各成任务 */
    const tasks = [
      ...lines.map(bg => ({ kind: 'text', bg })),
      ...bgImgs.map(img => ({ kind: 'image', bgImg: img })),
    ];

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 进行中...';

    const renderProgress = (state) => {
      const ok = state.results.filter(r => r.status === 'done').length;
      const err = state.results.filter(r => r.status === 'error').length;
      progressBox.innerHTML = `
        <div class="text-sm">完成 <b>${ok}</b> / 失败 <b class="text-red-600">${err}</b> / 共 ${state.total}</div>
        <div class="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
          <div class="h-full bg-brand-500" style="width:${(ok / state.total) * 100}%"></div>
        </div>`;
    };

    const allOutputs = [];
    try {
      const results = await runBatch(tasks, async (t) => {
        let prompt, images;
        if (t.kind === 'text') {
          prompt = tpl.replace('{bg}', t.bg);
          images = [subj[0]];
        } else {
          prompt = '完全保留第一张图的主体（模特和产品），将背景替换为第二张图所示的场景。光线协调、电商级摄影质感。';
          images = [subj[0], t.bgImg];
        }
        const { provider, images: outs } = await API.editImage({
          prompt, images, size, aspectRatio: aspect(size),
        }, provSel.value);
        const dataURLs = await Promise.all(outs.map(u => u.startsWith('data:') ? u : urlToDataURL(u)));
        return { provider, dataURLs, label: t.kind === 'text' ? t.bg : '[背景图]' };
      }, { onUpdate: renderProgress });

      resultBox.innerHTML = '';
      results.forEach((r, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'mb-5';
        const label = r.result?.label || tasks[i]?.bg || `任务 ${i + 1}`;
        wrap.innerHTML = `<div class="text-sm font-medium text-slate-700 mb-2">${esc(label)} ${r.status === 'error' ? '<span class="text-red-600 text-xs">失败</span>' : ''}</div>`;
        if (r.status === 'done') {
          wrap.appendChild(resultGallery(r.result.dataURLs, { namePrefix: `bg-${i + 1}` }));
          allOutputs.push(...r.result.dataURLs.map(d => ({ name: timestampedName(`bg-${i + 1}`), dataURL: d, mime: 'image/png' })));
        } else if (r.status === 'error') {
          const e = document.createElement('div');
          e.className = 'text-red-600 text-xs';
          e.textContent = r.error;
          wrap.appendChild(e);
        }
        resultBox.appendChild(wrap);
      });

      await addHistory({
        id: uid(), kind: 'change-bg', createdAt: Date.now(),
        prompt: tpl, model: '', provider: provSel.value,
        inputs: [...subjectDrop.getFiles(), ...bgDrop.getFiles()],
        outputs: allOutputs,
        params: { size, count: tasks.length }, note: '',
      });
      toast('批量完成 ✅', 'success');
    } catch (e) {
      console.error(e);
      toast(e.message, 'error', 5000);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = '开始批量换背景';
    }
  };
}

function aspect(size) {
  const [w, h] = size.split('x').map(Number);
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}
