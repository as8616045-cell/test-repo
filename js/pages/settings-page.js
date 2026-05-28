// pages/settings-page.js — manage API keys / preferences / import-export

import { loadSettings, saveSettings, DEFAULT_SETTINGS, exportSettings, importSettings, clearKeys } from '../settings.js';
import { PROVIDER_LIST } from '../api/index.js';
import { toast, esc, download, readJSONFile } from '../utils.js';

export async function render(host) {
  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">⚙️ 设置 / API Key</h1>
    <p class="text-slate-500 mb-5">所有配置只保存在您本机 localStorage，不会上传任何服务器。</p>`;

  const s = structuredClone(loadSettings());
  const card = document.createElement('div');
  card.className = 'card space-y-6';

  // Build provider blocks first (just create, don't append yet) — order them at the top.
  const providerBlocks = [];

  // ── Volcengine
  providerBlocks.push(providerBlock({
    title: '🔥 火山方舟 (Volcengine)',
    desc: '即梦 4.0 / 豆包视觉 / Seedance —— 国内可直连，推荐为默认。',
    helpUrl: 'https://www.volcengine.com/product/ark',
    keyValue: s.volcengine.apiKey,
    onKey: v => s.volcengine.apiKey = v,
    fields: [
      { label: '视觉模型', key: 'visionModel', val: s.volcengine.visionModel, hint: '反推用，默认 doubao-seed-1-6-vision-250815' },
      { label: '生图模型', key: 'imageModel', val: s.volcengine.imageModel, hint: '即梦 4.0：doubao-seedream-4-0-250828' },
      { label: '生视频模型', key: 'videoModel', val: s.volcengine.videoModel, hint: 'Seedance Pro：doubao-seedance-1-0-pro-250528' },
    ],
    onField: (k, v) => s.volcengine[k] = v,
  }));

  // ── Gemini
  providerBlocks.push(providerBlock({
    title: '✨ Google Gemini',
    desc: '视觉理解 + Nano Banana 生图（角色一致性强）。需海外网络。',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    keyValue: s.gemini.apiKey,
    onKey: v => s.gemini.apiKey = v,
    fields: [
      { label: '视觉模型', key: 'visionModel', val: s.gemini.visionModel, hint: 'gemini-2.5-flash 或 gemini-2.5-pro' },
      { label: '生图模型', key: 'imageModel', val: s.gemini.imageModel, hint: 'gemini-2.5-flash-image (Nano Banana)' },
    ],
    onField: (k, v) => s.gemini[k] = v,
  }));

  // ── fal.ai
  providerBlocks.push(providerBlock({
    title: '🚀 fal.ai',
    desc: 'Flux Kontext / Kling 等海量模型聚合。需海外网络。',
    helpUrl: 'https://fal.ai/dashboard/keys',
    keyValue: s.fal.apiKey,
    onKey: v => s.fal.apiKey = v,
    fields: [
      { label: 'Flux Kontext 模型路径', key: 'fluxKontextModel', val: s.fal.fluxKontextModel, hint: 'fal-ai/flux-pro/kontext' },
      { label: 'Kling i2v 模型路径', key: 'klingModel', val: s.fal.klingModel, hint: 'fal-ai/kling-video/v2/master/image-to-video' },
    ],
    onField: (k, v) => s.fal[k] = v,
  }));

  // ── OpenAI / 中转站
  providerBlocks.push(providerBlock({
    title: '🤖 OpenAI / 中转站',
    desc: '官方 OpenAI（gpt-image-1 / gpt-image-2 / dall-e-3）或任意 OpenAI 兼容中转站（OneAPI / NewAPI / 私有代理）。改 baseURL 即可切换。',
    helpUrl: 'https://platform.openai.com/api-keys',
    keyValue: s.openai.apiKey,
    onKey: v => s.openai.apiKey = v,
    fields: [
      { label: 'Base URL', key: 'baseURL', val: s.openai.baseURL, hint: '官方：https://api.openai.com；中转站填中转站域名（不含 /v1）' },
      { label: '视觉/聊天模型', key: 'visionModel', val: s.openai.visionModel, hint: '反推 + LLM 改写用，如 gpt-4o / gpt-4o-mini' },
      { label: '生图模型', key: 'imageModel', val: s.openai.imageModel, hint: 'gpt-image-1 / gpt-image-2 / dall-e-3 等中转站支持的型号' },
    ],
    onField: (k, v) => s.openai[k] = v,
  }));

  // ── DeepSeek（国内文本 LLM，仅用于 prompt 改写）
  providerBlocks.push(providerBlock({
    title: '🐋 DeepSeek（国内）',
    desc: '国产文本 LLM，OpenAI 兼容协议。仅用于 prompt 改写润色（不生图）。',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    keyValue: s.deepseek.apiKey,
    onKey: v => s.deepseek.apiKey = v,
    fields: [
      { label: 'Base URL', key: 'baseURL', val: s.deepseek.baseURL, hint: '官方：https://api.deepseek.com' },
      { label: '聊天模型', key: 'chatModel', val: s.deepseek.chatModel, hint: 'deepseek-chat 或 deepseek-reasoner' },
    ],
    onField: (k, v) => s.deepseek[k] = v,
  }));

  // ── 硅基流动 SiliconFlow（国内聚合，chat + vision + image 全能）
  providerBlocks.push(providerBlock({
    title: '🌊 硅基流动 SiliconFlow（国内聚合）',
    desc: 'OpenAI 兼容协议，一个 Key 调用 DeepSeek / Qwen-VL / Kolors / Flux / SD3.5 等众多模型。支持改写、视觉理解、文生图。',
    helpUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyValue: s.siliconflow.apiKey,
    onKey: v => s.siliconflow.apiKey = v,
    fields: [
      { label: 'Base URL', key: 'baseURL', val: s.siliconflow.baseURL, hint: '官方：https://api.siliconflow.cn（不含 /v1）' },
      { label: '聊天模型', key: 'chatModel', val: s.siliconflow.chatModel, hint: '如 deepseek-ai/DeepSeek-V3、Qwen/Qwen2.5-72B-Instruct' },
      { label: '视觉模型', key: 'visionModel', val: s.siliconflow.visionModel, hint: '如 Qwen/Qwen2.5-VL-72B-Instruct' },
      { label: '生图模型', key: 'imageModel', val: s.siliconflow.imageModel, hint: '如 Kwai-Kolors/Kolors、stabilityai/stable-diffusion-3-5-large、black-forest-labs/FLUX.1-schnell' },
    ],
    onField: (k, v) => s.siliconflow[k] = v,
  }));

  // Append all provider blocks first (top of card)
  providerBlocks.forEach(b => card.appendChild(b));


  // ── Preferred providers
  const prefs = document.createElement('div');
  prefs.innerHTML = '<h2 class="text-base font-semibold mb-2">默认服务商</h2>';
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 gap-3';
  for (const cap of ['vision', 'chat', 'image', 'edit', 'video']) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="form-label">${capLabel(cap)}</label>`;
    const sel = document.createElement('select');
    sel.className = 'form-input';
    for (const p of PROVIDER_LIST) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      if (p.id === s.preferred[cap]) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => s.preferred[cap] = sel.value;
    wrap.appendChild(sel);
    grid.appendChild(wrap);
  }
  prefs.appendChild(grid);
  card.appendChild(prefs);

  // ── General
  const gen = document.createElement('div');
  gen.innerHTML = `
    <h2 class="text-base font-semibold mb-2">通用</h2>
    <label class="form-label">并发数（批量任务同时跑几个）</label>
    <input id="conc" type="number" min="1" max="10" class="form-input max-w-xs" value="${s.concurrency}" />
    <label class="form-label mt-3">CORS 代理（可选，少数 API 浏览器调不通时用）</label>
    <input id="proxy" class="form-input" placeholder="例：https://your-worker.workers.dev" value="${esc(s.corsProxy || '')}" />
    <p class="text-xs text-slate-500 mt-1">推荐自部署一个 Cloudflare Worker，参考 README。</p>
  `;
  gen.querySelector('#conc').onchange = e => s.concurrency = +e.target.value || 3;
  gen.querySelector('#proxy').onchange = e => s.corsProxy = e.target.value.trim();
  card.appendChild(gen);

  // ── Action bar
  const bar = document.createElement('div');
  bar.className = 'flex flex-wrap gap-2 pt-4 border-t border-slate-200';
  bar.innerHTML = `
    <button id="save"   class="btn-primary">保存</button>
    <button id="export" class="btn-ghost">导出 JSON</button>
    <button id="import" class="btn-ghost">导入 JSON</button>
    <input  id="file"   type="file" accept=".json,application/json" class="hidden" />
    <button id="clear"  class="btn-ghost text-red-600">清除全部 Key</button>
    <button id="reset"  class="btn-ghost text-red-600">重置为默认</button>
  `;
  card.appendChild(bar);
  host.appendChild(card);


  // wire actions
  bar.querySelector('#save').onclick = () => { saveSettings(s); toast('已保存 ✅', 'success'); };
  bar.querySelector('#export').onclick = () => {
    download('ai-studio-settings.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(exportSettings()));
  };
  bar.querySelector('#import').onclick = () => bar.querySelector('#file').click();
  bar.querySelector('#file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = await readJSONFile(f);
      importSettings(obj);
      toast('导入成功，刷新页面以生效', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  bar.querySelector('#clear').onclick = () => {
    if (!confirm('清除全部 API Key？')) return;
    clearKeys(); toast('已清除', 'success'); setTimeout(() => location.reload(), 600);
  };
  bar.querySelector('#reset').onclick = () => {
    if (!confirm('重置所有设置为默认？API Key 也会清空。')) return;
    saveSettings(structuredClone(DEFAULT_SETTINGS));
    toast('已重置', 'success'); setTimeout(() => location.reload(), 600);
  };
}

function capLabel(c) {
  return ({
    vision: '反推提示词（视觉理解）',
    chat:   'Prompt 改写润色（纯文本）',
    image:  '生图（文/图生图、一致性）',
    edit:   '编辑（换产品 / 换背景）',
    video:  '生视频',
  })[c] || c;
}

function providerBlock({ title, desc, helpUrl, keyValue, onKey, fields, onField }) {
  const block = document.createElement('div');
  block.className = 'pt-4 border-t border-slate-200';
  block.innerHTML = `
    <h2 class="text-base font-semibold">${esc(title)}</h2>
    <p class="text-sm text-slate-500 mb-3">${esc(desc)} <a class="text-brand-600 hover:underline" target="_blank" href="${esc(helpUrl)}">获取 Key ↗</a></p>
    <label class="form-label">API Key</label>
    <input type="password" class="form-input" data-role="key" value="${esc(keyValue || '')}" placeholder="粘贴此处" />
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3" data-role="fields"></div>
  `;
  block.querySelector('[data-role=key]').onchange = e => onKey(e.target.value.trim());
  const fwrap = block.querySelector('[data-role=fields]');
  for (const f of fields) {
    const w = document.createElement('div');
    w.innerHTML = `
      <label class="form-label">${esc(f.label)}</label>
      <input class="form-input" value="${esc(f.val || '')}" />
      <p class="text-xs text-slate-400 mt-1">${esc(f.hint || '')}</p>
    `;
    w.querySelector('input').onchange = e => onField(f.key, e.target.value.trim());
    fwrap.appendChild(w);
  }
  return block;
}
