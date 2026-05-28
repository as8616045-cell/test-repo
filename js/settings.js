// js/settings.js — v4: endpoints + capabilities 数据结构
//
// v4 schema:
//   {
//     endpoints: [
//       { id, name, baseURL, apiKey, protocol: 'auto'|'openai'|'gemini'|'fal' },
//       ...
//     ],
//     capabilities: {
//       vision: { endpointId, model },
//       chat:   { endpointId, model },
//       image:  { endpointId, model },
//       edit:   { endpointId, model },
//       video:  { endpointId, model },
//     },
//     concurrency, corsProxy,
//   }
//
// 自动从 v3 / v2 / v1 迁移已填的 Key。

const STORAGE_KEY = 'ai-studio:settings:v4';
const OLD_KEYS = ['ai-studio:settings:v3', 'ai-studio:settings:v2', 'ai-studio:settings:v1'];

/** 6 个预设端点 —— 首次进入 / 重置时自动塞入 */
export const PRESET_ENDPOINTS = [
  { id: 'volcengine',  name: '火山方舟（即梦4.0/豆包视觉/Seedance）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', protocol: 'auto' },
  { id: 'openai',      name: 'OpenAI 官方',
    baseURL: 'https://api.openai.com', apiKey: '', protocol: 'auto' },
  { id: 'gemini',      name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta', apiKey: '', protocol: 'auto' },
  { id: 'deepseek',    name: 'DeepSeek（仅文本）',
    baseURL: 'https://api.deepseek.com', apiKey: '', protocol: 'auto' },
  { id: 'siliconflow', name: '硅基流动（聚合）',
    baseURL: 'https://api.siliconflow.cn', apiKey: '', protocol: 'auto' },
  { id: 'fal',         name: 'fal.ai',
    baseURL: 'https://queue.fal.run', apiKey: '', protocol: 'auto' },
];

/** 默认能力指派 —— 都先指到火山方舟（国内可直连） */
export const DEFAULT_CAPABILITIES = {
  vision: { endpointId: 'volcengine', model: 'doubao-seed-1-6-vision-250815' },
  chat:   { endpointId: 'volcengine', model: 'doubao-seed-1-6-vision-250815' },
  image:  { endpointId: 'volcengine', model: 'doubao-seedream-4-0-250828' },
  edit:   { endpointId: 'volcengine', model: 'doubao-seedream-4-0-250828' },
  video:  { endpointId: 'volcengine', model: 'doubao-seedance-1-0-pro-250528' },
};

export const CAPABILITY_LIST = ['vision', 'chat', 'image', 'edit', 'video'];

export const DEFAULT_SETTINGS = {
  endpoints: structuredClone(PRESET_ENDPOINTS),
  capabilities: structuredClone(DEFAULT_CAPABILITIES),
  concurrency: 3,
  corsProxy: '',
};

/* ───────────────── load / save / cache ───────────────── */

let _cache = null;

export function loadSettings() {
  if (_cache) return _cache;
  // v4 直接读
  const v4raw = localStorage.getItem(STORAGE_KEY);
  if (v4raw) {
    try {
      const obj = JSON.parse(v4raw);
      _cache = normalize(obj);
      return _cache;
    } catch { /* fall through */ }
  }
  // 否则尝试从老版本迁移
  for (const k of OLD_KEYS) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const old = JSON.parse(raw);
      _cache = migrateFromV3(old);
      // 立即写回 v4，老 key 保留以防回退
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
      return _cache;
    } catch { /* fall through */ }
  }
  // 全新用户
  _cache = structuredClone(DEFAULT_SETTINGS);
  return _cache;
}

export function saveSettings(s) {
  _cache = normalize(s);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
}

/** 浅 patch（顶层字段替换；endpoints / capabilities 整块替换） */
export function updateSettings(patch) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  saveSettings(next);
  return loadSettings();
}

export function exportSettings() {
  return JSON.stringify(loadSettings(), null, 2);
}

export function importSettings(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  saveSettings(normalize(obj));
}

/** 清除所有端点的 apiKey（保留端点本身和能力指派） */
export function clearKeys() {
  const s = loadSettings();
  s.endpoints = s.endpoints.map(ep => ({ ...ep, apiKey: '' }));
  saveSettings(s);
}

/* ───────────────── endpoint helpers ───────────────── */

export function getEndpoint(id) {
  return loadSettings().endpoints.find(e => e.id === id) || null;
}

export function addEndpoint({ name, baseURL, apiKey = '', protocol = 'auto' }) {
  const s = loadSettings();
  // 生成不冲突的 id
  let baseId = (name || 'endpoint').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'endpoint';
  let id = baseId;
  let i = 2;
  while (s.endpoints.some(e => e.id === id)) id = `${baseId}-${i++}`;
  const ep = { id, name: name || baseId, baseURL: (baseURL || '').trim(), apiKey, protocol };
  s.endpoints = [...s.endpoints, ep];
  saveSettings(s);
  return ep;
}

export function removeEndpoint(id) {
  const s = loadSettings();
  s.endpoints = s.endpoints.filter(e => e.id !== id);
  // 任何指向该端点的能力 → 回退到第一个端点
  const fallback = s.endpoints[0]?.id;
  for (const cap of CAPABILITY_LIST) {
    if (s.capabilities[cap]?.endpointId === id) {
      s.capabilities[cap] = { endpointId: fallback || '', model: '' };
    }
  }
  saveSettings(s);
}

export function updateEndpoint(id, patch) {
  const s = loadSettings();
  s.endpoints = s.endpoints.map(e => e.id === id ? { ...e, ...patch } : e);
  saveSettings(s);
}

export function setCapability(cap, endpointId, model) {
  const s = loadSettings();
  s.capabilities = {
    ...s.capabilities,
    [cap]: { endpointId, model: model || '' },
  };
  saveSettings(s);
}

/** 从预设里选一个塞回端点列表（用于"+ 从预设添加"按钮） */
export function addPresetEndpoint(presetId) {
  const preset = PRESET_ENDPOINTS.find(p => p.id === presetId);
  if (!preset) throw new Error('未知预设：' + presetId);
  const s = loadSettings();
  if (s.endpoints.some(e => e.id === preset.id)) {
    throw new Error(`端点 "${preset.name}" 已存在`);
  }
  s.endpoints = [...s.endpoints, structuredClone(preset)];
  saveSettings(s);
  return preset.id;
}

/* ───────────────── normalize / migrate ───────────────── */

function normalize(s) {
  const out = {
    endpoints: Array.isArray(s?.endpoints) ? s.endpoints.map(normEndpoint) : structuredClone(PRESET_ENDPOINTS),
    capabilities: { ...structuredClone(DEFAULT_CAPABILITIES), ...(s?.capabilities || {}) },
    concurrency: typeof s?.concurrency === 'number' ? s.concurrency : 3,
    corsProxy: typeof s?.corsProxy === 'string' ? s.corsProxy : '',
  };
  // 修复 capabilities：endpointId 必须存在于 endpoints 里，否则降级到第一个
  const ids = new Set(out.endpoints.map(e => e.id));
  const fallbackId = out.endpoints[0]?.id || '';
  for (const cap of CAPABILITY_LIST) {
    const c = out.capabilities[cap] || {};
    if (!c.endpointId || !ids.has(c.endpointId)) {
      out.capabilities[cap] = { endpointId: fallbackId, model: c.model || '' };
    } else {
      out.capabilities[cap] = { endpointId: c.endpointId, model: c.model || '' };
    }
  }
  return out;
}

function normEndpoint(e) {
  return {
    id: String(e.id || '').trim() || 'endpoint',
    name: String(e.name || e.id || 'endpoint'),
    baseURL: String(e.baseURL || '').trim(),
    apiKey: String(e.apiKey || ''),
    protocol: ['auto', 'openai', 'gemini', 'fal'].includes(e.protocol) ? e.protocol : 'auto',
  };
}

/**
 * v3 → v4 迁移规则：
 *   - 6 个旧 provider 字段 → 6 个端点（id 与旧 provider id 完全对应）
 *   - 模型字段 → 写入对应能力的 model
 *   - preferred.{vision/chat/image/edit/video} → capabilities[*].endpointId
 *
 * 旧格式样例：
 *   { volcengine: { apiKey, visionModel, imageModel, videoModel },
 *     gemini: { apiKey, visionModel, imageModel },
 *     fal: { apiKey, fluxKontextModel, klingModel },
 *     openai: { apiKey, baseURL, visionModel, imageModel },
 *     deepseek: { apiKey, baseURL, chatModel },
 *     siliconflow: { apiKey, baseURL, chatModel, visionModel, imageModel },
 *     preferred: { vision, chat, image, edit, video },
 *     concurrency, corsProxy }
 */
export function migrateFromV3(old) {
  // 起点：preset 端点（保持顺序、id、默认 baseURL）
  const eps = structuredClone(PRESET_ENDPOINTS);
  const findEp = id => eps.find(e => e.id === id);

  // 拷 apiKey / baseURL 到对应预设端点
  const portKey = (id, src) => {
    const ep = findEp(id);
    if (!ep || !src) return;
    if (src.apiKey) ep.apiKey = src.apiKey;
    if (src.baseURL) ep.baseURL = src.baseURL;
  };
  portKey('volcengine',  old?.volcengine);
  portKey('gemini',      old?.gemini);
  portKey('fal',         old?.fal);
  portKey('openai',      old?.openai);
  portKey('deepseek',    old?.deepseek);
  portKey('siliconflow', old?.siliconflow);

  // 能力指派
  const caps = structuredClone(DEFAULT_CAPABILITIES);
  const pref = old?.preferred || {};

  // model 字段定位规则
  const modelOf = (epId, capName) => {
    if (epId === 'volcengine') {
      const v = old.volcengine || {};
      if (capName === 'vision' || capName === 'chat') return v.visionModel || caps[capName].model;
      if (capName === 'image' || capName === 'edit') return v.imageModel || caps[capName].model;
      if (capName === 'video') return v.videoModel || caps.video.model;
    }
    if (epId === 'gemini') {
      const g = old.gemini || {};
      if (capName === 'vision' || capName === 'chat') return g.visionModel || 'gemini-2.5-flash';
      if (capName === 'image' || capName === 'edit') return g.imageModel || 'gemini-2.5-flash-image';
    }
    if (epId === 'openai') {
      const o = old.openai || {};
      if (capName === 'vision' || capName === 'chat') return o.visionModel || 'gpt-4o';
      if (capName === 'image' || capName === 'edit') return o.imageModel || 'gpt-image-1';
    }
    if (epId === 'deepseek') {
      const d = old.deepseek || {};
      if (capName === 'chat') return d.chatModel || 'deepseek-chat';
    }
    if (epId === 'siliconflow') {
      const sf = old.siliconflow || {};
      if (capName === 'chat') return sf.chatModel || 'deepseek-ai/DeepSeek-V3';
      if (capName === 'vision') return sf.visionModel || 'Qwen/Qwen2.5-VL-72B-Instruct';
      if (capName === 'image' || capName === 'edit') return sf.imageModel || 'Kwai-Kolors/Kolors';
    }
    if (epId === 'fal') {
      const f = old.fal || {};
      if (capName === 'image' || capName === 'edit') return f.fluxKontextModel || 'fal-ai/flux-pro/kontext';
      if (capName === 'video') return f.klingModel || 'fal-ai/kling-video/v2/master/image-to-video';
    }
    return caps[capName].model;
  };

  for (const cap of CAPABILITY_LIST) {
    const wanted = pref[cap];
    if (wanted && findEp(wanted)) {
      caps[cap] = { endpointId: wanted, model: modelOf(wanted, cap) };
    } else {
      // 老用户没指定 → 沿用 default（火山方舟）但 model 也走 modelOf
      caps[cap] = { endpointId: caps[cap].endpointId, model: modelOf(caps[cap].endpointId, cap) };
    }
  }

  return normalize({
    endpoints: eps,
    capabilities: caps,
    concurrency: typeof old?.concurrency === 'number' ? old.concurrency : 3,
    corsProxy: typeof old?.corsProxy === 'string' ? old.corsProxy : '',
  });
}

/** 测试期可重置缓存 */
export function _resetCache() { _cache = null; }
