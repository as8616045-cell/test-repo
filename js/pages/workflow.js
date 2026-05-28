// pages/workflow.js — 统一工作流页面（v2 重写）
//
// 核心思想：
//   总任务数 = prompts 列表大小 × 槽位组合数 × 重复次数
//   ─ prompts 留空 → 用主 prompt 模板（视为 1 行）
//   ─ 三个槽位（模特 / 服装 / 场景）独立配置：不用 / 文字 / 单图 / 多图
//     笛卡尔积自动组合，多张图就自动批量
//   ─ 重复次数让同一组合跑多个变体
//
// 顶部"全局工具条"统一控制服务商 / 尺寸 / 单任务张数 / 重复次数，避免页面里散落多个相同控件。

import { fileToDataURL, esc, toast, uid, urlToDataURL, timestampedName, copyText, download } from '../utils.js';
import { stepFrame, subCard, providerSelect, imageDropzone, previewImage } from '../components.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import * as API from '../api/index.js';
import { loadSettings, updateSettings } from '../settings.js';

/* ──────────────────────────── Constants ──────────────────────────── */

const SLOTS = [
  { key: 'model',  zh: '模特',          emoji: '👤', placeholder: '一位 30 岁亚洲女性，长发，自然妆容' },
  { key: 'outfit', zh: '服装 / 产品',   emoji: '👗', placeholder: '白色丝绸连衣裙' },
  { key: 'scene',  zh: '场景 / 背景',   emoji: '🌆', placeholder: '海边日落沙滩，电影感光影' },
];

// 用查表方式得到 aspect ratio，不再用 gcd（fal 等只接受标准比例）
const SIZES = [
  { value: '1024x1024', label: '1024×1024 (1:1)',   ratio: '1:1'  },
  { value: '1024x1792', label: '1024×1792 (9:16)',  ratio: '9:16' },
  { value: '1792x1024', label: '1792×1024 (16:9)',  ratio: '16:9' },
  { value: '1024x1536', label: '1024×1536 (2:3)',   ratio: '2:3'  },
  { value: '1536x1024', label: '1536×1024 (3:2)',   ratio: '3:2'  },
];

/* ──────────────────────────── Page entry ──────────────────────────── */

export async function render(host) {
  const settings = loadSettings();
  const state = {
    // global
    provider: settings.preferred.image,
    size: '1024x1024',
    n: 1,
    repeat: 1,
    note: '',
    // step 1
    promptTemplate: '',
    promptList: '',
    reverseImages: [],
    lastPromptBeforeRewrite: null,
    // step 2
    slots: {
      model:  { mode: 'off', text: '', images: [] },
      outfit: { mode: 'off', text: '', images: [] },
      scene:  { mode: 'off', text: '', images: [] },
    },
    // run
    aborter: null,
    isRunning: false,
  };

  // listeners that update the estimate badge whenever any input changes
  const onChangeListeners = [];
  const notifyChange = () => onChangeListeners.forEach(fn => { try { fn(); } catch {} });

  host.innerHTML = `
    <h1 class="text-2xl font-bold mb-1">🎨 工作流</h1>
    <p class="text-slate-500 mb-5">在一个页面内组合：反推 / 文生图 / 图生图 / 一致性 / 换 X / 批量。</p>
  `;

  // ─── Sticky global toolbar
  const { el: bar, getEstimateBadge } = buildGlobalBar(state, notifyChange);
  host.appendChild(bar);

  // ─── Step 1: Prompt
  const step1 = stepFrame(1, '主 Prompt', '可用占位符 {model} {outfit} {scene} 引用下方槽位的值。');
  step1.body.appendChild(buildPromptSubCard(state, notifyChange));
  step1.body.appendChild(buildReverseSubCard(state, notifyChange));
  step1.body.appendChild(buildPromptListSubCard(state, notifyChange));
  host.appendChild(step1.el);

  // ─── Step 2: Slots
  const step2 = stepFrame(2, '元素槽位', '每个槽位独立选模式：不使用 / 文字 / 单张图 / 多张图。组合方式见下方"运行"区。');
  for (const def of SLOTS) {
    step2.body.appendChild(buildSlotSubCard(state, def, notifyChange));
  }
  host.appendChild(step2.el);

  // ─── Step 3: Run + Results
  const { el: step3el, render: refreshEstimate, destroy: destroyRun } = buildRunStep(state, getEstimateBadge);
  host.appendChild(step3el);
  onChangeListeners.push(refreshEstimate);

  // initial estimate
  notifyChange();

  // Return cleanup so app.js can stop intervals/aborts when leaving the tab
  return () => {
    try { state.aborter?.abort(); } catch {}
    destroyRun?.();
  };
}

/* ──────────────────────────── Global toolbar ──────────────────────────── */

function buildGlobalBar(state, onChange) {
  const el = document.createElement('div');
  el.className = 'global-bar';
  el.innerHTML = `
    <div class="field">
      <label>服务商（生图 / 编辑）</label>
      <span data-role="prov"></span>
    </div>
    <div class="field">
      <label>尺寸</label>
      <select data-role="size">${SIZES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
    </div>
    <div class="field" style="min-width:90px">
      <label>单任务张数</label>
      <input type="number" min="1" max="4" value="1" data-role="n" />
    </div>
    <div class="field" style="min-width:90px">
      <label>重复次数</label>
      <input type="number" min="1" max="20" value="1" data-role="repeat" />
    </div>
    <div class="field flex-1" style="min-width:200px">
      <label>备注（可选）</label>
      <input type="text" placeholder="方便回看" data-role="note" />
    </div>
    <div class="ml-auto" data-role="estimate-badge">
      <!-- estimate badge here -->
    </div>
  `;
  // provider select (capability='image' since edit is essentially the same provider)
  const provSel = providerSelect('image');
  provSel.classList.remove('form-input');
  provSel.value = state.provider;
  el.querySelector('[data-role=prov]').appendChild(provSel);
  provSel.onchange = () => {
    state.provider = provSel.value;
    // also persist as preferred image+edit so it survives reload
    updateSettings({ preferred: { image: provSel.value, edit: provSel.value } });
    onChange();
  };

  const sizeSel = el.querySelector('[data-role=size]');
  sizeSel.value = state.size;
  sizeSel.onchange = () => { state.size = sizeSel.value; onChange(); };

  const nIn = el.querySelector('[data-role=n]');
  nIn.onchange = () => { state.n = clamp(+nIn.value || 1, 1, 4); nIn.value = state.n; onChange(); };

  const rIn = el.querySelector('[data-role=repeat]');
  rIn.onchange = () => { state.repeat = clamp(+rIn.value || 1, 1, 20); rIn.value = state.repeat; onChange(); };

  const noteIn = el.querySelector('[data-role=note]');
  noteIn.oninput = () => state.note = noteIn.value;

  return {
    el,
    getEstimateBadge: () => el.querySelector('[data-role=estimate-badge]'),
  };
}

/* ──────────────────────────── Step 1: Prompt sub-cards ──────────────────────────── */

function buildPromptSubCard(state, onChange) {
  const card = subCard('Prompt 模板', { hint: '使用 {model} {outfit} {scene} 引用槽位；图片型槽位会自动作为参考图传入 API。' });
  const ta = document.createElement('textarea');
  ta.className = 'form-textarea';
  ta.rows = 4;
  ta.placeholder = '例：{model} 穿着 {outfit}，置身于 {scene}，电影感光影，专业摄影';
  ta.value = state.promptTemplate;
  ta.oninput = () => { state.promptTemplate = ta.value; onChange(); };
  card.body.appendChild(ta);

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap gap-2 items-center mt-3';
  actions.innerHTML = `
    <button class="btn-ghost" data-act="rewrite">✨ LLM 改写润色</button>
    <button class="btn-ghost hidden" data-act="undo">↩ 撤销改写</button>
    <span class="text-xs text-slate-400" data-role="rewriter-hint"></span>
  `;
  const rewriteBtn = actions.querySelector('[data-act=rewrite]');
  const undoBtn = actions.querySelector('[data-act=undo]');
  const hint = actions.querySelector('[data-role=rewriter-hint]');

  rewriteBtn.onclick = async () => {
    if (!ta.value.trim()) return toast('请先输入 prompt', 'warn');
    rewriteBtn.disabled = true;
    rewriteBtn.innerHTML = '<span class="spinner"></span> 改写中…';
    hint.textContent = '';
    try {
      state.lastPromptBeforeRewrite = ta.value;
      const { provider, text } = await API.rewritePrompt(ta.value);
      ta.value = text;
      state.promptTemplate = text;
      undoBtn.classList.remove('hidden');
      hint.textContent = `由 ${provider} 改写`;
      onChange();
      toast('已改写', 'success');
    } catch (e) {
      toast(e.message, 'error', 5000);
      hint.textContent = '改写失败';
    } finally {
      rewriteBtn.disabled = false;
      rewriteBtn.textContent = '✨ LLM 改写润色';
    }
  };
  undoBtn.onclick = () => {
    if (state.lastPromptBeforeRewrite != null) {
      ta.value = state.lastPromptBeforeRewrite;
      state.promptTemplate = ta.value;
      state.lastPromptBeforeRewrite = null;
      undoBtn.classList.add('hidden');
      hint.textContent = '已撤销';
      onChange();
    }
  };
  card.body.appendChild(actions);
  return card.el;
}

function buildReverseSubCard(state, onChange) {
  const card = subCard('反推（可选）', {
    hint: '上传参考图 → 反推出 prompt → 写入上方模板（替换 / 追加）。',
    badge: '可选',
  });
  const dz = imageDropzone({
    multiple: true,
    compact: true,
    onChange: files => { state.reverseImages = files; },
  });
  card.body.appendChild(dz.el);

  const row = document.createElement('div');
  row.className = 'flex flex-wrap gap-2 items-center mt-3';
  row.innerHTML = `
    <button class="btn-primary" data-act="run">反推 → 替换上方 prompt</button>
    <button class="btn-ghost" data-act="append">追加而不是替换</button>
    <span class="text-xs text-slate-500" data-role="status"></span>
  `;
  const runBtn = row.querySelector('[data-act=run]');
  const appendBtn = row.querySelector('[data-act=append]');
  const status = row.querySelector('[data-role=status]');

  async function doReverse(append) {
    if (!state.reverseImages.length) return toast('请先上传参考图', 'warn');
    const btns = [runBtn, appendBtn];
    btns.forEach(b => b.disabled = true);
    runBtn.innerHTML = '<span class="spinner"></span> 分析中…';
    status.textContent = '';
    try {
      const { provider, text } = await API.reverseImage(
        state.reverseImages.map(f => f.dataURL),
        null,
      );
      const ta = document.querySelector('section.step-card textarea.form-textarea');
      if (ta) {
        ta.value = append && ta.value.trim() ? (ta.value + '\n' + text) : text;
        state.promptTemplate = ta.value;
        ta.dispatchEvent(new Event('input'));
      }
      status.textContent = `由 ${provider} 反推`;
      toast('已反推并写入 prompt ✅', 'success');
      onChange();
    } catch (e) {
      toast(e.message, 'error', 5000);
      status.textContent = '失败';
    } finally {
      btns.forEach(b => b.disabled = false);
      runBtn.textContent = '反推 → 替换上方 prompt';
    }
  }
  runBtn.onclick = () => doReverse(false);
  appendBtn.onclick = () => doReverse(true);
  card.body.appendChild(row);
  return card.el;
}

function buildPromptListSubCard(state, onChange) {
  const card = subCard('提示词列表（可选）', {
    hint: '每行一个 prompt。如非空，将用列表中的每行替代上方主模板，与槽位组合做笛卡尔积。',
    badge: '可选',
  });
  const ta = document.createElement('textarea');
  ta.className = 'form-textarea';
  ta.rows = 5;
  ta.placeholder = '留空 = 用上方主 prompt\n或：\nwoman in white dress, beach\nwoman in red gown, palace';
  ta.value = state.promptList;
  ta.oninput = () => { state.promptList = ta.value; onChange(); };
  card.body.appendChild(ta);
  return card.el;
}

/* ──────────────────────────── Step 2: Slots ──────────────────────────── */

function buildSlotSubCard(state, def, onChange) {
  const slot = state.slots[def.key];
  const card = subCard(`${def.emoji} ${def.zh}`, { badge: `{${def.key}}` });

  const modeRow = document.createElement('div');
  modeRow.className = 'flex flex-wrap gap-2 mb-3';
  const modes = [
    { id: 'off',    label: '不使用'    },
    { id: 'text',   label: '文字'      },
    { id: 'image',  label: '单图'      },
    { id: 'images', label: '多图'      },
  ];
  for (const m of modes) {
    const b = document.createElement('button');
    b.className = 'btn-mode';
    b.dataset.mode = m.id;
    b.textContent = m.label;
    if (m.id === slot.mode) b.classList.add('active');
    b.onclick = () => {
      slot.mode = m.id;
      modeRow.querySelectorAll('.btn-mode').forEach(x => x.classList.toggle('active', x.dataset.mode === m.id));
      renderBody();
      onChange();
    };
    modeRow.appendChild(b);
  }
  card.body.appendChild(modeRow);

  const body = document.createElement('div');
  body.dataset.role = 'slot-body';
  card.body.appendChild(body);

  function renderBody() {
    body.innerHTML = '';
    if (slot.mode === 'off') {
      body.innerHTML = '<p class="text-xs text-slate-400">不参与本次生成（占位符将被清空）</p>';
      return;
    }
    if (slot.mode === 'text') {
      const ta = document.createElement('textarea');
      ta.className = 'form-textarea';
      ta.rows = 2;
      ta.placeholder = def.placeholder;
      ta.value = slot.text;
      ta.oninput = () => { slot.text = ta.value; onChange(); };
      body.appendChild(ta);
      return;
    }
    // image / images
    const dz = imageDropzone({
      multiple: slot.mode === 'images',
      compact: true,
      initial: slot.images,
      onChange: files => { slot.images = files; onChange(); },
    });
    body.appendChild(dz.el);
  }
  renderBody();
  return card.el;
}

/* ──────────────────────────── Step 3: Run + Progress + Results ──────────────────────────── */

function buildRunStep(state, getEstimateBadge) {
  const step = stepFrame(3, '运行', '点击运行按钮开始生成；可随时停止。结果会按任务分组展示，每张图都标注来源。');

  // Run sub-card
  const runCard = subCard('启动');
  runCard.body.innerHTML = `
    <div class="flex flex-wrap gap-2 items-center">
      <button class="btn-primary" data-act="run">▶ 运行</button>
      <button class="btn-ghost text-red-600 hidden" data-act="stop">⏹ 停止</button>
      <span class="text-sm text-slate-500" data-role="estimate"></span>
    </div>
    <div class="mt-3 hidden" data-role="progress"></div>
  `;
  step.body.appendChild(runCard.el);

  // Results sub-card (hidden until first run)
  const resultsCard = subCard('结果');
  resultsCard.el.classList.add('hidden');
  const resultsBox = document.createElement('div');
  resultsBox.className = 'space-y-3';
  resultsCard.body.appendChild(resultsBox);
  step.body.appendChild(resultsCard.el);

  const runBtn = runCard.body.querySelector('[data-act=run]');
  const stopBtn = runCard.body.querySelector('[data-act=stop]');
  const estimateInline = runCard.body.querySelector('[data-role=estimate]');
  const progressBox = runCard.body.querySelector('[data-role=progress]');

  // Recompute estimate; updates both the inline label and the global-bar badge
  const refreshEstimate = () => {
    const badge = getEstimateBadge();
    let info, ok = true;
    try {
      const tasks = composeTasks(state);
      const total = tasks.length * (state.n || 1);
      info = { total, taskCount: tasks.length, perTask: state.n };
      runBtn.disabled = state.isRunning || total === 0;
    } catch (e) {
      ok = false;
      info = { error: e.message };
      runBtn.disabled = true;
    }
    if (ok) {
      const txt = `预计 ${info.total} 张（${info.taskCount} 个任务 × ${info.perTask} 张/任务）`;
      estimateInline.textContent = txt;
      estimateInline.classList.remove('text-red-600');
      if (badge) {
        badge.innerHTML = `<span class="sub-badge">≈ ${info.total} 张</span>`;
      }
    } else {
      estimateInline.textContent = '⚠ ' + info.error;
      estimateInline.classList.add('text-red-600');
      if (badge) badge.innerHTML = `<span class="sub-badge" style="background:#fee2e2;color:#b91c1c">⚠</span>`;
    }
  };

  runBtn.onclick = async () => {
    let tasks;
    try { tasks = composeTasks(state); }
    catch (e) { return toast(e.message, 'warn'); }
    if (!tasks.length) return toast('没有可执行的任务', 'warn');

    state.isRunning = true;
    state.aborter = new AbortController();
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner"></span> 运行中…';
    stopBtn.classList.remove('hidden');
    progressBox.classList.remove('hidden');
    resultsCard.el.classList.remove('hidden');
    resultsBox.innerHTML = '';

    stopBtn.onclick = () => {
      state.aborter?.abort();
      stopBtn.disabled = true;
      stopBtn.textContent = '已请求停止…';
    };

    const renderProgress = (s) => {
      const ok = s.results.filter(r => r.status === 'done').length;
      const err = s.results.filter(r => r.status === 'error').length;
      const run = s.results.filter(r => r.status === 'running').length;
      progressBox.innerHTML = `
        <div class="text-sm">完成 <b>${ok}</b> · 失败 <b class="text-red-600">${err}</b> · 进行中 <b>${run}</b> · 共 ${s.total}</div>
        <div class="w-full h-2 bg-slate-200 rounded mt-2 overflow-hidden">
          <div class="h-full bg-brand-500 transition-all" style="width:${(ok / s.total) * 100}%"></div>
        </div>`;
    };

    const allOutputs = [];
    try {
      const results = await runBatch(tasks, async (task, idx, signal) => {
        const opts = {
          prompt: task.prompt,
          size: state.size,
          n: state.n,
          aspectRatio: ratioOf(state.size),
        };
        let resp;
        if (task.referenceImages.length) {
          opts.images = task.referenceImages;
          resp = await API.editImage(opts, state.provider, { signal });
        } else {
          resp = await API.generateImage(opts, state.provider, { signal });
        }
        // CORS-tolerant URL → dataURL conversion (some provider CDNs block fetch)
        const dataURLs = await Promise.all((resp.images || []).map(async u => {
          if (typeof u !== 'string') return null;
          if (u.startsWith('data:')) return u;
          try { return await urlToDataURL(u); }
          catch { return u; /* fall back to raw URL — display still works, just no offline cache */ }
        }));
        return { ...resp, dataURLs: dataURLs.filter(Boolean) };
      }, { onUpdate: renderProgress, signal: state.aborter.signal });

      // Render result cards in the order tasks were composed
      results.forEach((r, i) => {
        const tcard = renderResultCard(r, i);
        // collect for history
        if (r.status === 'done' && r.result?.dataURLs?.length) {
          r.result.dataURLs.forEach((d, j) =>
            allOutputs.push({ name: timestampedName(`task${i + 1}-${j + 1}`), dataURL: d, mime: 'image/png' })
          );
        }
        resultsBox.appendChild(tcard);
      });

      // Persist to history
      await addHistory({
        id: uid(), kind: 'workflow', createdAt: Date.now(),
        prompt: state.promptTemplate || '[空模板]',
        model: '',
        provider: state.provider,
        inputs: collectInputs(state),
        outputs: allOutputs,
        params: {
          size: state.size, n: state.n, repeat: state.repeat,
          taskCount: tasks.length,
          slots: Object.fromEntries(Object.entries(state.slots).map(([k, v]) =>
            [k, { mode: v.mode, hasText: !!v.text, imageCount: v.images.length }]
          )),
        },
        note: state.note || '',
      });

      const okCount = results.filter(r => r.status === 'done').length;
      toast(
        `完成 ${okCount}/${results.length} ✅`,
        okCount === results.length ? 'success' : 'warn',
        4000
      );
    } catch (e) {
      toast(e.message, 'error', 5000);
    } finally {
      state.isRunning = false;
      state.aborter = null;
      runBtn.disabled = false;
      runBtn.textContent = '▶ 运行';
      stopBtn.classList.add('hidden');
      stopBtn.disabled = false;
      stopBtn.textContent = '⏹ 停止';
      refreshEstimate();
    }
  };

  return {
    el: step.el,
    render: refreshEstimate,
    destroy: () => { /* nothing background to clean up — estimate is event-driven */ },
  };
}

/* ──────────────────────────── Task composition ──────────────────────────── */

function composeTasks(state) {
  // 1) Slot values per slot
  const slotValues = {};
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if (slot.mode === 'off') {
      slotValues[def.key] = [{ kind: 'off' }];
    } else if (slot.mode === 'text') {
      slotValues[def.key] = [{ kind: 'text', text: (slot.text || '').trim() }];
    } else if (slot.mode === 'image') {
      slotValues[def.key] = slot.images.length
        ? [{ kind: 'image', image: slot.images[0].dataURL, name: slot.images[0].name }]
        : [{ kind: 'off' }];
    } else if (slot.mode === 'images') {
      slotValues[def.key] = slot.images.length
        ? slot.images.map(f => ({ kind: 'image', image: f.dataURL, name: f.name }))
        : [{ kind: 'off' }];
    }
  }

  // 2) Cartesian product across slots → combos[]
  let combos = [{}];
  for (const def of SLOTS) {
    const next = [];
    for (const c of combos) {
      for (const v of slotValues[def.key]) next.push({ ...c, [def.key]: v });
    }
    combos = next;
  }

  // 3) Prompt list (optional). If non-empty, replaces the template.
  const baseTpl = state.promptTemplate || '';
  const lines = (state.promptList || '').split('\n').map(s => s.trim()).filter(Boolean);
  const prompts = lines.length ? lines : [baseTpl];
  if (!prompts.length || (prompts.length === 1 && !prompts[0])) {
    throw new Error('请填写主 Prompt 模板（或在"提示词列表"里写至少一行）');
  }

  // 4) repeat
  const repeat = Math.max(1, state.repeat || 1);

  // 5) Build flat task list
  const tasks = [];
  for (const tpl of prompts) {
    for (const combo of combos) {
      for (let r = 0; r < repeat; r++) {
        tasks.push(buildTask(tpl, combo, r + 1));
      }
    }
  }
  return tasks;
}

function buildTask(promptTemplate, combo, variantIndex) {
  let prompt = promptTemplate;
  const refs = [];
  const sources = [];
  for (const def of SLOTS) {
    const v = combo[def.key];
    const ph = `{${def.key}}`;
    if (!v || v.kind === 'off') {
      // remove placeholder + any adjacent leading punctuation/space
      prompt = prompt.replace(new RegExp(`[，,、\\s]*${escapeRe(ph)}`, 'g'), '');
      continue;
    }
    if (v.kind === 'text') {
      prompt = prompt.replaceAll(ph, v.text || '');
      sources.push({ slot: def.key, kind: 'text', text: v.text });
    } else if (v.kind === 'image') {
      prompt = prompt.replaceAll(ph, `[参考${def.zh.replace(/\s/g, '')}图]`);
      refs.push(v.image);
      sources.push({ slot: def.key, kind: 'image', name: v.name });
    }
  }
  prompt = prompt.replace(/\s+/g, ' ').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim();
  return { prompt, referenceImages: refs, sources, variantIndex };
}

/* ──────────────────────────── Result rendering ──────────────────────────── */

function renderResultCard(r, idx) {
  const card = document.createElement('div');
  card.className = 'result-card ' + (r.status === 'error' ? 'error' : (r.status === 'done' ? 'done' : ''));

  // Header: index + status + prompt preview + sources tags
  const head = document.createElement('div');
  head.className = 'flex items-start justify-between gap-3 mb-2';
  head.innerHTML = `
    <div class="text-sm flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="font-medium text-slate-700">#${idx + 1}</span>
        ${r.status === 'error' ? '<span class="text-red-600 text-xs">失败</span>' :
          r.status === 'done'  ? '<span class="text-emerald-600 text-xs">✓ 已完成</span>' :
                                 '<span class="text-slate-400 text-xs">…</span>'}
        ${r.item.variantIndex && r.item.variantIndex > 1 ? `<span class="text-xs text-slate-400">· 变体 ${r.item.variantIndex}</span>` : ''}
      </div>
      <div class="text-xs text-slate-500 mt-1 line-clamp-2" title="${esc(r.item.prompt)}">${esc(r.item.prompt.slice(0, 240))}${r.item.prompt.length > 240 ? '…' : ''}</div>
    </div>
    <button class="btn-ghost text-xs flex-shrink-0" data-act="copy-prompt">复制 prompt</button>
  `;
  head.querySelector('[data-act=copy-prompt]').onclick = () => copyText(r.item.prompt);
  card.appendChild(head);

  // Sources tags
  if (r.item.sources?.length) {
    const tags = document.createElement('div');
    tags.className = 'flex flex-wrap gap-1 mb-2';
    for (const s of r.item.sources) {
      const t = document.createElement('span');
      t.className = 'tag ' + s.kind;
      t.textContent = `${slotZh(s.slot)}: ${s.kind === 'text' ? (s.text?.slice(0, 24) || '空') : (s.name || '图')}`;
      tags.appendChild(t);
    }
    card.appendChild(tags);
  }

  if (r.status === 'done' && r.result?.dataURLs?.length) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2';
    r.result.dataURLs.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'img-card bg-white rounded-md border border-slate-200 p-1';
      cell.innerHTML = `
        <img src="${src}" class="w-full rounded cursor-zoom-in" />
        <div class="flex justify-between mt-1 text-xs">
          <span class="text-slate-400">${esc(r.result.provider || '')}</span>
          <button class="btn-ghost" data-act="dl">下载</button>
        </div>
      `;
      cell.querySelector('img').onclick = () => previewImage(src);
      cell.querySelector('[data-act=dl]').onclick = () =>
        download(timestampedName(`task${idx + 1}-${i + 1}`), src);
      grid.appendChild(cell);
    });
    card.appendChild(grid);
  } else if (r.status === 'error') {
    const err = document.createElement('div');
    err.className = 'text-red-600 text-xs whitespace-pre-wrap mt-1';
    err.textContent = r.error;
    card.appendChild(err);
  }
  return card;
}

/* ──────────────────────────── Helpers ──────────────────────────── */

function slotZh(key) {
  return SLOTS.find(s => s.key === key)?.zh || key;
}

function ratioOf(size) {
  return SIZES.find(s => s.value === size)?.ratio || '1:1';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectInputs(state) {
  const inputs = [];
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if ((slot.mode === 'image' || slot.mode === 'images') && slot.images.length) {
      slot.images.forEach((f, i) => inputs.push({ name: `${def.key}-${i + 1}-${f.name}`, dataURL: f.dataURL }));
    }
  }
  state.reverseImages.forEach((f, i) =>
    inputs.push({ name: `ref-${i + 1}-${f.name}`, dataURL: f.dataURL })
  );
  return inputs;
}
