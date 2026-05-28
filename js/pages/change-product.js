// pages/change-product.js — 固定模特换产品
// 输入：1 张模特图 + N 张产品图 → 每张产品图生成一张"模特拿/穿/用该产品"的图。
// 内部用图像编辑接口，把【模特图 + 产品图】一起喂给模型，prompt 指明保留模特身份。

import { imageDropzone, section, providerSelect, resultGallery } from '../components.js';
import * as API from '../api/index.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import { toast, uid, esc, urlToDataURL, timestampedName } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">👗 固定模特换产品</h1>
    <p class="text-slate-500 mb-5">上传 1 张模特图 + N 张产品图，自动批量生成"该模特展示这些产品"的图片。</p>`;

  const modelDrop = imageDropzone({ label: '模特图（1 张）', multiple: false });
  host.appendChild(section('① 模特图', modelDrop.el, '建议清晰大图、五官明确，模型会尽量保留人脸/体型/风格。'));

  const productsDrop = imageDropzone({ label: '产品图（多张）', multiple: true });
  host.appendChild(section('② 产品图', productsDrop.el, '每张产品图会单独生成一张成品。'));

  const controls = document.createElement('div');
  controls.innerHTML = `
    <label class="form-label">指令模板（{model}=模特, {product}=产品）</label>
    <textarea class="form-textarea" rows="3" id="tpl">保留这位模特的脸部特征、发型与气质，让她以同样的姿态自然展示这件产品。背景保持简洁、专业摄影棚光线、电商级画质。</textarea>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <div>
        <label class="form-label">服务商（建议：火山方舟即梦4.0 或 Nano Banana）</label>
        <div id="prov-host"></div>
      </div>
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
  controls.querySelector('#prov-host').appendChild(provSel);
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary mt-3';
  goBtn.textContent = '开始批量生成';
  controls.appendChild(goBtn);
  host.appendChild(section('③ 参数', controls));

  const progressBox = document.createElement('div');
  progressBox.innerHTML = '<div class="text-slate-400 text-sm">尚未开始</div>';
  host.appendChild(section('进度', progressBox));

  const resultBox = document.createElement('div');
  host.appendChild(section('成品', resultBox));

  goBtn.onclick = async () => {
    const model = modelDrop.getValue();
    const products = productsDrop.getValue();
    if (model.length !== 1) return toast('请上传 1 张模特图', 'warn');
    if (!products.length) return toast('请上传至少 1 张产品图', 'warn');
    const tpl = controls.querySelector('#tpl').value.trim() || '让模特展示这件产品';
    const size = controls.querySelector('#size').value;

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 进行中...';

    const tasks = products.map((p, i) => ({ idx: i, productDataURL: p }));
    const renderProgress = (state) => {
      const ok = state.results.filter(r => r.status === 'done').length;
      const err = state.results.filter(r => r.status === 'error').length;
      const run = state.results.filter(r => r.status === 'running').length;
      progressBox.innerHTML = `
        <div class="text-sm">完成 <b>${ok}</b> / 失败 <b class="text-red-600">${err}</b> / 进行中 <b>${run}</b> / 共 ${state.total}</div>
        <div class="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all" style="width:${(ok / state.total) * 100}%"></div>
        </div>`;
    };

    const allOutputs = [];
    try {
      const results = await runBatch(tasks, async (t) => {
        const { provider, images } = await API.editImage({
          prompt: tpl,
          images: [model[0], t.productDataURL],
          size,
          aspectRatio: aspect(size),
        }, provSel.value);
        const dataURLs = await Promise.all(images.map(u => u.startsWith('data:') ? u : urlToDataURL(u)));
        return { provider, dataURLs };
      }, { onUpdate: renderProgress });

      resultBox.innerHTML = '';
      results.forEach((r, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'mb-5';
        wrap.innerHTML = `<div class="text-sm font-medium text-slate-700 mb-2">产品 #${i + 1} ${r.status === 'error' ? '<span class="text-red-600 text-xs">失败</span>' : ''}</div>`;
        if (r.status === 'done') {
          wrap.appendChild(resultGallery(r.result.dataURLs, { namePrefix: `product-${i + 1}` }));
          allOutputs.push(...r.result.dataURLs.map(d => ({ name: timestampedName(`product-${i + 1}`), dataURL: d, mime: 'image/png' })));
        } else if (r.status === 'error') {
          const e = document.createElement('div');
          e.className = 'text-red-600 text-xs';
          e.textContent = r.error;
          wrap.appendChild(e);
        }
        resultBox.appendChild(wrap);
      });

      await addHistory({
        id: uid(), kind: 'change-product', createdAt: Date.now(),
        prompt: tpl, model: '', provider: provSel.value,
        inputs: [...modelDrop.getFiles(), ...productsDrop.getFiles()],
        outputs: allOutputs,
        params: { size, count: products.length }, note: '',
      });
      toast('批量完成 ✅', 'success');
    } catch (e) {
      console.error(e);
      toast(e.message, 'error', 5000);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = '开始批量生成';
    }
  };
}

function aspect(size) {
  const [w, h] = size.split('x').map(Number);
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}
