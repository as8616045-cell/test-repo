// pages/settings-page.js — v4.2
//
// 极简两字段表单（Base URL + API Key）+ 静默自动识别 +
// 高端的端点列表 + 大胆的能力指派两个桶。
//
// 设计原则:
//   · 识别成功（高置信度）才显示厂商徽章；不认识的 URL 完全不打扰用户
//   · 用户不需要选协议、选预设、选 id —— 系统全部自动决定
//   · 没数据时给清晰的空态指引,有数据时把列表做成可悬停的卡

import {
  loadSettings, saveSettings, DEFAULT_SETTINGS,
  exportSettings, importSettings, clearKeys,
  BUCKETS,
  addEndpoint, removeEndpoint,
  setCapability, detectProvider, normalizeBaseURL,
} from '../settings.js';
import { endpointsFor, pingEndpoint, protocolName, listEndpointModels, pickModelForBucket } from '../api/index.js';
import { toast, esc, download, readJSONFile } from '../utils.js';

export async function render(host) {
  let s = structuredClone(loadSettings());

  /* ───────────────────── Hero ───────────────────── */

  host.innerHTML = `
    <div class="page-hero">
      <h1>
        <span class="hero-icon">⚙️</span>
        <span>设置</span>
      </h1>
      <p class="lead">
        粘贴 <code class="kbd">Base URL</code> 和 <code class="kbd">API Key</code>,系统会自动识别厂商。<br/>
        所有 Key 只保存在本机,绝不会上传到任何服务器。
      </p>
    </div>
  `;

  /* ───────────────────── ① 添加 API ───────────────────── */

  const addCard = document.createElement('div');
  addCard.className = 'card mb-5';
  addCard.innerHTML = `
    <div class="flex items-start justify-between mb-1">
      <div>
        <div class="card-title"><span>🔗</span><span>添加 API</span></div>
        <p class="card-desc">填好两项就能用 — 别的不用管</p>
      </div>
    </div>

    <div class="mt-5 space-y-4">
      <div>
        <label class="form-label">Base URL</label>
        <input class="form-input mono" data-role="baseURL"
               placeholder="https://api.openai.com" autocomplete="off" spellcheck="false" />
        <div class="mt-2 min-h-[20px]" data-role="detect-line"></div>
        <p class="text-xs text-slate-400 mt-1 leading-relaxed">
          填的是 <b>API 接口地址</b>,通常是官网域名或 API 文档里给的地址(常以 <code class="kbd">/v1</code> 结尾)。<br/>
          ⚠️ 不要填你登录中转站网站后看到的<b>网页地址</b>(如 <code class="kbd">.../home</code>、<code class="kbd">.../draw</code>、<code class="kbd">.../api-keys</code>)。<br/>
          中转站的 API 地址请在其「接口文档 / API 说明」里找,例如 <code class="kbd">https://xxx.com/codex/v1</code>。
        </p>
      </div>

      <div>
        <label class="form-label">API Key</label>
        <input type="password" class="form-input mono" data-role="apiKey"
               placeholder="sk-... / 粘贴你的 Key" autocomplete="off" />
      </div>

      <div class="flex flex-wrap gap-2 items-center pt-1">
        <button class="btn-primary" data-act="save">+ 添加</button>
        <button class="btn-ghost" data-act="test">先测试</button>
        <span class="text-xs ml-auto" data-role="status"></span>
      </div>
    </div>
  `;
  host.appendChild(addCard);

  const $base   = addCard.querySelector('[data-role=baseURL]');
  const $key    = addCard.querySelector('[data-role=apiKey]');
  const $line   = addCard.querySelector('[data-role=detect-line]');
  const $status = addCard.querySelector('[data-role=status]');

  /**
   * 自动识别条 —— 只在高置信度时显示徽章；
   * 没识别出来 / 输入为空 时静默。这样用户不会被"未知"或"低置信度"打扰。
   */
  function refreshDetection() {
    const raw = $base.value.trim();
    if (!raw) { $line.innerHTML = ''; return; }
    const url = normalizeBaseURL(raw);
    const det = detectProvider(url);

    // 如果规范化后地址变了(用户粘了 /home /dashboard 等后台页面),明确告诉他实际会用哪个
    const cleanedNote = (url !== raw)
      ? `<div class="text-xs text-amber-600 mt-1">已自动修正为 <code class="kbd">${esc(url)}</code>（你粘贴的地址带了网页后台路径）</div>`
      : '';

    if (det.confidence === 'high') {
      $line.innerHTML = `
        <span class="pill pill-violet">
          <span class="text-base leading-none">${esc(det.icon)}</span>
          ${esc(det.name)}
        </span>
        ${cleanedNote}
      `;
    } else {
      // 未知 URL: 假定为 OpenAI 兼容,给一个非常含蓄的提示
      $line.innerHTML = `
        <span class="text-xs text-slate-400">将作为 OpenAI 兼容 API 处理</span>
        ${cleanedNote}
      `;
    }
  }
  $base.oninput = refreshDetection;
  refreshDetection();

  function readForm() {
    const rawURL = $base.value.trim();
    const apiKey = $key.value.trim();
    if (!rawURL) { $base.focus(); throw new Error('请填 Base URL'); }
    if (!apiKey) { $key.focus();  throw new Error('请填 API Key'); }
    const baseURL = normalizeBaseURL(rawURL);
    return { baseURL, apiKey, det: detectProvider(baseURL) };
  }

  function rerender() {
    s = structuredClone(loadSettings());
    renderEndpointList();
    renderCapabilityRows();
  }

  addCard.querySelector('[data-act=save]').onclick = async () => {
    let info; try { info = readForm(); } catch (e) { return toast(e.message, 'warn'); }
    const ep = addEndpoint({
      name: info.det.name,
      baseURL: info.baseURL,
      apiKey: info.apiKey,
      protocol: 'auto',
    });
    // 自动指派 — 哪个桶还没指派就指到这个新端点 + 默认模型（先用 detectProvider 的猜测,稍后用真实列表校准）
    s = structuredClone(loadSettings());
    if (!s.capabilities.llm.endpointId && info.det.defaultModels?.llm) {
      setCapability('llm', ep.id, info.det.defaultModels.llm);
    }
    if (!s.capabilities.image.endpointId && info.det.defaultModels?.image) {
      setCapability('image', ep.id, info.det.defaultModels.image);
    }

    // 关键: 拉真实模型列表,如果当前默认模型不在列表里,智能改选一个真存在的
    $status.innerHTML = '<span class="text-slate-500"><span class="spinner"></span> 拉取模型列表…</span>';
    let refineMsg = '';
    try {
      const models = await listEndpointModels(ep);
      if (models.length) {
        const refined = await refineCapabilityModels(ep, models);
        if (refined.length) refineMsg = `,自动选: ${refined.join(' / ')}`;
      }
    } catch {
      // 拉不到没关系 — 用户后续可以手动改
    }

    s = structuredClone(loadSettings());
    $base.value = ''; $key.value = '';
    refreshDetection();
    $status.innerHTML = `<span class="text-emerald-600">✓ 已添加 ${esc(ep.name)}${esc(refineMsg)}</span>`;
    setTimeout(() => $status.innerHTML = '', 5000);
    rerender();
    toast(`已添加 ${ep.name}`, 'success');
  };

  /**
   * 拉到真实模型列表后,校准两个桶的默认模型:
   * 如果当前 model 在真实列表里 → 不动；否则按桶类型挑一个最合适的。
   * 返回被改动的桶描述字符串数组(toast 用)。
   */
  async function refineCapabilityModels(ep, models) {
    const ids = new Set(models.map(m => m.id));
    const current = loadSettings().capabilities;
    const changes = [];

    for (const bucket of ['llm', 'image']) {
      if (current[bucket].endpointId !== ep.id) continue;
      const curModel = current[bucket].model;
      if (curModel && ids.has(curModel)) continue;       // 当前模型存在,无需改
      const picked = pickModelForBucket(models, bucket); // 智能挑选
      if (picked) {
        setCapability(bucket, ep.id, picked);
        changes.push(`${bucket === 'llm' ? '💬LLM' : '🖼️图片'}=${picked}`);
      } else if (bucket === 'llm') {
        // LLM 桶若没匹配到 vision 模型,用列表里第一个(总比错的好)
        if (models[0]) {
          setCapability(bucket, ep.id, models[0].id);
          changes.push(`💬LLM=${models[0].id}`);
        }
      }
      // image 桶找不到匹配就不动 — 用户必须手动选,免得错乱
    }
    return changes;
  }

  addCard.querySelector('[data-act=test]').onclick = async () => {
    let info; try { info = readForm(); } catch (e) { return toast(e.message, 'warn'); }
    $status.innerHTML = '<span class="text-slate-500"><span class="spinner"></span> 测试中…</span>';
    try {
      const msg = await pingEndpoint({
        id: '_form', name: info.det.name, baseURL: info.baseURL, apiKey: info.apiKey, protocol: 'auto',
      });
      $status.innerHTML = `<span class="text-emerald-600">✓ ${esc(msg)}</span>`;
    } catch (e) {
      $status.innerHTML = `<span class="text-red-600">✗ ${esc(e.message || String(e))}</span>`;
    }
  };

  /* ───────────────────── ② 已添加的 API ───────────────────── */

  const listCard = document.createElement('div');
  listCard.className = 'card mb-5';
  listCard.innerHTML = `
    <div class="card-title"><span>🗂️</span><span>已添加的 API</span></div>
    <p class="card-desc mb-4">下方"能力指派"会从这里挑选用哪一家</p>
    <div data-role="ep-list" class="space-y-2.5"></div>
  `;
  host.appendChild(listCard);
  const epList = listCard.querySelector('[data-role=ep-list]');

  function renderEndpointList() {
    epList.innerHTML = '';
    if (!s.endpoints.length) {
      epList.innerHTML = `
        <div class="empty-state">
          <div class="icon-circle">🪐</div>
          <div class="title">还没添加任何 API</div>
          <div class="desc">填好上方 Base URL + Key 即可开始</div>
        </div>
      `;
      return;
    }
    for (const ep of s.endpoints) {
      epList.appendChild(buildEndpointRow(ep));
    }
  }

  function buildEndpointRow(ep) {
    const det = detectProvider(ep.baseURL);
    const block = document.createElement('div');
    block.className = 'endpoint-row';
    block.dataset.epId = ep.id;
    block.innerHTML = `
      <div class="ep-icon">${esc(det.icon)}</div>
      <div class="flex-1 min-w-0">
        <div class="ep-name">${esc(ep.name || det.name)}</div>
        <div class="ep-url">${esc(ep.baseURL)}</div>
        <div class="ep-meta">
          <span class="pill pill-slate">${esc(protocolName(ep))}</span>
          <span class="text-xs" data-role="ping"></span>
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button class="btn-ghost" data-act="test" title="测试连通性">
          <span>💚</span>
          <span class="hidden sm:inline">测试</span>
        </button>
        <button class="btn-ghost danger" data-act="remove" title="删除">×</button>
      </div>
    `;
    block.querySelector('[data-act=test]').onclick = async () => {
      const $p = block.querySelector('[data-role=ping]');
      $p.innerHTML = '<span class="spinner"></span> 测试中…';
      try {
        const msg = await pingEndpoint(ep);
        $p.innerHTML = `<span class="status-dot ok mr-1.5"></span><span class="text-emerald-600">${esc(msg)}</span>`;
      } catch (e) {
        $p.innerHTML = `<span class="status-dot error mr-1.5"></span><span class="text-red-600">${esc(e.message || String(e))}</span>`;
      }
    };
    block.querySelector('[data-act=remove]').onclick = () => {
      if (!confirm(`删除「${ep.name}」?\n任何指向它的能力指派会自动回退到第一个可用端点。`)) return;
      removeEndpoint(ep.id);
      rerender();
      toast('已删除', 'success');
    };
    return block;
  }

  /* ───────────────────── ③ 能力指派（仅 2 桶） ───────────────────── */

  const capCard = document.createElement('div');
  capCard.className = 'card mb-5';
  capCard.innerHTML = `
    <div class="card-title"><span>🎯</span><span>能力指派</span></div>
    <p class="card-desc mb-4">
      只分两类:<b class="text-slate-700">LLM</b>(反推 + 改写,文字或多模态)和 <b class="text-slate-700">图片</b>(生图 + 编辑 + 视频)。<br/>
      下拉只显示协议支持该类型的端点 — 比如 fal.ai 不会出现在 LLM 下拉里。
    </p>
    <div class="space-y-3" data-role="cap-rows"></div>
  `;
  host.appendChild(capCard);
  const capRows = capCard.querySelector('[data-role=cap-rows]');

  const BUCKET_META = {
    llm:   { icon: '💬', name: 'LLM',   tag: '反推 + 改写' },
    image: { icon: '🖼️', name: '图片',  tag: '生图 + 编辑 + 视频' },
  };

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
    const meta = BUCKET_META[bucket];
    const wrap = document.createElement('div');
    wrap.className = 'capability-card';
    wrap.innerHTML = `
      <div>
        <div class="cap-label">
          <span class="text-lg leading-none">${esc(meta.icon)}</span>
          <span>${esc(meta.name)}</span>
        </div>
        <div class="cap-hint">${esc(meta.tag)}</div>
      </div>
      <div>
        <label class="form-label">端点</label>
        <select class="form-input" data-role="ep"></select>
      </div>
      <div>
        <label class="form-label flex items-center justify-between">
          <span>模型</span>
          <span class="text-[11px] font-normal" data-role="hint"></span>
        </label>
        <div data-role="model-host"></div>
      </div>
    `;
    const $ep    = wrap.querySelector('[data-role=ep]');
    const $hint  = wrap.querySelector('[data-role=hint]');
    const $host  = wrap.querySelector('[data-role=model-host]');

    if (!eps.length) {
      const o = document.createElement('option');
      o.textContent = '— 还没添加支持此类型的 API —';
      o.disabled = true; o.selected = true;
      $ep.appendChild(o);
      $ep.disabled = true;
      $host.innerHTML = `<input class="form-input mono" disabled placeholder="${esc(modelPlaceholder(bucket))}" />`;
      return wrap;
    }

    let matched = false;
    for (const ep of eps) {
      const o = document.createElement('option');
      o.value = ep.id;
      o.textContent = `${ep.name} · ${protocolName(ep)}`;
      if (ep.id === cur.endpointId) { o.selected = true; matched = true; }
      $ep.appendChild(o);
    }
    if (!matched) $ep.value = eps[0].id;

    // 真·下拉式 model picker (替代 datalist,可点击展开 + 输入过滤)
    const combo = createModelCombobox({
      initialValue: cur.model || '',
      placeholder: modelPlaceholder(bucket),
      fetchModels: async () => {
        const ep = s.endpoints.find(e => e.id === $ep.value);
        if (!ep) return [];
        return await listEndpointModels(ep);
      },
      onCommit: (val) => {
        setCapability(bucket, $ep.value, val);
        s = structuredClone(loadSettings());
        loadHint();
      },
      onLoaded: () => loadHint(),
    });
    $host.appendChild(combo.el);

    async function loadHint() {
      $hint.innerHTML = '';
      const epId = $ep.value;
      const ep = s.endpoints.find(e => e.id === epId);
      if (!ep) return;
      $hint.innerHTML = '<span class="text-slate-400">⏳ ...</span>';
      try {
        const models = await listEndpointModels(ep);
        if (!models.length) {
          $hint.innerHTML = '<span class="text-slate-400">该协议无可列模型</span>';
          return;
        }
        const ids = new Set(models.map(m => m.id));
        const curVal = combo.getValue();
        if (curVal && !ids.has(curVal)) {
          $hint.innerHTML = `<span class="text-amber-600">⚠ "${esc(curVal.slice(0, 28))}${curVal.length > 28 ? '…' : ''}" 不在可用列表里</span>`;
        } else if (curVal) {
          $hint.innerHTML = `<span class="text-emerald-600">✓ ${models.length} 个可用模型</span>`;
        } else {
          $hint.innerHTML = `<span class="text-slate-500">点击模型框选择 (${models.length} 个可用)</span>`;
        }
      } catch (e) {
        $hint.innerHTML = `<span class="text-slate-400">无法拉取列表</span>`;
      }
    }

    $ep.onchange = () => {
      combo.setValue('');
      combo.invalidateModels();
      setCapability(bucket, $ep.value, '');
      s = structuredClone(loadSettings());
      loadHint();
    };

    loadHint();
    return wrap;
  }

  /**
   * 真·下拉式 model picker
   * - 点击 input → 立即展开下拉(显示真实模型列表)
   * - 输入文字 → 实时过滤
   * - 点击下拉项 → 填入 + 收起 + commit
   * - 失焦或点击外部 → 收起
   * - 支持自定义值(用户键盘输入了不在列表里的值,onchange 时 commit)
   */
  function createModelCombobox({ initialValue, placeholder, fetchModels, onCommit, onLoaded }) {
    const wrap = document.createElement('div');
    wrap.className = 'combo-wrap';

    const input = document.createElement('input');
    input.className = 'form-input mono';
    input.value = initialValue || '';
    input.placeholder = placeholder || '';
    input.autocomplete = 'off';
    input.spellcheck = false;

    const drop = document.createElement('div');
    drop.className = 'combo-drop hidden';

    let models = null;
    let loading = false;

    async function ensureModels(force) {
      if (force) { models = null; loading = false; }
      if (models != null || loading) return;
      loading = true;
      drop.innerHTML = '<div class="combo-msg">⏳ 拉取模型列表…</div>';
      try {
        models = await fetchModels();
      } catch {
        models = [];
      } finally {
        loading = false;
      }
      onLoaded?.(models);
    }

    function renderList(filter) {
      drop.innerHTML = '';
      if (!models || !models.length) {
        drop.innerHTML = '<div class="combo-msg">该协议无可列模型 — 直接键入模型名</div>';
        return;
      }
      const f = (filter || '').toLowerCase();
      const filtered = f
        ? models.filter(m => m.id.toLowerCase().includes(f))
        : models;
      if (!filtered.length) {
        drop.innerHTML = '<div class="combo-msg">无匹配 — 你输入的内容会作为自定义模型保存</div>';
        return;
      }
      const cap = 200;
      const list = filtered.slice(0, cap);
      for (const m of list) {
        const it = document.createElement('div');
        it.className = 'combo-item';
        it.textContent = m.id;
        it.onclick = (e) => {
          e.stopPropagation();
          input.value = m.id;
          drop.classList.add('hidden');
          onCommit?.(m.id);
        };
        drop.appendChild(it);
      }
      if (filtered.length > cap) {
        const more = document.createElement('div');
        more.className = 'combo-msg';
        more.textContent = `…还有 ${filtered.length - cap} 个,继续输入筛选`;
        drop.appendChild(more);
      }
    }

    input.onfocus = async () => {
      await ensureModels(false);
      drop.classList.remove('hidden');
      renderList(input.value);
    };
    input.onclick = async (e) => {
      e.stopPropagation();
      await ensureModels(false);
      drop.classList.remove('hidden');
      renderList(input.value);
    };
    input.oninput = () => {
      drop.classList.remove('hidden');
      renderList(input.value);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Escape') drop.classList.add('hidden');
    };
    input.onchange = () => onCommit?.(input.value.trim());

    // 点击外部时关闭
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) drop.classList.add('hidden');
    });

    wrap.appendChild(input);
    wrap.appendChild(drop);

    return {
      el: wrap,
      getValue: () => input.value.trim(),
      setValue: (v) => { input.value = v || ''; },
      invalidateModels: () => { models = null; },
    };
  }

  /* ───────────────────── ④ 通用 ───────────────────── */

  const genCard = document.createElement('div');
  genCard.className = 'card mb-5';
  genCard.innerHTML = `
    <div class="card-title"><span>🛠️</span><span>通用</span></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div>
        <label class="form-label">并发数</label>
        <input id="conc" type="number" min="1" max="10" class="form-input" value="${s.concurrency}" />
        <p class="text-xs text-slate-500 mt-1">批量任务同时跑几个</p>
      </div>
      <div>
        <label class="form-label">CORS 代理（可选）</label>
        <input id="proxy" class="form-input mono" placeholder="https://your-worker.workers.dev" value="${esc(s.corsProxy || '')}" />
        <p class="text-xs text-slate-500 mt-1">少数 API 浏览器调不通时用,推荐自部署 Cloudflare Worker</p>
      </div>
    </div>
  `;
  genCard.querySelector('#conc').onchange  = e => { s.concurrency = +e.target.value || 3; saveSettings(s); };
  genCard.querySelector('#proxy').onchange = e => { s.corsProxy = e.target.value.trim();  saveSettings(s); };
  host.appendChild(genCard);

  /* ───────────────────── ⑤ 操作栏 ───────────────────── */

  const bar = document.createElement('div');
  bar.className = 'card flex flex-wrap gap-2 items-center';
  bar.innerHTML = `
    <button id="export" class="btn-ghost">↓ 导出 JSON</button>
    <button id="import" class="btn-ghost">↑ 导入 JSON</button>
    <input  id="file"   type="file" accept=".json,application/json" class="hidden" />
    <span class="flex-1"></span>
    <button id="clear"  class="btn-ghost danger">清除全部 Key</button>
    <button id="reset"  class="btn-ghost danger">重置</button>
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
    if (!confirm('清除全部 API Key?\n端点和能力指派会保留。')) return;
    clearKeys();
    rerender();
    toast('已清除', 'success');
  };
  bar.querySelector('#reset').onclick = () => {
    if (!confirm('重置所有设置?\n所有 API、Key 和能力指派都会被清空。')) return;
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
    llm:   'doubao-seed-1-6-vision-250815 / gpt-4o / gemini-2.5-flash',
    image: 'doubao-seedream-4-0-250828 / gpt-image-1 / Kwai-Kolors/Kolors',
  })[bucket] || '';
}
