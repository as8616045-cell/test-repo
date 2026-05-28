// pages/workflow.js — 统一工作流页面（v3）
//
// 关键改进：
//   - 主 Prompt 输入框做大（rows=8 + min-height）
//   - 改写润色支持独立的 chat 服务商（含 DeepSeek）
//   - 生成参数：分辨率（1K/2K/4K）+ 比例（含横/竖标注）+ 张数按钮组（默认 4）
//   - 每个槽位有自己的"指令"输入框，让模型明确知道这个槽位是干嘛的
//   - 槽位的指令支持 @图片N 引用语法，点击 chip 自动插入

import { esc, toast, uid, urlToDataURL, timestampedName, copyText, download } from '../utils.js';
import { stepFrame, subCard, endpointSelect, imageDropzone, previewImage } from '../components.js';
import { runBatch } from '../batch.js';
import { addHistory } from '../storage.js';
import * as API from '../api/index.js';
import { loadSettings } from '../settings.js';

/* ──────────────────────────── Constants ──────────────────────────── */

const SLOTS = [
  {
    key: 'model', zh: '模特', emoji: '👤',
    placeholder: '一位 30 岁亚洲女性，长发，自然妆容',
    defaultInstruction: '保持这位模特的脸部、体型与气质完全一致，不要更改其外观。',
  },
  {
    key: 'outfit', zh: '服装 / 产品', emoji: '👗',
    placeholder: '白色丝绸连衣裙',
    defaultInstruction: '让模特展示这件产品，保留产品的颜色、形状、材质准确性。',
  },
  {
    key: 'scene', zh: '场景 / 背景', emoji: '🌆',
    placeholder: '海边日落沙滩，电影感光影',
    defaultInstruction: '将主体放置在该场景中，光影协调、电商级摄影质感。',
  },
];

const QUALITIES = [
  { id: '1k', label: '1K', shortSide: 1024, hint: '所有服务商支持' },
  { id: '2k', label: '2K', shortSide: 2048, hint: '部分服务商支持' },
  { id: '4k', label: '4K', shortSide: 4096, hint: '仅少数服务商支持' },
];

const RATIOS = [
  { id: '1:1',  w: 1,  h: 1,  orient: 'square',    note: '方形' },
  { id: '16:9', w: 16, h: 9,  orient: 'landscape', note: '横屏 · 影视' },
  { id: '9:16', w: 9,  h: 16, orient: 'portrait',  note: '竖屏 · 短视频 / 手机' },
  { id: '4:3',  w: 4,  h: 3,  orient: 'landscape', note: '横屏 · 经典' },
  { id: '3:4',  w: 3,  h: 4,  orient: 'portrait',  note: '竖屏 · 经典' },
  { id: '3:2',  w: 3,  h: 2,  orient: 'landscape', note: '横屏 · 摄影' },
  { id: '2:3',  w: 2,  h: 3,  orient: 'portrait',  note: '竖屏 · 摄影' },
  { id: '21:9', w: 21, h: 9,  orient: 'landscape', note: '横屏 · 超宽' },
];

const N_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
const DEFAULT_N = 4;

/* ──────────────────────────── Page entry ──────────────────────────── */

export async function render(host) {
  const settings = loadSettings();
  const state = {
    // generation params
    // override 端点（仅本次会话有效，不写回 settings.capabilities）
    imageEndpointId:   settings.capabilities.image?.endpointId   || '',
    chatEndpointId:    settings.capabilities.chat?.endpointId    || '',
    visionEndpointId:  settings.capabilities.vision?.endpointId  || '',
    quality: '1k',
    ratio: '1:1',
    n: DEFAULT_N,
    repeat: 1,
    note: '',
    // step 1
    promptTemplate: '',
    promptList: '',
    reverseImages: [],
    lastPromptBeforeRewrite: null,
    // step 2: each slot has mode/text/images/instruction
    slots: Object.fromEntries(SLOTS.map(s => [s.key, {
      mode: 'off', text: '', images: [],
      instruction: s.defaultInstruction,
    }])),
    // run
    aborter: null,
    isRunning: false,
  };

  const onChangeListeners = [];
  const notifyChange = () => onChangeListeners.forEach(fn => { try { fn(); } catch {} });

  host.innerHTML = `
    <h1 class="text-2xl font-bold mb-1">🎨 工作流</h1>
    <p class="text-slate-500 mb-5">在一个页面内组合：反推 / 文生图 / 图生图 / 一致性 / 换 X / 批量。</p>
  `;

  // ─── Step 1: Prompt
  const step1 = stepFrame(1, '主 Prompt', '可用占位符 {model} {outfit} {scene} 引用下方槽位。');
  step1.body.appendChild(buildPromptSubCard(state, notifyChange));
  step1.body.appendChild(buildReverseSubCard(state, notifyChange));
  step1.body.appendChild(buildPromptListSubCard(state, notifyChange));
  host.appendChild(step1.el);

  // ─── Step 2: Slots
  const step2 = stepFrame(2, '元素槽位', '每个槽位有自己的"指令"，告诉模型这个槽位的图/文是干嘛用的。');
  for (const def of SLOTS) {
    step2.body.appendChild(buildSlotSubCard(state, def, notifyChange));
  }
  host.appendChild(step2.el);

  // ─── Step 3: Generation (params + run + results)
  const { el: step3el, render: refreshEstimate } = buildGenerationStep(state);
  host.appendChild(step3el);
  onChangeListeners.push(refreshEstimate);

  notifyChange();

  return () => {
    try { state.aborter?.abort(); } catch {}
  };
}

/* ──────────────────────────── Step 1: Prompt sub-cards ──────────────────────────── */

function buildPromptSubCard(state, onChange) {
  const card = subCard('Prompt 模板', {
    hint: '使用 {model} {outfit} {scene} 引用槽位；图片型槽位会自动作为参考图传入 API。',
  });

  // The big textarea ✨
  const ta = document.createElement('textarea');
  ta.className = 'form-textarea prompt-main';
  ta.rows = 8;
  ta.placeholder = '例：{model} 穿着 {outfit}，置身于 {scene}，电影感光影，专业摄影';
  ta.value = state.promptTemplate;
  ta.oninput = () => { state.promptTemplate = ta.value; onChange(); };
  card.body.appendChild(ta);

  // Rewrite row: button + endpoint selector + status
  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap gap-2 items-center mt-3';
  const provSel = endpointSelect('chat');
  provSel.style.maxWidth = '260px';
  if (state.chatEndpointId) provSel.value = state.chatEndpointId;
  provSel.onchange = () => state.chatEndpointId = provSel.value;
  actions.innerHTML = `
    <button class="btn-primary" data-act="rewrite">✨ LLM 改写润色</button>
    <span class="text-xs text-slate-500">用：</span>
  `;
  actions.appendChild(provSel);
  const undoBtn = document.createElement('button');
  undoBtn.className = 'btn-ghost hidden';
  undoBtn.dataset.act = 'undo';
  undoBtn.textContent = '↩ 撤销改写';
  actions.appendChild(undoBtn);
  const hint = document.createElement('span');
  hint.className = 'text-xs text-slate-400';
  actions.appendChild(hint);

  const rewriteBtn = actions.querySelector('[data-act=rewrite]');
  rewriteBtn.onclick = async () => {
    if (!ta.value.trim()) return toast('请先输入 prompt', 'warn');
    rewriteBtn.disabled = true;
    rewriteBtn.innerHTML = '<span class="spinner"></span> 改写中…';
    hint.textContent = '';
    try {
      state.lastPromptBeforeRewrite = ta.value;
      const { provider, text } = await API.rewritePrompt(ta.value, { endpointId: state.chatEndpointId });
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
    multiple: true, compact: true,
    onChange: files => { state.reverseImages = files; },
  });
  card.body.appendChild(dz.el);

  const row = document.createElement('div');
  row.className = 'flex flex-wrap gap-2 items-center mt-3';
  const provSel = endpointSelect('vision');
  provSel.style.maxWidth = '260px';
  if (state.visionEndpointId) provSel.value = state.visionEndpointId;
  provSel.onchange = () => state.visionEndpointId = provSel.value;
  row.innerHTML = `
    <button class="btn-primary" data-act="run">反推 → 替换</button>
    <button class="btn-ghost" data-act="append">反推 → 追加</button>
    <span class="text-xs text-slate-500">用：</span>
  `;
  row.appendChild(provSel);
  const status = document.createElement('span');
  status.className = 'text-xs text-slate-400';
  row.appendChild(status);

  const runBtn = row.querySelector('[data-act=run]');
  const appendBtn = row.querySelector('[data-act=append]');
  async function doReverse(append) {
    if (!state.reverseImages.length) return toast('请先上传参考图', 'warn');
    [runBtn, appendBtn].forEach(b => b.disabled = true);
    runBtn.innerHTML = '<span class="spinner"></span> 分析中…';
    status.textContent = '';
    try {
      const { provider, text } = await API.reverseImage(
        state.reverseImages.map(f => f.dataURL), null, { endpointId: provSel.value },
      );
      const ta = document.querySelector('textarea.prompt-main');
      if (ta) {
        ta.value = append && ta.value.trim() ? (ta.value + '\n' + text) : text;
        state.promptTemplate = ta.value;
        ta.dispatchEvent(new Event('input'));
      }
      status.textContent = `由 ${provider} 反推`;
      toast('已反推 ✅', 'success');
      onChange();
    } catch (e) {
      toast(e.message, 'error', 5000);
      status.textContent = '失败';
    } finally {
      [runBtn, appendBtn].forEach(b => b.disabled = false);
      runBtn.textContent = '反推 → 替换';
    }
  }
  runBtn.onclick = () => doReverse(false);
  appendBtn.onclick = () => doReverse(true);
  card.body.appendChild(row);
  return card.el;
}

function buildPromptListSubCard(state, onChange) {
  const card = subCard('提示词列表（可选）', {
    hint: '每行一个 prompt。如非空，将用列表中的每行替代上方主模板。',
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

  // Mode toggle — 默认即"不使用"（state.mode='off'），用户点击三个按钮中的一个来启用，
  // 再次点击当前选中按钮即取消（回到不使用）。
  const modeRow = document.createElement('div');
  modeRow.className = 'flex flex-wrap items-center gap-2 mb-3';
  const modeHint = document.createElement('span');
  modeHint.className = 'text-xs text-slate-400 mr-1';
  modeHint.textContent = '使用方式：';
  modeRow.appendChild(modeHint);
  const modes = [
    { id: 'text',   label: '文字' },
    { id: 'image',  label: '单图' },
    { id: 'images', label: '多图' },
  ];
  for (const m of modes) {
    const b = document.createElement('button');
    b.className = 'btn-mode';
    b.dataset.mode = m.id;
    b.textContent = m.label;
    if (m.id === slot.mode) b.classList.add('active');
    b.onclick = () => {
      // 再次点击已激活按钮 → 取消（回到 off）
      const next = (slot.mode === m.id) ? 'off' : m.id;
      slot.mode = next;
      modeRow.querySelectorAll('.btn-mode').forEach(x =>
        x.classList.toggle('active', x.dataset.mode === next));
      updateOffTag();
      renderBody();
      renderInstruction();
      onChange();
    };
    modeRow.appendChild(b);
  }
  // small "off" status indicator (visible only when not selected)
  const offTag = document.createElement('span');
  offTag.className = 'text-xs text-slate-400 ml-auto';
  offTag.textContent = '未启用 · 不参与生成';
  modeRow.appendChild(offTag);
  const updateOffTag = () => offTag.style.display = (slot.mode === 'off') ? '' : 'none';
  updateOffTag();
  card.body.appendChild(modeRow);

  // Instruction textarea (always visible — works for all modes)
  const instrWrap = document.createElement('div');
  instrWrap.className = 'mb-3';
  const instrLabel = document.createElement('div');
  instrLabel.className = 'flex items-center justify-between mb-1';
  instrLabel.innerHTML = `
    <label class="text-xs font-medium text-slate-600">指令（告诉模型这个槽位的用途）</label>
    <button class="text-xs text-brand-600 hover:underline" data-act="reset-instr">恢复默认</button>
  `;
  instrWrap.appendChild(instrLabel);

  // @图片N chips host (only shown when has images)
  const chipsHost = document.createElement('div');
  chipsHost.className = 'flex flex-wrap gap-1 mb-1.5';
  instrWrap.appendChild(chipsHost);

  const instr = document.createElement('textarea');
  instr.className = 'form-textarea';
  instr.rows = 3;
  instr.placeholder = '例：' + def.defaultInstruction;
  instr.value = slot.instruction;
  instr.oninput = () => { slot.instruction = instr.value; onChange(); };
  instrWrap.appendChild(instr);

  instrLabel.querySelector('[data-act=reset-instr]').onclick = () => {
    instr.value = def.defaultInstruction;
    slot.instruction = def.defaultInstruction;
    onChange();
  };

  card.body.appendChild(instrWrap);

  function renderInstruction() {
    // Show @图片N chips when slot has images and is not in text-only mode
    chipsHost.innerHTML = '';
    if ((slot.mode === 'image' || slot.mode === 'images') && slot.images.length) {
      const tip = document.createElement('span');
      tip.className = 'text-xs text-slate-400 mr-1';
      tip.textContent = '可引用：';
      chipsHost.appendChild(tip);
      slot.images.forEach((f, i) => {
        const chip = document.createElement('button');
        chip.className = 'chip-ref';
        chip.title = f.name || `图 ${i + 1}`;
        chip.textContent = `@图片${i + 1}`;
        chip.onclick = () => {
          // Insert at current cursor position
          const start = instr.selectionStart ?? instr.value.length;
          const end = instr.selectionEnd ?? instr.value.length;
          const token = `@图片${i + 1}`;
          instr.value = instr.value.slice(0, start) + token + instr.value.slice(end);
          slot.instruction = instr.value;
          instr.focus();
          const pos = start + token.length;
          instr.setSelectionRange(pos, pos);
          onChange();
        };
        chipsHost.appendChild(chip);
      });
    }
  }

  // Body (text input or image dropzone)
  const body = document.createElement('div');
  card.body.appendChild(body);

  function renderBody() {
    body.innerHTML = '';
    if (slot.mode === 'off') {
      body.innerHTML = '<p class="text-xs text-slate-400">不参与本次生成（占位符将被清空，指令也不发送）</p>';
      return;
    }
    if (slot.mode === 'text') {
      const ta = document.createElement('textarea');
      ta.className = 'form-textarea';
      ta.rows = 3;
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
      onChange: files => { slot.images = files; renderInstruction(); onChange(); },
    });
    body.appendChild(dz.el);
  }

  renderBody();
  renderInstruction();
  return card.el;
}

/* ──────────────────────────── Step 3: Generation params + Run + Results ──────────────────────────── */

function buildGenerationStep(state) {
  const step = stepFrame(3, '生成', '配置参数 → 启动 → 查看结果。');

  // ── Params sub-card
  const paramsCard = subCard('生成参数');
  const paramsBody = paramsCard.body;

  // Endpoint (image)
  const provFieldWrap = document.createElement('div');
  provFieldWrap.innerHTML = `<label class="form-label">端点（生图 / 编辑）</label>`;
  const provSel = endpointSelect('image');
  if (state.imageEndpointId) provSel.value = state.imageEndpointId;
  provSel.onchange = () => {
    state.imageEndpointId = provSel.value;
    // 工作流的端点切换是临时覆盖，不写回 settings.capabilities
    // （要长期改默认端点请去「设置」→「能力指派」）
  };
  provFieldWrap.appendChild(provSel);
  paramsBody.appendChild(provFieldWrap);

  // Quality (1K / 2K / 4K)
  const qualityField = document.createElement('div');
  qualityField.className = 'mt-3';
  qualityField.innerHTML = `<label class="form-label">分辨率</label>`;
  const qualityGroup = document.createElement('div');
  qualityGroup.className = 'btn-group';
  for (const q of QUALITIES) {
    const b = document.createElement('button');
    b.className = 'btn-mode';
    b.dataset.q = q.id;
    b.innerHTML = `<b>${q.label}</b><span class="ml-1 text-[11px] opacity-70">${q.shortSide}px</span>`;
    if (q.id === state.quality) b.classList.add('active');
    b.onclick = () => {
      state.quality = q.id;
      qualityGroup.querySelectorAll('.btn-mode').forEach(x =>
        x.classList.toggle('active', x.dataset.q === q.id));
      qualityHint.textContent = q.hint;
      sizePreview.textContent = `→ ${computeSize(state.quality, state.ratio).size}`;
    };
    qualityGroup.appendChild(b);
  }
  qualityField.appendChild(qualityGroup);
  const qualityHint = document.createElement('p');
  qualityHint.className = 'text-xs text-slate-500 mt-1';
  qualityHint.textContent = QUALITIES.find(q => q.id === state.quality)?.hint || '';
  qualityField.appendChild(qualityHint);
  paramsBody.appendChild(qualityField);

  // Ratio dropdown with orient labels
  const ratioField = document.createElement('div');
  ratioField.className = 'mt-3';
  ratioField.innerHTML = `<label class="form-label">比例</label>`;
  const ratioSel = document.createElement('select');
  ratioSel.className = 'form-input';
  for (const r of RATIOS) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = `${r.id}    —    ${r.note}`;
    if (r.id === state.ratio) o.selected = true;
    ratioSel.appendChild(o);
  }
  ratioSel.onchange = () => {
    state.ratio = ratioSel.value;
    sizePreview.textContent = `→ ${computeSize(state.quality, state.ratio).size}`;
  };
  ratioField.appendChild(ratioSel);
  const sizePreview = document.createElement('p');
  sizePreview.className = 'text-xs text-slate-500 mt-1 font-mono';
  sizePreview.textContent = `→ ${computeSize(state.quality, state.ratio).size}`;
  ratioField.appendChild(sizePreview);
  paramsBody.appendChild(ratioField);

  // n (per-task images) button group, default 4, plus custom input
  const nField = document.createElement('div');
  nField.className = 'mt-3';
  nField.innerHTML = `<label class="form-label">每个任务出几张</label>`;
  const nRow = document.createElement('div');
  nRow.className = 'flex flex-wrap items-center gap-2';
  const nGroup = document.createElement('div');
  nGroup.className = 'btn-group';
  for (const n of N_CHOICES) {
    const b = document.createElement('button');
    b.className = 'btn-mode';
    b.dataset.n = n;
    b.textContent = String(n);
    if (n === state.n) b.classList.add('active');
    b.onclick = () => {
      state.n = n;
      nGroup.querySelectorAll('.btn-mode').forEach(x =>
        x.classList.toggle('active', +x.dataset.n === n));
      nCustom.value = '';
      nCustom.classList.remove('active-custom');
    };
    nGroup.appendChild(b);
  }
  nRow.appendChild(nGroup);

  // Custom n input
  const nCustomWrap = document.createElement('label');
  nCustomWrap.className = 'flex items-center gap-1.5 text-sm text-slate-600 ml-2';
  nCustomWrap.innerHTML = '<span>自定义：</span>';
  const nCustom = document.createElement('input');
  nCustom.type = 'number';
  nCustom.min = '1';
  nCustom.max = '50';
  nCustom.placeholder = '任意数';
  nCustom.className = 'form-input n-custom';
  nCustom.style.maxWidth = '90px';
  nCustom.oninput = () => {
    const v = +nCustom.value;
    if (v >= 1 && v <= 50) {
      state.n = v;
      nGroup.querySelectorAll('.btn-mode').forEach(x => x.classList.remove('active'));
      nCustom.classList.add('active-custom');
    }
  };
  nCustomWrap.appendChild(nCustom);
  nRow.appendChild(nCustomWrap);
  nField.appendChild(nRow);

  const nHint = document.createElement('p');
  nHint.className = 'text-xs text-slate-500 mt-1';
  nHint.textContent = '默认 4 张。1–8 直接点选，更多请填"自定义"。注：部分服务商单次最多返回 1 张，超出会自动循环调用。';
  nField.appendChild(nHint);
  paramsBody.appendChild(nField);

  // repeat + note (small inline row)
  const lastRow = document.createElement('div');
  lastRow.className = 'mt-3 grid grid-cols-2 gap-3';
  lastRow.innerHTML = `
    <div>
      <label class="form-label">重复次数</label>
      <input type="number" min="1" max="20" class="form-input" value="${state.repeat}" data-role="repeat" />
      <p class="text-xs text-slate-500 mt-1">同一组合跑 N 遍以挑选最佳变体。</p>
    </div>
    <div>
      <label class="form-label">备注（可选）</label>
      <input type="text" class="form-input" placeholder="方便回看" value="${esc(state.note)}" data-role="note" />
    </div>
  `;
  lastRow.querySelector('[data-role=repeat]').onchange = e => {
    state.repeat = clamp(+e.target.value || 1, 1, 20);
    e.target.value = state.repeat;
  };
  lastRow.querySelector('[data-role=note]').oninput = e => state.note = e.target.value;
  paramsBody.appendChild(lastRow);

  step.body.appendChild(paramsCard.el);

  // ── Run sub-card
  const runCard = subCard('启动');
  runCard.body.innerHTML = `
    <div class="flex flex-wrap gap-2 items-center">
      <button class="btn-primary" data-act="run">▶ 运行</button>
      <button class="btn-ghost text-red-600 hidden" data-act="stop">⏹ 停止</button>
      <span class="sub-badge ml-1" data-role="estimate"></span>
    </div>
    <div class="mt-3 hidden" data-role="progress"></div>
  `;
  step.body.appendChild(runCard.el);

  // ── Results sub-card (hidden until first run)
  const resultsCard = subCard('结果');
  resultsCard.el.classList.add('hidden');
  const resultsBox = document.createElement('div');
  resultsBox.className = 'space-y-3';
  resultsCard.body.appendChild(resultsBox);
  step.body.appendChild(resultsCard.el);

  const runBtn = runCard.body.querySelector('[data-act=run]');
  const stopBtn = runCard.body.querySelector('[data-act=stop]');
  const estimate = runCard.body.querySelector('[data-role=estimate]');
  const progressBox = runCard.body.querySelector('[data-role=progress]');

  const refreshEstimate = () => {
    try {
      const tasks = composeTasks(state);
      const total = tasks.length * (state.n || 1);
      estimate.textContent = `≈ ${total} 张（${tasks.length} 任务 × ${state.n} 张）`;
      estimate.style.background = '';
      estimate.style.color = '';
      runBtn.disabled = state.isRunning || total === 0;
    } catch (e) {
      estimate.textContent = '⚠ ' + e.message;
      estimate.style.background = '#fee2e2';
      estimate.style.color = '#b91c1c';
      runBtn.disabled = true;
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
      const sizeStr = computeSize(state.quality, state.ratio).size;
      const results = await runBatch(tasks, async (task, idx, signal) => {
        const opts = {
          prompt: task.prompt,
          size: sizeStr,
          n: state.n,
          aspectRatio: state.ratio,
        };
        let resp;
        if (task.referenceImages.length) {
          opts.images = task.referenceImages;
          resp = await API.editImage(opts, { endpointId: state.imageEndpointId }, { signal });
        } else {
          resp = await API.generateImage(opts, { endpointId: state.imageEndpointId }, { signal });
        }
        const dataURLs = await Promise.all((resp.images || []).map(async u => {
          if (typeof u !== 'string') return null;
          if (u.startsWith('data:')) return u;
          try { return await urlToDataURL(u); }
          catch { return u; }
        }));
        return { ...resp, dataURLs: dataURLs.filter(Boolean) };
      }, { onUpdate: renderProgress, signal: state.aborter.signal });

      results.forEach((r, i) => {
        const tcard = renderResultCard(r, i);
        if (r.status === 'done' && r.result?.dataURLs?.length) {
          r.result.dataURLs.forEach((d, j) =>
            allOutputs.push({
              name: timestampedName(`task${i + 1}-${j + 1}`),
              dataURL: d, mime: 'image/png',
            })
          );
        }
        resultsBox.appendChild(tcard);
      });

      await addHistory({
        id: uid(), kind: 'workflow', createdAt: Date.now(),
        prompt: state.promptTemplate || '[空模板]',
        model: '',
        provider: state.imageEndpointId,
        inputs: collectInputs(state),
        outputs: allOutputs,
        params: {
          quality: state.quality, ratio: state.ratio, size: sizeStr,
          n: state.n, repeat: state.repeat, taskCount: tasks.length,
          slots: Object.fromEntries(Object.entries(state.slots).map(([k, v]) =>
            [k, { mode: v.mode, hasText: !!v.text, imageCount: v.images.length, hasInstruction: !!v.instruction }]
          )),
        },
        note: state.note || '',
      });

      const okCount = results.filter(r => r.status === 'done').length;
      toast(`完成 ${okCount}/${results.length} ✅`,
        okCount === results.length ? 'success' : 'warn', 4000);
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

  return { el: step.el, render: refreshEstimate };
}

/* ──────────────────────────── Task composition ──────────────────────────── */

function composeTasks(state) {
  // 1) Slot values per slot (cartesian source)
  const slotValues = {};
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if (slot.mode === 'off') {
      slotValues[def.key] = [{ kind: 'off' }];
    } else if (slot.mode === 'text') {
      slotValues[def.key] = [{ kind: 'text', text: (slot.text || '').trim() }];
    } else if (slot.mode === 'image') {
      slotValues[def.key] = slot.images.length
        ? [{ kind: 'image', image: slot.images[0].dataURL, name: slot.images[0].name, idx: 1 }]
        : [{ kind: 'off' }];
    } else if (slot.mode === 'images') {
      slotValues[def.key] = slot.images.length
        ? slot.images.map((f, i) => ({ kind: 'image', image: f.dataURL, name: f.name, idx: i + 1 }))
        : [{ kind: 'off' }];
    }
  }

  // 2) Cartesian product across slots
  let combos = [{}];
  for (const def of SLOTS) {
    const next = [];
    for (const c of combos) {
      for (const v of slotValues[def.key]) next.push({ ...c, [def.key]: v });
    }
    combos = next;
  }

  // 3) Prompt list (optional, replaces template)
  const baseTpl = state.promptTemplate || '';
  const lines = (state.promptList || '').split('\n').map(s => s.trim()).filter(Boolean);
  const prompts = lines.length ? lines : [baseTpl];
  // Validation: at least the template OR some slot instruction must be present
  const anyInstruction = SLOTS.some(s => state.slots[s.key].mode !== 'off' && state.slots[s.key].instruction?.trim());
  const hasPrompt = prompts.some(p => p && p.trim());
  if (!hasPrompt && !anyInstruction) {
    throw new Error('请填写主 Prompt 模板，或在槽位指令里说明');
  }

  // 4) repeat
  const repeat = Math.max(1, state.repeat || 1);

  // 5) Build flat task list
  const tasks = [];
  for (const tpl of prompts) {
    for (const combo of combos) {
      for (let r = 0; r < repeat; r++) {
        tasks.push(buildTask(tpl, combo, state, r + 1));
      }
    }
  }
  return tasks;
}

function buildTask(promptTemplate, combo, state, variantIndex) {
  let prompt = promptTemplate || '';
  const refs = [];      // task reference images, ordered
  const refKeys = new Set();   // dedupe by dataURL
  const sources = [];

  // 1) substitute {slotKey} placeholders using cartesian-picked value
  for (const def of SLOTS) {
    const v = combo[def.key];
    const ph = `{${def.key}}`;
    if (!v || v.kind === 'off') {
      // remove placeholder + any leading punctuation/space that becomes orphaned
      prompt = prompt.replace(new RegExp(`[，,、\\s]*${escapeRe(ph)}`, 'g'), '');
      continue;
    }
    if (v.kind === 'text') {
      prompt = prompt.replaceAll(ph, v.text || '');
      if (v.text) sources.push({ slot: def.key, kind: 'text', text: v.text });
    } else if (v.kind === 'image') {
      prompt = prompt.replaceAll(ph, `[参考${def.zh.replace(/\s/g, '')}图]`);
      if (!refKeys.has(v.image)) {
        refs.push(v.image);
        refKeys.add(v.image);
      }
      sources.push({ slot: def.key, kind: 'image', name: v.name });
    }
  }

  // 2) Append slot instructions (with @图片N substitution)
  const instrPieces = [];
  for (const def of SLOTS) {
    const slot = state.slots[def.key];
    if (slot.mode === 'off') continue;
    let instr = (slot.instruction || '').trim();
    if (!instr) continue;
    // Replace @图片N occurrences within this slot's instruction
    instr = instr.replace(/@图片(\d+)/g, (m, nStr) => {
      const n = +nStr;
      const img = slot.images[n - 1];
      if (!img) return m; // leave as-is if out of range
      if (!refKeys.has(img.dataURL)) {
        refs.push(img.dataURL);
        refKeys.add(img.dataURL);
        sources.push({ slot: def.key, kind: 'image', name: img.name, ref: `图片${n}` });
      }
      return `[第 ${n} 张参考图：${def.zh.replace(/\s/g, '')} ${img.name}]`;
    });
    instrPieces.push(instr);
  }

  // 3) Assemble final prompt
  prompt = prompt.replace(/\s+/g, ' ').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim();
  let finalPrompt = prompt;
  if (instrPieces.length) {
    finalPrompt = (finalPrompt ? finalPrompt + ' ' : '') + instrPieces.join(' ');
  }

  return { prompt: finalPrompt, referenceImages: refs, sources, variantIndex };
}

/* ──────────────────────────── Result rendering ──────────────────────────── */

function renderResultCard(r, idx) {
  const card = document.createElement('div');
  card.className = 'result-card ' +
    (r.status === 'error' ? 'error' : (r.status === 'done' ? 'done' : ''));

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

  if (r.item.sources?.length) {
    const tags = document.createElement('div');
    tags.className = 'flex flex-wrap gap-1 mb-2';
    for (const s of r.item.sources) {
      const t = document.createElement('span');
      t.className = 'tag ' + s.kind;
      const refMark = s.ref ? ` (${s.ref})` : '';
      t.textContent = `${slotZh(s.slot)}: ${s.kind === 'text' ? (s.text?.slice(0, 24) || '空') : (s.name || '图')}${refMark}`;
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

function computeSize(qualityId, ratioId) {
  const q = QUALITIES.find(x => x.id === qualityId) || QUALITIES[0];
  const r = RATIOS.find(x => x.id === ratioId) || RATIOS[0];
  let w, h;
  if (r.w >= r.h) { h = q.shortSide; w = Math.round(q.shortSide * r.w / r.h); }
  else            { w = q.shortSide; h = Math.round(q.shortSide * r.h / r.w); }
  // round to multiple of 8 for compatibility
  w = Math.round(w / 8) * 8;
  h = Math.round(h / 8) * 8;
  return { w, h, size: `${w}x${h}` };
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
      slot.images.forEach((f, i) =>
        inputs.push({ name: `${def.key}-${i + 1}-${f.name}`, dataURL: f.dataURL }));
    }
  }
  state.reverseImages.forEach((f, i) =>
    inputs.push({ name: `ref-${i + 1}-${f.name}`, dataURL: f.dataURL }));
  return inputs;
}
