// pages/settings-page.js — v4: 单一输入 + 自动识别 + 2 桶能力指派
//
// 顶部:【添加 API】粘贴 baseURL + apiKey,实时显示自动识别结果。点保存即加入列表。
// 中部:【已添加的 API】列表,每行有"测试 / 删除"按钮。
// 下部:【能力指派】只有 2 个桶 —— 🖼️ 图片 / 💬 LLM。

import {
  loadSettings, saveSettings, DEFAULT_SETTINGS,
  exportSettings, importSettings, clearKeys,
  PRESET_ENDPOINTS, BUCKETS, BUCKET_LABELS,
  addEndpoint, removeEndpoint,
  setCapability, detectProvider,
} from '../settings.js';
import { endpointsFor, pingEndpoint, protocolName } from '../api/index.js';
import { toast, esc, download, readJSONFile } from '../utils.js';

export async function render(host) {
  host.innerHTML = `
    <h1 class="text-2xl font-bold mb-1">⚙️ 设置 / API</h1>
    <p class="text-slate-500 mb-5">
      只填 baseURL + apiKey,系统按 URL 自动识别厂商和协议。<br/>
      所有数据只保存在本机 localStorage,不会上传到任何服务器。
    </p>
  `;

  let s = structuredClone(loadSettings());

  /* ───────────────────── ① 添加 API ───────────────────── */

  const addCard = document.createElement('div');
  addCard.className = 'card mb-5';
  addCard.innerHTML = `
    <h2 class="text-base font-semibold mb-1">添加 API</h2>
    <p class="text-sm text-slate-500 mb-3">
      粘贴 baseURL + apiKey 即可。无论是 OpenAI / 谷歌 / 火山方舟 / DeepSeek / 硅基流动 / fal.ai 还是任意 OneAPI / NewAPI 中转站,系统都会自动识别。
    </p>

    <label class="form-label">Base URL</label>
    <input class="form-input" data-role="baseURL" placeholder="https://api.openai.com  /  https://ark.cn-beijing.volces.com/api/v3  /  ..." />

    <div class="flex flex-wrap gap-1 mt-2" data-role="quick-fill">
      <span class="text-xs text-slate-400 mr-1 self-center">快速粘贴:</span>
    </div>

    <label class="form-label mt-3">API Key</label>
    <input type="password" class="form-input" data-role="apiKey" placeholder="粘贴此处" autocomplete="off" />

    <div class="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200" data-role="detect-box">
      <span class="text-sm text-slate-400">↳ 在上方填入 Base URL 后,这里会显示自动识别结果</span>
    </div>

    <div class="flex flex-wrap gap-2 items-center mt-3">
      <button class="btn-primary" data-act="save">+ 保存到列表</button>
      <button class="btn-ghost" data-act="test">💚 先测试再保存</button>
      <span class="text-xs" data-role="status"></span>
    </div>
  `;
  host.appendChild(addCard);

  const $base    = addCard.querySelector('[data-role=baseURL]');
  const $key     = addCard.querySelector('[data-role=apiKey]');
  const $detect  = addCard.querySelector('[data-role=detect-box]');
  const $status  = addCard.querySelector('[data-role=status]');
  const $quick   = addCard.querySelector('[data-role=quick-fill]');

  // 快速粘贴按钮 —— 帮用户填 baseURL
  for (const p of PRESET_ENDPOINTS) {
    const b = document.createElement('button');
    b.className = 'chip-ref';
    b.style.fontFamily = 'inherit';
    b.title = p.baseURL;
    b.textContent = `${p.icon} ${p.name}`;
    b.onclick = () => {
      $base.value = p.baseURL;
      refreshDetection();
      $key.focus();
    };
    $quick.appendChild(b);
  }

  function refreshDetection() {
    const url = $base.value.trim();
    if (!url) {
      $detect.innerHTML = '<span class="text-sm text-slate-400">↳ 在上方填入 Base URL 后,这里会显示自动识别结果</span>';
      return;
    }
    const det = detectProvider(url);
    const protoLabel = ({ openai: 'OpenAI 兼容', gemini: 'Google Gemini', fal: 'fal.ai 队列' })[det.protocol] || det.protocol;
    const confDot = det.confidence === 'high' ? '<span class="text-emerald-600">●</span>'
                  : det.confidence === 'low'  ? '<span class="text-amber-500">●</span>'
                  :                              '<span class="text-slate-300">●</span>';
    const confText = det.confidence === 'high' ? '高置信度匹配'
                   : det.confidence === 'low'  ? '低置信度 — 假定为 OpenAI 兼容（中转站）'
                   :                              '';
    $detect.innerHTML = `
      <div class="flex items-center gap-2 text-sm">
        ${confDot}
        <span class="text-2xl">${esc(det.icon)}</span>
        <div>
          <div class="font-medium text-slate-700">识别为 <b>${esc(det.name)}</b></div>
          <div class="text-xs text-slate-500">协议: ${esc(protoLabel)} · ${esc(confText)}</div>
        </div>
      </div>
    `;
  }
  $base.oninput = refreshDetection;
  refreshDetection();

  function buildEndpointFromForm() {
    const baseURL = $base.value.trim();
    const apiKey  = $key.value.trim();
    if (!baseURL) throw new Error('请填 Base URL');
    if (!apiKey)  throw new Error('请填 API Key');
    const det = detectProvider(baseURL);
    return {
      baseURL,
      apiKey,
      name: det.name,
      protocol: 'auto',  // 走自动识别
      _detected: det,
    };
  }

  addCard.querySelector('[data-act=save]').onclick = () => {
    let info; try { info = buildEndpointFromForm(); } catch (e) { return toast(e.message, 'warn'); }
    const ep = addEndpoint({ name: info.name, baseURL: info.baseURL, apiKey: info.apiKey, protocol: info.protocol });
    s = structuredClone(loadSettings());
    // 自动设置默认能力指派（如果对应桶还没指派,把它指到这个新端点 + 默认模型）
    const det = info._detected;
    if (!s.capabilities.llm.endpointId && det.defaultModels?.llm) {
      setCapability('llm', ep.id, det.defaultModels.llm);
    }
    if (!s.capabilities.image.endpointId && det.defaultModels?.image) {
      setCapability('image', ep.id, det.defaultModels.image);
    }
    s = structuredClone(loadSettings());
    // 重置表单
    $base.value = ''; $key.value = '';
    refreshDetection();
    $status.className = 'text-xs text-emerald-600';
    $status.textContent = `✓ 已添加 ${ep.name}`;
    setTimeout(() => $status.textContent = '', 3000);
    renderEndpointList();
    renderCapabilityRows();
    toast(`已添加 ${ep.name}`, 'success');
  };

  addCard.querySelector('[data-act=test]').onclick = async () => {
    let info; try { info = buildEndpointFromForm(); } catch (e) { return toast(e.message, 'warn'); }
    $status.className = 'text-xs text-slate-500';
    $status.textContent = '⏳ 测试中…';
    try {
      const msg = await pingEndpoint({ id: '_form', name: info.name, baseURL: info.baseURL, apiKey: info.apiKey, protocol: 'auto' });
      $status.className = 'text-xs text-emerald-600';
      $status.textContent = '✓ ' + msg;
    } catch (e) {
      $status.className = 'text-xs text-red-600';
      $status.textContent = '✗ ' + (e.message || String(e));
    }
  };

  /* ───────────────────── ② 已添加的 API ───────────────────── */

  const listCard = document.createElement('div');
  listCard.className = 'card mb-5';
  listCard.innerHTML = `
    <h2 class="text-base font-semibold mb-1">已添加的 API</h2>
    <p class="text-sm text-slate-500 mb-3">下方"能力指派"会从这里挑选具体哪一家干哪一件事。</p>
    <div data-role="ep-list" class="space-y-2"></div>
  `;
  host.appendChild(listCard);
  const epList = listCard.querySelector('[data-role=ep-list]');

  function renderEndpointList() {
    epList.innerHTML = '';
    if (!s.endpoints.length) {
      epList.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">还没添加任何 API。在上方"添加 API"开始。</p>';
      return;
    }
    for (const ep of s.endpoints) {
      epList.appendChild(buildEndpointRow(ep));
    }
  }

  function buildEndpointRow(ep) {
    const det = detectProvider(ep.baseURL);
    const block = document.createElement('div');
    block.className = 'sub-card flex flex-wrap items-center gap-3';
    block.dataset.epId = ep.id;
    block.innerHTML = `
      <div class="text-2xl flex-shrink-0">${esc(det.icon)}</div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-slate-700 truncate">${esc(ep.name || det.name)}</div>
        <div class="text-xs text-slate-500 truncate">${esc(ep.baseURL)}</div>
        <div class="text-xs text-slate-400">协议: ${esc(protocolName(ep))}</div>
      </div>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <span class="text-xs text-slate-500" data-role="ping"></span>
        <button class="btn-ghost text-xs" data-act="test">测试</button>
        <button class="btn-ghost text-xs text-red-600" data-act="remove">× 删除</button>
      </div>
    `;
    block.querySelector('[data-act=test]').onclick = async () => {
      const $p = block.querySelector('[data-role=ping]');
      $p.className = 'text-xs text-slate-500';
      $p.textContent = '⏳';
      try {
        const msg = await pingEndpoint(ep);
        $p.className = 'text-xs text-emerald-600';
        $p.textContent = '✓ ' + msg;
      } catch (e) {
        $p.className = 'text-xs text-red-600';
        $p.textContent = '✗ ' + (e.message || String(e));
      }
    };
    block.querySelector('[data-act=remove]').onclick = () => {
      if (!confirm(`删除 ${ep.name}？任何指向它的能力指派会回退到第一个可用端点。`)) return;
      removeEndpoint(ep.id);
      s = structuredClone(loadSettings());
      renderEndpointList();
      renderCapabilityRows();
      toast('已删除', 'success');
    };
    return block;
  }

  /* ───────────────────── ③ 能力指派（只有 2 个桶） ───────────────────── */

  const capCard = document.createElement('div');
  capCard.className = 'card mb-5';
  capCard.innerHTML = `
    <h2 class="text-base font-semibold mb-1">能力指派</h2>
    <p class="text-sm text-slate-500 mb-3">
      只分两类:<b>图片 API</b>（生图 / 编辑 / 视频）和 <b>LLM API</b>（提示词改写 + 反推图片,文字或多模态都行）。<br/>
      下拉只显示协议支持该类型的端点（比如 fal.ai 不会出现在 LLM 下拉里）。
    </p>
    <div class="space-y-3" data-role="cap-rows"></div>
  `;
  host.appendChild(capCard);
  const capRows = capCard.querySelector('[data-role=cap-rows]');

  function renderCapabilityRows() {
    capRows.innerHTML = '';
    s = structuredClone(loadSettings());
    for (const b of BUCKETS) {
      capRows.appendChild(buildCapabilityRow(b));
    }
  }

  function buildCapabilityRow(bucket) {
    const eps = endpointsFor(bucket);
    const cur = s.capabilities[bucket] || { endpointId: '', model: '' };
    const wrap = document.createElement('div');
    wrap.className = 'grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] gap-2 items-end';
    wrap.innerHTML = `
      <div>
        <label class="form-label">${esc(BUCKET_LABELS[bucket])}</label>
        <p class="text-xs text-slate-400">${bucket === 'llm' ? '反推 + 改写' : '生图 + 编辑 + 视频'}</p>
      </div>
      <div>
        <label class="form-label">端点</label>
        <select class="form-input" data-role="ep"></select>
      </div>
      <div>
        <label class="form-label">模型</label>
        <input class="form-input" data-role="model" value="${esc(cur.model || '')}" placeholder="${esc(modelPlaceholder(bucket))}" />
      </div>
    `;
    const $ep    = wrap.querySelector('[data-role=ep]');
    const $model = wrap.querySelector('[data-role=model]');

    if (!eps.length) {
      const o = document.createElement('option');
      o.textContent = '（无支持的端点 — 请先在上方添加 API）';
      o.disabled = true; o.selected = true;
      $ep.appendChild(o);
      $ep.disabled = true;
      $model.disabled = true;
    } else {
      let matched = false;
      for (const ep of eps) {
        const o = document.createElement('option');
        o.value = ep.id;
        o.textContent = `${ep.name} · ${protocolName(ep)}`;
        if (ep.id === cur.endpointId) { o.selected = true; matched = true; }
        $ep.appendChild(o);
      }
      if (!matched) $ep.value = eps[0].id;
    }

    function commit() {
      const epId = $ep.value;
      let model = $model.value.trim();
      // 端点切换且模型为空 → 用该端点厂商的默认模型回填
      if (!model) {
        const ep = s.endpoints.find(e => e.id === epId);
        const det = detectProvider(ep?.baseURL || '');
        model = det.defaultModels?.[bucket] || '';
        if (model) $model.value = model;
      }
      setCapability(bucket, epId, model);
      s = structuredClone(loadSettings());
    }
    $ep.onchange = () => {
      // 切端点时,模型清空让 commit() 自动回填默认
      $model.value = '';
      commit();
    };
    $model.onchange = commit;

    return wrap;
  }

  /* ───────────────────── ④ 通用 ───────────────────── */

  const genCard = document.createElement('div');
  genCard.className = 'card mb-5';
  genCard.innerHTML = `
    <h2 class="text-base font-semibold mb-2">通用</h2>
    <label class="form-label">并发数（批量任务同时跑几个）</label>
    <input id="conc" type="number" min="1" max="10" class="form-input max-w-xs" value="${s.concurrency}" />
    <label class="form-label mt-3">CORS 代理（可选,少数 API 浏览器调不通时用）</label>
    <input id="proxy" class="form-input" placeholder="例: https://your-worker.workers.dev" value="${esc(s.corsProxy || '')}" />
    <p class="text-xs text-slate-500 mt-1">推荐自部署一个 Cloudflare Worker。</p>
  `;
  genCard.querySelector('#conc').onchange  = e => { s.concurrency = +e.target.value || 3; saveSettings(s); };
  genCard.querySelector('#proxy').onchange = e => { s.corsProxy = e.target.value.trim();  saveSettings(s); };
  host.appendChild(genCard);

  /* ───────────────────── ⑤ 操作栏 ───────────────────── */

  const bar = document.createElement('div');
  bar.className = 'card flex flex-wrap gap-2';
  bar.innerHTML = `
    <button id="export" class="btn-ghost">导出 JSON</button>
    <button id="import" class="btn-ghost">导入 JSON</button>
    <input  id="file"   type="file" accept=".json,application/json" class="hidden" />
    <button id="clear"  class="btn-ghost text-red-600">清除全部 Key</button>
    <button id="reset"  class="btn-ghost text-red-600">重置（清空所有数据）</button>
  `;
  host.appendChild(bar);

  bar.querySelector('#export').onclick = () => {
    download('ai-studio-settings.json',
      'data:application/json;charset=utf-8,' + encodeURIComponent(exportSettings()));
  };
  bar.querySelector('#import').onclick = () => bar.querySelector('#file').click();
  bar.querySelector('#file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = await readJSONFile(f);
      importSettings(obj);
      toast('导入成功,刷新页面以生效', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast('导入失败: ' + err.message, 'error'); }
  };
  bar.querySelector('#clear').onclick = () => {
    if (!confirm('清除全部 API Key？端点和能力指派会保留。')) return;
    clearKeys();
    s = structuredClone(loadSettings());
    renderEndpointList();
    toast('已清除', 'success');
  };
  bar.querySelector('#reset').onclick = () => {
    if (!confirm('重置所有设置？所有 API、Key 和能力指派都会被清空。')) return;
    saveSettings(structuredClone(DEFAULT_SETTINGS));
    toast('已重置', 'success');
    setTimeout(() => location.reload(), 600);
  };

  // initial paint
  renderEndpointList();
  renderCapabilityRows();
}

function modelPlaceholder(bucket) {
  return ({
    llm:   '如 doubao-seed-1-6-vision-250815 / gpt-4o / gemini-2.5-flash / deepseek-chat',
    image: '如 doubao-seedream-4-0-250828 / gpt-image-1 / Kwai-Kolors/Kolors / fal-ai/flux-pro/kontext',
  })[bucket] || '';
}
