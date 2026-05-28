// pages/consistent.js — 一致性生图：参考图 + prompt → 生图（保持人物/风格）

import { imageDropzone, section, providerSelect, resultGallery } from '../components.js';
import * as API from '../api/index.js';
import { addHistory } from '../storage.js';
import { toast, uid, esc, urlToDataURL, timestampedName } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">🎭 一致性生图</h1>
    <p class="text-slate-500 mb-5">上传参考图（人物/风格）+ prompt，模型尽量保持主体一致。</p>`;

  const drop = imageDropzone({ label: '参考图（可不传 = 纯文生图）', multiple: true });
  host.appendChild(section('参考图', drop.el, '即梦 4.0 / Nano Banana 都支持多图参考；fal.ai Flux Kontext 仅取首图。'));

  const controls = document.createElement('div');
  controls.innerHTML = `
    <label class="form-label">Prompt</label>
    <textarea class="form-textarea" rows="4" id="prompt" placeholder="例：同一位女孩，穿白色连衣裙，海边日落，电影感..."></textarea>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <div>
        <label class="form-label">服务商</label>
        <div id="prov-host"></div>
      </div>
      <div>
        <label class="form-label">尺寸</label>
        <select id="size" class="form-input">
          <option value="1024x1024">1024×1024 (1:1)</option>
          <option value="1024x1792">1024×1792 (9:16 竖)</option>
          <option value="1792x1024">1792×1024 (16:9 横)</option>
        </select>
      </div>
    </div>
  `;
  const provSel = providerSelect('image');
  controls.querySelector('#prov-host').appendChild(provSel);
  const goBtn = document.createElement('button');
  goBtn.className = 'btn-primary mt-3';
  goBtn.textContent = '生成图片';
  controls.appendChild(goBtn);
  host.appendChild(section('参数', controls));

  const resultBox = document.createElement('div');
  resultBox.innerHTML = '<div class="text-slate-400 text-sm">尚未生成</div>';
  host.appendChild(section('结果', resultBox));

  goBtn.onclick = async () => {
    const prompt = controls.querySelector('#prompt').value.trim();
    const size = controls.querySelector('#size').value;
    const imgs = drop.getValue();
    if (!prompt) return toast('请输入 prompt', 'warn');
    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 生成中...';
    resultBox.innerHTML = '<div class="text-slate-400 text-sm">生成中，可能 10-40 秒...</div>';
    try {
      const [w, h] = size.split('x');
      const opts = imgs.length
        ? { prompt, referenceImages: imgs, size, aspectRatio: aspect(w, h) }
        : { prompt, size, aspectRatio: aspect(w, h) };
      const { provider, images } = await API.generateImage(opts, provSel.value);
      // Convert remote URLs (volcengine returns http URL) to dataURL for safe storage.
      const dataURLs = await Promise.all(images.map(u => u.startsWith('data:') ? u : urlToDataURL(u)));
      resultBox.innerHTML = '';
      resultBox.appendChild(resultGallery(dataURLs, { namePrefix: 'consistent' }));
      const tag = document.createElement('div');
      tag.className = 'mt-3 text-xs text-slate-400';
      tag.textContent = `服务商：${provider} · 共 ${dataURLs.length} 张`;
      resultBox.appendChild(tag);
      await addHistory({
        id: uid(), kind: 'consistent', createdAt: Date.now(),
        prompt, model: '', provider,
        inputs: drop.getFiles(),
        outputs: dataURLs.map(d => ({ name: timestampedName('consistent'), dataURL: d, mime: 'image/png' })),
        params: { size }, note: '',
      });
      toast('已生成 ✅', 'success');
    } catch (e) {
      console.error(e);
      resultBox.innerHTML = `<div class="text-red-600 text-sm whitespace-pre-wrap">${esc(e.message)}</div>`;
      toast(e.message, 'error', 5000);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = '生成图片';
    }
  };
}

function aspect(w, h) {
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(+w, +h);
  return `${w / d}:${h / d}`;
}
