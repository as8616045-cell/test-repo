// pages/settings-page.js — v4: 端点列表 + 能力指派 + 测试连通性

import {
  loadSettings, saveSettings, DEFAULT_SETTINGS,
  exportSettings, importSettings, clearKeys,
  PRESET_ENDPOINTS, CAPABILITY_LIST,
  addEndpoint, removeEndpoint, updateEndpoint, addPresetEndpoint,
  setCapability,
} from '../settings.js';
import { detectProtocol, endpointsFor, pingEndpoint, protocolName } from '../api/index.js';
import { toast, esc, download, readJSONFile } from '../utils.js';

export async function render(host) {
  host.innerHTML = `
    <h1 class="text-2xl font-bold mb-1">⚙️ 设置 / API 端点</h1>
    <p class="text-slate-500 mb-5">
      只填 baseURL + apiKey，系统按 baseURL 自动识别协议；每个能力（视觉 / 文本 / 生图 / 编辑 / 视频）独立指派端点 + 模型。
      所有数据只保存在本机 localStorage，不会上传任何服务器。
    </p>
  `;

  let s = structuredClone(loadSettings());

  /* ───────────────────── 端点列表 ───────────────────── */

  const epCard = document.createElement('div');
  epCard.className = 'card mb-5';
  epCard.innerHTML = `
    <h2 class="text-base font-semibold mb-1">API 端点</h2>
    <p class="text-sm text-slate-500 mb-3">
      列表里的每个端点 = 一个 baseURL + 一个 apiKey。系统会按 URL 自动识别协议；
      也可以手动覆盖。下方"能力指派"在这些端点中挑选具体哪一家干哪一件事。
    </p>
    <div data-role="ep-list" class="space-y-3"></div>
    <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-200" data-role="ep-actions"></div>
  `;
  host.appendChild(epCard);

  const epList = epCard.querySelector('[data-role=ep-list]');
  const epActions = epCard.querySelector('[data-role=ep-actions]');

  function renderEndpointList() {
    epList.innerHTML = '';
    if (!s.endpoints.length) {
      epList.innerHTML = '<p class="text-sm text-slate-400">（无端点。点击下方"+ 从预设添加"或"添加自定义端点"开始）</p>';
    }
    s.endpoints.forEach(ep => epList.appendChild(buildEndpointRow(ep)));
  }

  function buildEndpointRow(ep) {
    const block = document.createElement('div');
    block.className = 'sub-card';
    block.dataset.epId = ep.id;
    block.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <input class="form-input flex-1" data-role="name" value="${esc(ep.name)}" placeholder="端点名称" />
            <button class="btn-ghost text-red-600 text-sm" data-act="remove">× 删除</button>
          </div>

          <label class="form-label">Base URL</label>
          <input class="form-input" data-role="baseURL" value="${esc(ep.baseURL)}" placeholder="https://..." />
          <p class="text-xs text-slate-500 mt-1" data-role="proto-hint"></p>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div class="md:col-span-2">
              <label class="form-label">API Key</label>
              <input type="password" class="form-input" data-role="apiKey" value="${esc(ep.apiKey || '')}" placeholder="粘贴此处" autocomplete="off" />
            </div>
            <div>
              <label class="form-label">协议</label>
              <select class="form-input" data-role="protocol">
                <option value="auto">自动识别</option>
                <option value="openai">OpenAI 兼容</option>
                <option value="gemini">Google Gemini</option>
                <option value="fal">fal.ai 队列</option>
              </select>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 items-center mt-3">
            <button class="btn-ghost" data-act="ping">💚 测试连通性</button>
            <span class="text-xs" data-role="ping-status"></span>
          </div>
        </div>
      </div>
    `;

    const $name    = block.querySelector('[data-role=name]');
    const $base    = block.querySelector('[data-role=baseURL]');
    const $key     = block.querySelector('[data-role=apiKey]');
    const $proto   = block.querySelector('[data-role=protocol]');
    const $hint    = block.querySelector('[data-role=proto-hint]');
    const $status  = block.querySelector('[data-role=ping-status]');

    // initial values
    $proto.value = ['auto', 'openai', 'gemini', 'fal'].includes(ep.protocol) ? ep.protocol : 'auto';

    function refreshHint() {
      const probe = { ...ep, baseURL: $base.value, protocol: $proto.value };
      const detected = detectProtocol(probe);
      const fixed = $proto.value !== 'auto' ? $proto.value : detected;
      const map = { openai: 'OpenAI 兼容', gemini: 'Google Gemini', fal: 'fal.ai 队列' };
      $hint.textContent = ($proto.value === 'auto'
        ? `↳ 自动识别为：${map[detected] || detected} 协议`
        : `↳ 手动指定：${map[fixed] || fixed} 协议（基于 baseURL 本应识别为 ${map[detected] || detected}）`);
    }
    refreshHint();

    // wire updates (写回内存 s + 持久化)
    function commit(patch) {
      Object.assign(ep, patch);
      updateEndpoint(ep.id, patch);
      // re-pull s so capability resolver、endpointsFor 能反映出来
      s = structuredClone(loadSettings());
      // 端点变化可能影响能力指派下拉，刷新它
      renderCapabilityGrid();
    }
    $name.onchange  = () => commit({ name: $name.value.trim() || ep.id });
    $base.onchange  = () => { commit({ baseURL: $base.value.trim() }); refreshHint(); };
    $key.onchange   = () => commit({ apiKey: $key.value.trim() });
    $proto.onchange = () => { commit({ protocol: $proto.value }); refreshHint(); };
    $base.oninput   = refreshHint;
    $proto.oninput  = refreshHint;

    // remove
    block.querySelector('[data-act=remove]').onclick = () => {
      if (!confirm(`删除端点「${ep.name}」？任何指向它的能力会回退到第一个可用端点。`)) return;
      removeEndpoint(ep.id);
      s = structuredClone(loadSettings());
      renderEndpointList();
      renderCapabilityGrid();
      toast('已删除', 'success');
    };

    // ping
    block.querySelector('[data-act=ping]').onclick = async () => {
      const liveEp = { ...ep, baseURL: $base.value.trim(), apiKey: $key.value.trim(), protocol: $proto.value };
      $status.className = 'text-xs text-slate-500';
      $status.textContent = '⏳ 测试中…';
      try {
        const msg = await pingEndpoint(liveEp);
        $status.className = 'text-xs text-emerald-600';
        $status.textContent = '✓ ' + msg;
      } catch (e) {
        $status.className = 'text-xs text-red-600';
        $status.textContent = '✗ ' + (e.message || String(e));
      }
    };

    return block;
  }

  // ── ep actions: 添加自定义 / 从预设添加
  epActions.innerHTML = `
    <button class="btn-primary" data-act="add-custom">+ 添加自定义端点</button>
    <div class="relative inline-block">
      <button class="btn-ghost" data-act="add-preset">▪ 从预设添加 ▾</button>
      <div class="hidden absolute right-0 mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-lg z-10 max-h-72 overflow-auto" data-role="preset-menu"></div>
    </div>
  `;
  epActions.querySelector('[data-act=add-custom]').onclick = () => {
    const ep = addEndpoint({ name: '自定义端点', baseURL: '', apiKey: '', protocol: 'auto' });
    s = structuredClone(loadSettings());
    renderEndpointList();
    renderCapabilityGrid();
    // 滚动到新端点并 focus name 字段
    const row = epList.querySelector(`[data-ep-id="${ep.id}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row?.querySelector('[data-role=name]')?.focus();
  };
  const presetBtn = epActions.querySelector('[data-act=add-preset]');
  const presetMenu = epActions.querySelector('[data-role=preset-menu]');
  presetBtn.onclick = (e) => {
    e.stopPropagation();
    rebuildPresetMenu();
    presetMenu.classList.toggle('hidden');
  };
  document.addEventListener('click', () => presetMenu.classList.add('hidden'));
  function rebuildPresetMenu() {
    presetMenu.innerHTML = '';
    const usedIds = new Set(s.endpoints.map(e => e.id));
    const remaining = PRESET_ENDPOINTS.filter(p => !usedIds.has(p.id));
    if (!remaining.length) {
      presetMenu.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400">（6 个预设都已添加）</div>';
      return;
    }
    for (const p of remaining) {
      const item = document.createElement('button');
      item.className = 'block w-full text-left px-3 py-2 hover:bg-slate-50 text-sm';
      item.innerHTML = `<div class="font-medium">${esc(p.name)}</div><div class="text-xs text-slate-500 truncate">${esc(p.baseURL)}</div>`;
      item.onclick = () => {
        try {
          addPresetEndpoint(p.id);
          s = structuredClone(loadSettings());
          renderEndpointList();
          renderCapabilityGrid();
          presetMenu.classList.add('hidden');
          toast(`已添加 ${p.name}`, 'success');
        } catch (e) { toast(e.message, 'error'); }
      };
      presetMenu.appendChild(item);
    }
  }

  /* ───────────────────── 能力指派 ───────────────────── */

  const capCard = document.createElement('div');
  capCard.className = 'card mb-5';
  capCard.innerHTML = `
    <h2 class="text-base font-semibold mb-1">能力指派</h2>
    <p class="text-sm text-slate-500 mb-3">
      为每个能力挑选默认端点 + 模型。下拉只显示协议支持该能力的端点（比如 fal.ai 协议没有 chat，所以"Prompt 改写"里看不到）。
    </p>
    <div class="space-y-3" data-role="cap-grid"></div>
  `;
  host.appendChild(capCard);
  const capGrid = capCard.querySelector('[data-role=cap-grid]');

  function renderCapabilityGrid() {
    capGrid.innerHTML = '';
    s = structuredClone(loadSettings());
    for (const cap of CAPABILITY_LIST) {
      capGrid.appendChild(buildCapabilityRow(cap));
    }
  }

  function buildCapabilityRow(cap) {
    const eps = endpointsFor(cap);
    const cur = s.capabilities[cap] || {};
    const wrap = document.createElement('div');
    wrap.className = 'grid grid-cols-1 md:grid-cols-[1fr_2fr_2fr] gap-2 items-end';
    wrap.innerHTML = `
      <div>
        <label class="form-label">${capLabel(cap)}</label>
      </div>
      <div>
        <select class="form-input" data-role="ep"></select>
      </div>
      <div>
        <input class="form-input" data-role="model" value="${esc(cur.model || '')}" placeholder="${esc(modelPlaceholder(cap))}" />
      </div>
    `;
    const $ep    = wrap.querySelector('[data-role=ep]');
    const $model = wrap.querySelector('[data-role=model]');

    if (!eps.length) {
      const o = document.createElement('option');
      o.textContent = '（无支持的端点 — 请先添加并填好 Key/baseURL）';
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
      const model = $model.value.trim();
      setCapability(cap, epId, model);
      s = structuredClone(loadSettings());
    }
    $ep.onchange    = commit;
    $model.onchange = commit;

    return wrap;
  }

  /* ───────────────────── 通用 ───────────────────── */

  const genCard = document.createElement('div');
  genCard.className = 'card mb-5';
  genCard.innerHTML = `
    <h2 class="text-base font-semibold mb-2">通用</h2>
    <label class="form-label">并发数（批量任务同时跑几个）</label>
    <input id="conc" type="number" min="1" max="10" class="form-input max-w-xs" value="${s.concurrency}" />
    <label class="form-label mt-3">CORS 代理（可选，少数 API 浏览器调不通时用）</label>
    <input id="proxy" class="form-input" placeholder="例：https://your-worker.workers.dev" value="${esc(s.corsProxy || '')}" />
    <p class="text-xs text-slate-500 mt-1">推荐自部署一个 Cloudflare Worker，参考 README。</p>
  `;
  genCard.querySelector('#conc').onchange  = e => { s.concurrency = +e.target.value || 3; saveSettings(s); };
  genCard.querySelector('#proxy').onchange = e => { s.corsProxy = e.target.value.trim();  saveSettings(s); };
  host.appendChild(genCard);

  /* ───────────────────── 操作栏 ───────────────────── */

  const bar = document.createElement('div');
  bar.className = 'card flex flex-wrap gap-2';
  bar.innerHTML = `
    <button id="export" class="btn-ghost">导出 JSON</button>
    <button id="import" class="btn-ghost">导入 JSON</button>
    <input  id="file"   type="file" accept=".json,application/json" class="hidden" />
    <button id="clear"  class="btn-ghost text-red-600">清除全部 Key</button>
    <button id="reset"  class="btn-ghost text-red-600">重置为默认（恢复 6 个预设端点）</button>
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
      toast('导入成功，刷新页面以生效', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  bar.querySelector('#clear').onclick = () => {
    if (!confirm('清除全部 API Key？端点本身和能力指派会保留。')) return;
    clearKeys();
    s = structuredClone(loadSettings());
    renderEndpointList();
    toast('已清除', 'success');
  };
  bar.querySelector('#reset').onclick = () => {
    if (!confirm('重置所有设置为默认？API Key 也会清空。')) return;
    saveSettings(structuredClone(DEFAULT_SETTINGS));
    toast('已重置', 'success');
    setTimeout(() => location.reload(), 600);
  };

  // initial paint
  renderEndpointList();
  renderCapabilityGrid();
}

function capLabel(c) {
  return ({
    vision: '反推视觉 vision',
    chat:   'Prompt 改写 chat',
    image:  '生图 image',
    edit:   '图像编辑 edit',
    video:  '视频生成 video',
  })[c] || c;
}

function modelPlaceholder(c) {
  return ({
    vision: '如 doubao-seed-1-6-vision-250815 / gemini-2.5-flash / gpt-4o',
    chat:   '如 deepseek-chat / gpt-4o / Qwen/Qwen2.5-72B-Instruct',
    image:  '如 doubao-seedream-4-0-250828 / gpt-image-1 / Kwai-Kolors/Kolors',
    edit:   '通常与生图同一模型',
    video:  '如 doubao-seedance-1-0-pro-250528 / fal-ai/kling-video/...',
  })[c] || '';
}
