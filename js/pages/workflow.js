// pages/workflow.js — 统一工作流：所有能力组合在一个页面
//
// 设计原则：把"反推、文生图、图生图、一致性、换X、批量"全部统一成一组可勾选的步骤，
// 通过三个槽位（模特/服装/场景）+ prompt 模板 + 批量模式来组合任意需求。

import { fileToDataURL, esc, toast, uid, urlToDataURL, timestampedName, copyText, download } from '../utils.js';
import { providerSelect, previewImage, section } from '../components.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import * as API from '../api/index.js';
import { loadSettings } from '../settings.js';

// 三个槽位的语义键
const SLOTS = [
  { key: 'model',  zh: '模特',  emoji: '👤', placeholder: '一位 30 岁亚洲女性，长发，自然妆容' },
  { key: 'outfit', zh: '服装/产品', emoji: '👗', placeholder: '白色丝绸连衣裙' },
  { key: 'scene',  zh: '场景/背景', emoji: '🌆', placeholder: '海边日落沙滩，电影感光影' },
];

const BATCH_MODES = [
  { id: 'single',   name: '单次（当前配置生 1 组）' },
  { id: 'repeat',   name: '同 prompt 重复 N 次（生多个变体）' },
  { id: 'prompts',  name: '不同提示词列表（每行一个 prompt）' },
  { id: 'combine',  name: '槽位笛卡尔积（多张图自动两两组合）' },
];

export async function render(host) {
  // 内部状态
  const state = {
    reverseImages: [],            // [{name, dataURL}]
    promptTemplate: '',
    promptList: '',                // 多行
    slots: {                       // 三个槽位
      model:  { mode: 'off', text: '', images: [] },
      outfit: { mode: 'off', text: '', images: [] },
      scene:  { mode: 'off', text: '', images: [] },
    },
    provider: '',                  // 空 = 用 settings 默认
    size: '1024x1024',
    n: 1,                          // 每个任务出几张
    batchMode: 'single',
    repeatCount: 4,
    aborter: null,
  };

  host.innerHTML = `<h1 class="text-2xl font-bold mb-1">🎨 工作流</h1>
    <p class="text-slate-500 mb-5">所有能力（反推 / 文生图 / 图生图 / 一致性 / 换X / 批量）都在这里组合。</p>`;

  // ── ① 反推（可选）
  host.appendChild(buildReverseStep(state));

  // ── ② Prompt
  host.appendChild(buildPromptStep(state));

  // ── ③ 三个槽位
  host.appendChild(buildSlotsStep(state));

  // ── ④ 生成参数
  host.appendChild(buildParamsStep(state));

  // ── ⑤ 批量模式
  host.appendChild(buildBatchStep(state));

  // ── ⑥ 运行 + 进度 + 结果
  host.appendChild(buildRunStep(state));
}

/* ────────────────────────────────────────────────────────────
 * Step builders
 * ──────────────────────────────────────────────────────────── */

function buildReverseStep(state) {
  const wrap = document.createElement('details');
  wrap.className = 'card mb-5';
  wrap.innerHTML = `
    <summary class="cursor-pointer font-semibold text-slate-900">① 反推提示词（可选）</summary>
    <p class="text-sm text-slate-500 mt-1 mb-3">上传参考图，自动反推出 prompt，填到下方主 prompt 框。</p>
    <div data-role="dz"></div>
    <div class="flex gap-2 items-center mt-3">
      <span class="text-sm text-slate-600">服务商：</span>
      <div data-role="prov"></div>
      <button class="btn-primary" data-act="reverse">反推 → 填入 prompt</button>
    </div>
    <div class="mt-3 text-sm text-slate-600 hidden bg-slate-50 rounded p-3 whitespace-pre-wrap" data-role="out"></div>
  `;
  const dz = simpleDropzone({ multiple: true, onChange: files => state.reverseImages = files });
  wrap.querySelector('[data-role=dz]').appendChild(dz.el);
  const prov = providerSelect('vision');
  wrap.querySelector('[data-role=prov]').appendChild(prov);
  const out = wrap.querySelector('[data-role=out]');

  wrap.querySelector('[data-act=reverse]').onclick = async (e) => {
    if (!state.reverseImages.length) return toast('请先上传参考图', 'warn');
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 分析中…';
    try {
      const { text } = await API.reverseImage(
        state.reverseImages.map(f => f.dataURL), null, prov.value
      );
      out.classList.remove('hidden');
      out.textContent = text;
      // 填到主 prompt（如果是空的，直接放；否则追加）
      const ta = document.querySelector('[data-role=prompt-template]');
      if (ta) {
        ta.value = ta.value ? (ta.value + '\n' + text) : text;
        state.promptTemplate = ta.value;
      }
      toast('已反推并填入 prompt ✅', 'success');
    } catch (err) {
      toast(err.message, 'error', 5000);
    } finally {
      btn.disabled = false; btn.textContent = '反推 → 填入 prompt';
    }
  };
  return wrap;
}

function buildPromptStep(state) {
  const wrap = document.createElement('section');
  wrap.className = 'card mb-5';
  wrap.innerHTML = `
    <h2 class="font-semibold text-slate-900">② 主 Prompt</h2>
    <p class="text-sm text-slate-500 mt-1 mb-3">
      可用占位符：<span class="kbd">{model}</span> <span class="kbd">{outfit}</span> <span class="kbd">{scene}</span>
      —— 会被下方槽位的值替换；如槽位提供的是图片，则在 prompt 里替换为提示语并把图作为参考。
    </p>
    <textarea data-role="prompt-template" class="form-textarea" rows="5"
      placeholder="例：{model} 穿着 {outfit}，置身于 {scene}，电影感光影，专业摄影"></textarea>

    <div class="flex flex-wrap gap-2 mt-3 items-center">
      <button class="btn-ghost" data-act="rewrite">✨ LLM 改写润色</button>
      <span class="text-sm text-slate-500">服务商：</span>
      <div data-role="prov"></div>
    </div>
  `;
  const ta = wrap.querySelector('[data-role=prompt-template]');
  ta.oninput = () => state.promptTemplate = ta.value;
  const prov = providerSelect('vision');
  wrap.querySelector('[data-role=prov]').appendChild(prov);

  wrap.querySelector('[data-act=rewrite]').onclick = async (e) => {
    if (!ta.value.trim()) return toast('请先输入 prompt', 'warn');
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 改写中…';
    try {
      const { text } = await API.rewritePrompt(ta.value, prov.value);
      ta.value = text;
      state.promptTemplate = text;
      toast('已改写 ✅', 'success');
    } catch (err) {
      toast(err.message, 'error', 5000);
    } finally {
      btn.disabled = false; btn.textContent = '✨ LLM 改写润色';
    }
  };
  return wrap;
}

function buildSlotsStep(state) {
  const wrap = document.createElement('section');
  wrap.className = 'card mb-5';
  wrap.innerHTML = `
    <h2 class="font-semibold text-slate-900">③ 元素槽位</h2>
    <p class="text-sm text-slate-500 mt-1 mb-3">
      每个槽位独立选模式：<b>不用 / 文字 / 单张图（固定）/ 多张图（批量）</b>。
      想"只换模特"就把模特设多张，其余设固定；想"全换"就都设多张。
    </p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4" data-role="slots-host"></div>
  `;
  const slotsHost = wrap.querySelector('[data-role=slots-host]');
  for (const s of SLOTS) {
    slotsHost.appendChild(buildSlot(state, s));
  }
  return wrap;
}

function buildSlot(state, def) {
  const slot = state.slots[def.key];
  const el = document.createElement('div');
  el.className = 'border border-slate-200 rounded-lg p-3';
  el.innerHTML = `
    <div class="flex items-center gap-2 mb-2">
      <span class="text-lg">${def.emoji}</span>
      <h3 class="font-semibold">${esc(def.zh)} <span class="text-xs text-slate-400">{${def.key}}</span></h3>
    </div>
    <select class="form-input mb-2" data-role="mode">
      <option value="off">不使用</option>
      <option value="text">文字</option>
      <option value="image">单张图（固定）</option>
      <option value="images">多张图（批量）</option>
    </select>
    <div data-role="body"></div>
  `;
  const modeSel = el.querySelector('[data-role=mode]');
  const body = el.querySelector('[data-role=body]');
  modeSel.value = slot.mode;
  modeSel.onchange = () => {
    slot.mode = modeSel.value;
    renderBody();
  };
  function renderBody() {
    body.innerHTML = '';
    if (slot.mode === 'off') {
      body.innerHTML = '<p class="text-xs text-slate-400">不参与本次生成</p>';
      return;
    }
    if (slot.mode === 'text') {
      const ta = document.createElement('textarea');
      ta.className = 'form-textarea';
      ta.rows = 2;
      ta.placeholder = def.placeholder;
      ta.value = slot.text;
      ta.oninput = () => slot.text = ta.value;
      body.appendChild(ta);
      return;
    }
    // image / images
    const dz = simpleDropzone({
      multiple: slot.mode === 'images',
      onChange: files => slot.images = files,
      initial: slot.images,
    });
    body.appendChild(dz.el);
  }
  renderBody();
  return el;
}

function buildParamsStep(state) {
  const wrap = document.createElement('section');
  wrap.className = 'card mb-5';
  wrap.innerHTML = `
    <h2 class="font-semibold text-slate-900">④ 生成参数</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
      <div>
        <label class="form-label">服务商</label>
        <div data-role="prov"></div>
      </div>
      <div>
        <label class="form-label">尺寸</label>
        <select class="form-input" data-role="size">
          <option value="1024x1024">1024×1024 (1:1)</option>
          <option value="1024x1792">1024×1792 (9:16)</option>
          <option value="1792x1024">1792×1024 (16:9)</option>
          <option value="1024x1536">1024×1536 (2:3)</option>
          <option value="1536x1024">1536×1024 (3:2)</option>
        </select>
      </div>
      <div>
        <label class="form-label">每个任务出几张</label>
        <input type="number" min="1" max="4" value="1" class="form-input" data-role="n" />
      </div>
      <div>
        <label class="form-label">备注</label>
        <input type="text" placeholder="可选，方便回看" class="form-input" data-role="note" />
      </div>
    </div>
    <p class="text-xs text-slate-500 mt-2">提示：有任意槽位提供了图片，将走"图生图（编辑）"接口；否则走"文生图"。</p>
  `;
  const provSel = providerSelect('image');
  wrap.querySelector('[data-role=prov]').appendChild(provSel);
  state.provider = provSel.value;
  provSel.onchange = () => state.provider = provSel.value;

  const sizeSel = wrap.querySelector('[data-role=size]');
  sizeSel.value = state.size;
  sizeSel.onchange = () => state.size = sizeSel.value;

  const nInput = wrap.querySelector('[data-role=n]');
  nInput.onchange = () => state.n = Math.max(1, +nInput.value || 1);

  const note = wrap.querySelector('[data-role=note]');
  note.oninput = () => state.note = note.value;

  return wrap;
}

function buildBatchStep(state) {
  const wrap = document.createElement('section');
  wrap.className = 'card mb-5';
  wrap.innerHTML = `
    <h2 class="font-semibold text-slate-900">⑤ 批量模式</h2>
    <div class="space-y-2 mt-3" data-role="modes"></div>
    <div class="hidden mt-3" data-role="repeat">
      <label class="form-label">重复次数</label>
      <input type="number" min="1" max="20" class="form-input max-w-xs" data-role="repeat-n" value="4" />
    </div>
    <div class="hidden mt-3" data-role="prompts">
      <label class="form-label">不同提示词列表（每行一个，会替换主 prompt 模板）</label>
      <textarea class="form-textarea" rows="6" data-role="prompts-ta" placeholder="例：&#10;woman in white dress, beach&#10;woman in red gown, palace&#10;woman in jeans, street"></textarea>
    </div>
  `;
  const modes = wrap.querySelector('[data-role=modes]');
  for (const m of BATCH_MODES) {
    const lb = document.createElement('label');
    lb.className = 'flex items-start gap-2 cursor-pointer';
    lb.innerHTML = `
      <input type="radio" name="batch-mode" value="${m.id}" ${m.id === state.batchMode ? 'checked' : ''} class="mt-1" />
      <span class="text-sm">${esc(m.name)}</span>
    `;
    lb.querySelector('input').onchange = () => {
      state.batchMode = m.id;
      renderSubBoxes();
    };
    modes.appendChild(lb);
  }
  const repeatBox = wrap.querySelector('[data-role=repeat]');
  const promptsBox = wrap.querySelector('[data-role=prompts]');
  const renderSubBoxes = () => {
    repeatBox.classList.toggle('hidden', state.batchMode !== 'repeat');
    promptsBox.classList.toggle('hidden', state.batchMode !== 'prompts');
  };
  wrap.querySelector('[data-role=repeat-n]').onchange = e => state.repeatCount = +e.target.value || 4;
  wrap.querySelector('[data-role=prompts-ta]').oninput = e => state.promptList = e.target.value;
  renderSubBoxes();
  return wrap;
}

function buildRunStep(state) {
  const wrap = document.createElement('section');
  wrap.className = 'card';
  wrap.innerHTML = `
    <div class="flex flex-wrap items-center gap-3">
      <button class="btn-primary" data-act="run">▶ 运行</button>
      <button class="btn-ghost text-red-600 hidden" data-act="stop">⏹ 停止</button>
      <span class="text-sm text-slate-500" data-role="estimate"></span>
    </div>
    <div class="mt-4 hidden" data-role="progress"></div>
    <h3 class="font-semibold mt-5 mb-2 hidden" data-role="results-title">结果</h3>
    <div data-role="results"></div>
  `;
  const estimate = wrap.querySelector('[data-role=estimate]');
  const updateEstimate = () => {
    try {
      const tasks = composeTasks(state);
      estimate.textContent = `预计生成 ${tasks.length * (state.n || 1)} 张图（${tasks.length} 个任务 × 每任务 ${state.n} 张）`;
    } catch (e) {
      estimate.textContent = '⚠ ' + e.message;
    }
  };
  // re-estimate periodically (cheap, lazy)
  setInterval(updateEstimate, 1500);
  updateEstimate();

  const runBtn = wrap.querySelector('[data-act=run]');
  const stopBtn = wrap.querySelector('[data-act=stop]');
  const progressBox = wrap.querySelector('[data-role=progress]');
  const resultsTitle = wrap.querySelector('[data-role=results-title]');
  const resultsBox = wrap.querySelector('[data-role=results]');

  runBtn.onclick = async () => {
    let tasks;
    try { tasks = composeTasks(state); }
    catch (e) { return toast(e.message, 'warn'); }
    if (!tasks.length) return toast('没有可执行的任务', 'warn');

    runBtn.disabled = true; runBtn.innerHTML = '<span class="spinner"></span> 运行中…';
    stopBtn.classList.remove('hidden');
    progressBox.classList.remove('hidden');
    resultsTitle.classList.remove('hidden');
    resultsBox.innerHTML = '';

    state.aborter = new AbortController();
    stopBtn.onclick = () => state.aborter?.abort();

    const renderProgress = (s) => {
      const ok = s.results.filter(r => r.status === 'done').length;
      const err = s.results.filter(r => r.status === 'error').length;
      const run = s.results.filter(r => r.status === 'running').length;
      progressBox.innerHTML = `
        <div class="text-sm">完成 <b>${ok}</b> / 失败 <b class="text-red-600">${err}</b> / 进行中 <b>${run}</b> / 共 ${s.total}</div>
        <div class="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all" style="width:${(ok / s.total) * 100}%"></div>
        </div>`;
    };

    const allOutputs = [];
    try {
      const results = await runBatch(tasks, async (task) => {
        const opts = {
          prompt: task.prompt,
          size: state.size,
          n: state.n,
          aspectRatio: aspectOf(state.size),
        };
        let resp;
        if (task.referenceImages.length) {
          opts.images = task.referenceImages;
          resp = await API.editImage(opts, state.provider);
        } else {
          resp = await API.generateImage(opts, state.provider);
        }
        const dataURLs = await Promise.all(
          resp.images.map(u => u.startsWith('data:') ? u : urlToDataURL(u))
        );
        return { ...resp, dataURLs, task };
      }, { onUpdate: renderProgress, signal: state.aborter.signal });

      // Render results: each task -> a card with its prompt/sources + image grid
      results.forEach((r, i) => {
        const card = renderResultCard(r, i, allOutputs);
        resultsBox.appendChild(card);
      });
      // Save full session in history
      await addHistory({
        id: uid(),
        kind: 'workflow',
        createdAt: Date.now(),
        prompt: state.promptTemplate,
        model: '',
        provider: state.provider || loadSettings().preferred.image,
        inputs: collectInputs(state),
        outputs: allOutputs,
        params: { size: state.size, batchMode: state.batchMode, taskCount: tasks.length, n: state.n },
        note: state.note || '',
      });
      const okCount = results.filter(r => r.status === 'done').length;
      toast(`完成 ${okCount}/${results.length} ✅`, okCount === results.length ? 'success' : 'warn', 4000);
    } catch (e) {
      toast(e.message, 'error', 5000);
    } finally {
      runBtn.disabled = false; runBtn.textContent = '▶ 运行';
      stopBtn.classList.add('hidden');
      state.aborter = null;
    }
  };

  return wrap;
}

/* ────────────────────────────────────────────────────────────
 * Task composition: turn state into a flat list of API calls
 * ──────────────────────────────────────────────────────────── */

function composeTasks(state) {
  const slotValues = {};   // key -> [{kind:'text'|'image'|'off', text?, image?}]
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if (slot.mode === 'off') {
      slotValues[def.key] = [{ kind: 'off' }];
    } else if (slot.mode === 'text') {
      slotValues[def.key] = [{ kind: 'text', text: slot.text || '' }];
    } else if (slot.mode === 'image') {
      if (!slot.images.length) {
        slotValues[def.key] = [{ kind: 'off' }];
      } else {
        slotValues[def.key] = [{ kind: 'image', image: slot.images[0].dataURL, name: slot.images[0].name }];
      }
    } else if (slot.mode === 'images') {
      if (!slot.images.length) {
        slotValues[def.key] = [{ kind: 'off' }];
      } else {
        slotValues[def.key] = slot.images.map(f => ({ kind: 'image', image: f.dataURL, name: f.name }));
      }
    }
  }

  // Decide which prompt(s) to use
  const basePrompt = state.promptTemplate || '';
  let prompts = [basePrompt];
  if (state.batchMode === 'prompts') {
    const lines = (state.promptList || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) throw new Error('已选"不同提示词列表"模式，请在框中输入至少一行');
    prompts = lines;
  }

  // Cartesian product across slots
  const slotKeys = SLOTS.map(s => s.key);
  let combos = [{}];
  for (const k of slotKeys) {
    const next = [];
    for (const c of combos) {
      for (const v of slotValues[k]) {
        next.push({ ...c, [k]: v });
      }
    }
    combos = next;
  }

  // Apply batch mode
  let tasks = [];
  if (state.batchMode === 'combine' || state.batchMode === 'single' || state.batchMode === 'prompts') {
    // single = pick first combo only (or all combos if user already provides multi-image slots)
    // combine = use all combos
    // prompts = use all combos × all prompts
    const useCombos = state.batchMode === 'single' ? [combos[0]] : combos;
    for (const p of prompts) {
      for (const c of useCombos) {
        tasks.push(buildTask(p, c));
      }
    }
  } else if (state.batchMode === 'repeat') {
    const c = combos[0];
    for (let i = 0; i < state.repeatCount; i++) {
      tasks.push(buildTask(basePrompt, c, { variantIndex: i + 1 }));
    }
  }
  if (!tasks.length) throw new Error('没有可执行的任务（检查槽位与 prompt）');
  return tasks;
}

function buildTask(promptTemplate, combo, extra = {}) {
  let prompt = promptTemplate;
  const refs = [];
  const sources = [];
  for (const def of SLOTS) {
    const v = combo[def.key];
    const ph = `{${def.key}}`;
    if (!v || v.kind === 'off') {
      prompt = prompt.replace(ph, '');
      continue;
    }
    if (v.kind === 'text') {
      prompt = prompt.replace(ph, v.text || '');
      sources.push({ slot: def.key, kind: 'text', text: v.text });
    } else if (v.kind === 'image') {
      // 占位符替换为指代提示
      prompt = prompt.replace(ph, `[参考${def.zh}图]`);
      refs.push(v.image);
      sources.push({ slot: def.key, kind: 'image', name: v.name });
    }
  }
  // 清理多余空格
  prompt = prompt.replace(/\s+/g, ' ').trim();
  return { prompt, referenceImages: refs, sources, extra };
}

/* ────────────────────────────────────────────────────────────
 * Result card: display + traceability
 * ──────────────────────────────────────────────────────────── */

function renderResultCard(r, idx, allOutputsAcc) {
  const card = document.createElement('div');
  card.className = 'border border-slate-200 rounded-lg p-3 mb-3';

  const head = document.createElement('div');
  head.className = 'flex items-start justify-between gap-3';
  head.innerHTML = `
    <div class="text-sm flex-1 min-w-0">
      <div class="font-medium text-slate-700">#${idx + 1} ${r.status === 'error' ? '<span class="text-red-600 text-xs">失败</span>' : '<span class="text-emerald-600 text-xs">✓</span>'}</div>
      <div class="text-xs text-slate-500 truncate" title="${esc(r.item.prompt)}">${esc(r.item.prompt.slice(0, 200))}</div>
    </div>
    <button class="btn-ghost text-xs" data-act="copy-prompt">复制 prompt</button>
  `;
  head.querySelector('[data-act=copy-prompt]').onclick = () => copyText(r.item.prompt);
  card.appendChild(head);

  // Sources tags (model/outfit/scene)
  if (r.item.sources?.length) {
    const tags = document.createElement('div');
    tags.className = 'flex flex-wrap gap-1 mt-2';
    for (const s of r.item.sources) {
      const t = document.createElement('span');
      t.className = 'text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600';
      t.textContent = `${slotZh(s.slot)}: ${s.kind === 'text' ? (s.text?.slice(0, 20) || '空') : (s.name || '图')}`;
      tags.appendChild(t);
    }
    card.appendChild(tags);
  }

  if (r.status === 'done' && r.result?.dataURLs?.length) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3';
    r.result.dataURLs.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'img-card bg-white rounded-md border border-slate-200 p-1';
      cell.innerHTML = `
        <img src="${src}" class="w-full rounded cursor-zoom-in" />
        <div class="flex justify-between mt-1 text-xs">
          <span class="text-slate-400">${r.result.provider || ''}</span>
          <button class="btn-ghost" data-act="dl">下载</button>
        </div>
      `;
      cell.querySelector('img').onclick = () => previewImage(src);
      cell.querySelector('[data-act=dl]').onclick = () =>
        download(timestampedName(`task${idx + 1}-${i + 1}`), src);
      grid.appendChild(cell);
      allOutputsAcc.push({ name: timestampedName(`task${idx + 1}-${i + 1}`), dataURL: src, mime: 'image/png' });
    });
    card.appendChild(grid);
  } else if (r.status === 'error') {
    const e = document.createElement('div');
    e.className = 'text-red-600 text-xs mt-2 whitespace-pre-wrap';
    e.textContent = r.error;
    card.appendChild(e);
  }
  return card;
}

function slotZh(key) {
  return SLOTS.find(s => s.key === key)?.zh || key;
}

function collectInputs(state) {
  const inputs = [];
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if ((slot.mode === 'image' || slot.mode === 'images') && slot.images.length) {
      slot.images.forEach((f, i) => inputs.push({ name: `${def.key}-${i + 1}-${f.name}`, dataURL: f.dataURL }));
    }
  }
  state.reverseImages.forEach((f, i) => inputs.push({ name: `ref-${i + 1}-${f.name}`, dataURL: f.dataURL }));
  return inputs;
}

function aspectOf(size) {
  const [w, h] = size.split('x').map(Number);
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

/* ────────────────────────────────────────────────────────────
 * Tiny dropzone helper (slot-aware)
 * ──────────────────────────────────────────────────────────── */

function simpleDropzone({ multiple = false, onChange, initial = [] } = {}) {
  const id = 'dz-' + Math.random().toString(36).slice(2, 8);
  const el = document.createElement('div');
  el.innerHTML = `
    <label for="${id}" class="dropzone block">
      <div class="text-slate-500 text-sm" data-role="hint">点击或拖拽图片到此处${multiple ? '（可多张）' : ''}</div>
      <input id="${id}" type="file" accept="image/*" ${multiple ? 'multiple' : ''} class="hidden" />
    </label>
    <div class="grid grid-cols-3 gap-2 mt-2" data-role="thumbs"></div>
  `;
  const input = el.querySelector('input');
  const dz = el.querySelector('label.dropzone');
  const thumbs = el.querySelector('[data-role=thumbs]');
  const hint = el.querySelector('[data-role=hint]');
  let files = [...(initial || [])];

  function render() {
    thumbs.innerHTML = '';
    files.forEach((f, i) => {
      const c = document.createElement('div');
      c.className = 'relative group';
      c.innerHTML = `
        <img src="${f.dataURL}" class="w-full h-20 object-cover rounded border border-slate-200" />
        <button class="absolute top-0.5 right-0.5 bg-black/60 text-white text-xs rounded px-1 opacity-0 group-hover:opacity-100">×</button>
      `;
      c.querySelector('button').onclick = (e) => {
        e.preventDefault();
        files.splice(i, 1);
        render();
        onChange?.(files);
      };
      thumbs.appendChild(c);
    });
    hint.textContent = files.length
      ? `已选 ${files.length} 张${multiple ? '，可继续添加' : '（再次选会替换）'}`
      : `点击或拖拽图片到此处${multiple ? '（可多张）' : ''}`;
  }

  async function add(list) {
    const arr = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (!arr.length) return;
    const ones = await Promise.all(arr.map(async f => ({
      name: f.name,
      dataURL: await fileToDataURL(f),
    })));
    if (multiple) files.push(...ones);
    else files = [ones[0]];
    render();
    onChange?.(files);
  }

  input.onchange = e => add(e.target.files);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('dragover'); add(e.dataTransfer.files); };

  render();
  return { el, getFiles: () => files };
}
