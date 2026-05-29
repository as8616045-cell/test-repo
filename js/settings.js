// js/settings.js — v4: 自动识别端点 + 2 桶能力指派（LLM / 图片）
//
// v4 schema:
//   {
//     endpoints: [
//       { id, name, baseURL, apiKey, protocol: 'auto'|'openai'|'gemini'|'fal' },
//       ...
//     ],
//     capabilities: {
//       llm:   { endpointId, model },   // 文字 + 多模态：覆盖反推（vision）和改写（chat）
//       image: { endpointId, model },   // 生图 + 编辑（+ 视频，复用同一端点）
//     },
//     concurrency, corsProxy,
//   }
//
// 用户只填 baseURL + apiKey，detectProvider() 按 URL 自动识别厂商和协议。
// 老 v3 设置走 migrateFromV3 自动转换。

const STORAGE_KEY = 'ai-studio:settings:v4';
const OLD_KEYS = ['ai-studio:settings:v3', 'ai-studio:settings:v2', 'ai-studio:settings:v1'];

/** 用于"快速粘贴"的预设 baseURL —— 不再作为默认端点塞入,
 * 而是设置页提供的快捷按钮:点击就帮用户把 baseURL 填进表单. */
export const PRESET_ENDPOINTS = [
  { id: 'volcengine',  name: '火山方舟', icon: '🌋',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai',
    defaultModels: { llm: 'doubao-seed-1-6-vision-250815', image: 'doubao-seedream-4-0-250828' } },
  { id: 'openai',      name: 'OpenAI 官方', icon: '🤖',
    baseURL: 'https://api.openai.com', protocol: 'openai',
    defaultModels: { llm: 'gpt-4o', image: 'gpt-image-1' } },
  { id: 'gemini',      name: 'Google Gemini', icon: '✨',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini',
    defaultModels: { llm: 'gemini-2.5-flash', image: 'gemini-2.5-flash-image' } },
  { id: 'deepseek',    name: 'DeepSeek', icon: '🐋',
    baseURL: 'https://api.deepseek.com', protocol: 'openai',
    defaultModels: { llm: 'deepseek-chat', image: '' } },
  { id: 'siliconflow', name: '硅基流动', icon: '🌊',
    baseURL: 'https://api.siliconflow.cn', protocol: 'openai',
    defaultModels: { llm: 'Qwen/Qwen2.5-VL-72B-Instruct', image: 'Kwai-Kolors/Kolors' } },
  { id: 'fal',         name: 'fal.ai', icon: '🎨',
    baseURL: 'https://queue.fal.run', protocol: 'fal',
    defaultModels: { llm: '', image: 'fal-ai/flux-pro/kontext' } },
];

/** 2 个桶 */
export const BUCKETS = ['llm', 'image'];

export const BUCKET_LABELS = {
  llm:   '💬 LLM（文字 / 多模态）',
  image: '🖼️ 图片（生图 / 编辑）',
};

/** capability → bucket 映射 */
export const CAPABILITY_TO_BUCKET = {
  vision: 'llm',
  chat:   'llm',
  image:  'image',
  edit:   'image',
  video:  'image',
};

/** 默认能力指派 —— 空,等用户添加端点后再回填 */
export const DEFAULT_CAPABILITIES = {
  llm:   { endpointId: '', model: '' },
  image: { endpointId: '', model: '' },
};

export const DEFAULT_SETTINGS = {
  endpoints: [],
  capabilities: structuredClone(DEFAULT_CAPABILITIES),
  concurrency: 3,
  corsProxy: '',
};

/* ───────────────── 自动识别 ───────────────── */

/**
 * 规范化用户粘贴的 baseURL。
 *
 * 用户经常直接从浏览器地址栏复制中转站的"网页后台"页面地址,比如
 *   https://www.right.codes/home  /  /api-keys  /  /draw  /  /panel  /  /#/login
 * 这些是网站页面,不是 API 地址。
 *
 * ⚠️ 难点:无法靠通用规则区分"网页页面"和"API 路径前缀"。
 *   例如 right.codes 的 API 真身是 https://www.right.codes/codex/v1 ——
 *   `/codex` 是必须保留的 API 前缀,但它和 `/draw` 这种页面长得一模一样。
 *   所以这里采取"保守去噪"策略:
 *     · 去掉结尾斜杠 / hash 路由 / 查询串
 *     · 只剥离结尾那些【明确是网页页面、绝不可能是 API 前缀】的词
 *       (home/login/dashboard/panel 等),用白名单式 denylist
 *     · 其它路径段(包括 /codex、/v1、/proxy 等)一律原样保留
 *   宁可少剥(让用户按提示补全 /v1),也不要错剥真实 API 前缀。
 */
const DASHBOARD_SEGMENTS = new RegExp(
  '\\/(home|dashboard|panel|console|login|logout|register|signin|signup|' +
  'index(?:\\.html?)?|profile|settings?|tokens?|api-?keys?|keys|account|' +
  'topup|recharge|wallet|billing|usage|pricing|about|docs?|help|user|users|' +
  'admin|draw|midjourney|chat|playground|log|logs)$',
  'i'
);

export function normalizeBaseURL(url) {
  let u = String(url || '').trim();
  if (!u) return u;
  // 去掉 hash 路由 / 查询串 / 结尾斜杠
  u = u.replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  if (!u) return u;

  // 反复剥离结尾的"明确网页页面"段(大小写不敏感),但保留 /codex /v1 等真实前缀
  let prev;
  do {
    prev = u;
    u = u.replace(DASHBOARD_SEGMENTS, '').replace(/\/+$/, '');
  } while (u !== prev);

  return u;
}

/**
 * 按 baseURL 自动识别厂商,返回 { id, name, icon, protocol, defaultModels }.
 * 任何无法识别的 URL 默认返回 'OpenAI 兼容（中转站/自建）'.
 */
export function detectProvider(baseURL) {
  const url = String(baseURL || '').toLowerCase().trim();
  if (!url) {
    return { id: 'unknown', name: '（请输入 baseURL）', icon: '❓', protocol: 'auto', confidence: 'none', defaultModels: {} };
  }
  if (/volcengine|ark\.cn|volces/.test(url)) {
    return { id: 'volcengine', name: '火山方舟', icon: '🌋', protocol: 'openai', confidence: 'high',
             defaultModels: { llm: 'doubao-seed-1-6-vision-250815', image: 'doubao-seedream-4-0-250828' } };
  }
  if (/api\.openai\.com/.test(url)) {
    return { id: 'openai', name: 'OpenAI 官方', icon: '🤖', protocol: 'openai', confidence: 'high',
             defaultModels: { llm: 'gpt-4o', image: 'gpt-image-1' } };
  }
  if (/generativelanguage\.googleapis|gemini/.test(url)) {
    return { id: 'gemini', name: 'Google Gemini', icon: '✨', protocol: 'gemini', confidence: 'high',
             defaultModels: { llm: 'gemini-2.5-flash', image: 'gemini-2.5-flash-image' } };
  }
  if (/api\.deepseek\.com|deepseek/.test(url)) {
    return { id: 'deepseek', name: 'DeepSeek', icon: '🐋', protocol: 'openai', confidence: 'high',
             defaultModels: { llm: 'deepseek-chat', image: '' } };
  }
  if (/siliconflow/.test(url)) {
    return { id: 'siliconflow', name: '硅基流动', icon: '🌊', protocol: 'openai', confidence: 'high',
             defaultModels: { llm: 'Qwen/Qwen2.5-VL-72B-Instruct', image: 'Kwai-Kolors/Kolors' } };
  }
  if (/fal\.run|fal\.ai/.test(url)) {
    return { id: 'fal', name: 'fal.ai', icon: '🎨', protocol: 'fal', confidence: 'high',
             defaultModels: { llm: '', image: 'fal-ai/flux-pro/kontext' } };
  }
  // 任意 OpenAI 兼容中转站 / OneAPI / NewAPI / 自建代理
  return { id: 'custom', name: 'OpenAI 兼容（中转站 / 自建）', icon: '🔌', protocol: 'openai', confidence: 'low',
           defaultModels: { llm: 'gpt-4o', image: 'gpt-image-1' } };
}

/* ───────────────── load / save ───────────────── */

let _cache = null;

export function loadSettings() {
  if (_cache) return _cache;
  // v4 直接读
  const v4raw = localStorage.getItem(STORAGE_KEY);
  if (v4raw) {
    try {
      _cache = normalize(JSON.parse(v4raw));
      return _cache;
    } catch { /* fall through */ }
  }
  // 否则尝试从 v3 / v2 / v1 迁移
  for (const k of OLD_KEYS) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      _cache = migrateFromV3(JSON.parse(raw));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
      return _cache;
    } catch { /* fall through */ }
  }
  // 全新用户 —— 空端点列表
  _cache = structuredClone(DEFAULT_SETTINGS);
  return _cache;
}

export function saveSettings(s) {
  _cache = normalize(s);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
}

export function updateSettings(patch) {
  saveSettings({ ...loadSettings(), ...patch });
  return loadSettings();
}

export function exportSettings() {
  return JSON.stringify(loadSettings(), null, 2);
}

export function importSettings(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  saveSettings(normalize(obj));
}

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
  const cleanURL = normalizeBaseURL(baseURL);
  // 用 detectProvider 推一个稳定 id；冲突时加后缀
  const det = detectProvider(cleanURL);
  let baseId = det.confidence === 'high' ? det.id
    : (String(name || 'endpoint').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'endpoint');
  let id = baseId;
  let i = 2;
  while (s.endpoints.some(e => e.id === id)) id = `${baseId}-${i++}`;
  const ep = {
    id,
    name: name?.trim() || det.name,
    baseURL: cleanURL,
    apiKey,
    protocol: ['auto', 'openai', 'gemini', 'fal'].includes(protocol) ? protocol : 'auto',
  };
  s.endpoints = [...s.endpoints, ep];
  saveSettings(s);
  return ep;
}

export function removeEndpoint(id) {
  const s = loadSettings();
  s.endpoints = s.endpoints.filter(e => e.id !== id);
  // 任何指向该端点的 bucket → 回退到第一个端点（或清空）
  const fallback = s.endpoints[0]?.id || '';
  for (const b of BUCKETS) {
    if (s.capabilities[b]?.endpointId === id) {
      s.capabilities[b] = { endpointId: fallback, model: '' };
    }
  }
  saveSettings(s);
}

export function updateEndpoint(id, patch) {
  const s = loadSettings();
  s.endpoints = s.endpoints.map(e => e.id === id ? { ...e, ...patch } : e);
  saveSettings(s);
}

export function setCapability(bucket, endpointId, model) {
  if (!BUCKETS.includes(bucket)) throw new Error('未知 bucket: ' + bucket);
  const s = loadSettings();
  s.capabilities = {
    ...s.capabilities,
    [bucket]: { endpointId: endpointId || '', model: model || '' },
  };
  saveSettings(s);
}

/* ───────────────── normalize ───────────────── */

function normalize(s) {
  const endpoints = Array.isArray(s?.endpoints) ? s.endpoints.map(normEndpoint) : [];
  const ids = new Set(endpoints.map(e => e.id));

  const caps = { ...structuredClone(DEFAULT_CAPABILITIES) };
  for (const b of BUCKETS) {
    const c = s?.capabilities?.[b] || {};
    const epId = (c.endpointId && ids.has(c.endpointId)) ? c.endpointId : '';
    caps[b] = { endpointId: epId, model: typeof c.model === 'string' ? c.model : '' };
  }
  return {
    endpoints,
    capabilities: caps,
    concurrency: typeof s?.concurrency === 'number' ? s.concurrency : 3,
    corsProxy: typeof s?.corsProxy === 'string' ? s.corsProxy : '',
  };
}

function normEndpoint(e) {
  return {
    id: String(e.id || '').trim() || 'endpoint',
    name: String(e.name || e.id || 'endpoint'),
    // 加载时也规范化 baseURL —— 这样已经存了错误地址(如 .../home)的端点会自动修好
    baseURL: normalizeBaseURL(e.baseURL),
    apiKey: String(e.apiKey || ''),
    protocol: ['auto', 'openai', 'gemini', 'fal'].includes(e.protocol) ? e.protocol : 'auto',
  };
}

/* ───────────────── migration ───────────────── */

/**
 * v3 → v4 迁移规则:
 *   - 6 个旧 provider 字段 → 只把"已填 apiKey"的转成端点
 *   - 模型字段聚合到 2 桶里（取已填值）
 *   - preferred.{vision/chat/image/edit/video} → llm/image bucket
 */
export function migrateFromV3(old) {
  const eps = [];
  const port = (presetId, src) => {
    if (!src?.apiKey) return;
    const preset = PRESET_ENDPOINTS.find(p => p.id === presetId);
    eps.push({
      id: presetId,
      name: preset?.name || presetId,
      baseURL: (src.baseURL && src.baseURL.trim()) || preset?.baseURL || '',
      apiKey: src.apiKey,
      protocol: 'auto',
    });
  };
  port('volcengine',  old?.volcengine);
  port('openai',      old?.openai);
  port('gemini',      old?.gemini);
  port('deepseek',    old?.deepseek);
  port('siliconflow', old?.siliconflow);
  port('fal',         old?.fal);

  // capabilities → 2 桶
  const pref = old?.preferred || {};
  const caps = { llm: { endpointId: '', model: '' }, image: { endpointId: '', model: '' } };

  // LLM 桶：优先沿用 preferred.chat，否则 preferred.vision
  const llmEpId = (pref.chat && eps.find(e => e.id === pref.chat)) ? pref.chat
                 : (pref.vision && eps.find(e => e.id === pref.vision)) ? pref.vision
                 : eps[0]?.id || '';
  caps.llm.endpointId = llmEpId;
  caps.llm.model = modelOfV3LLM(old, llmEpId);

  // 图片桶：优先 preferred.image，否则 preferred.edit
  const imgEpId = (pref.image && eps.find(e => e.id === pref.image)) ? pref.image
                : (pref.edit && eps.find(e => e.id === pref.edit)) ? pref.edit
                : eps[0]?.id || '';
  caps.image.endpointId = imgEpId;
  caps.image.model = modelOfV3Image(old, imgEpId);

  return normalize({
    endpoints: eps,
    capabilities: caps,
    concurrency: typeof old?.concurrency === 'number' ? old.concurrency : 3,
    corsProxy: typeof old?.corsProxy === 'string' ? old.corsProxy : '',
  });
}

function modelOfV3LLM(old, epId) {
  const fallback = PRESET_ENDPOINTS.find(p => p.id === epId)?.defaultModels?.llm || '';
  if (!epId) return fallback;
  if (epId === 'volcengine')  return old.volcengine?.visionModel || fallback;
  if (epId === 'gemini')      return old.gemini?.visionModel || fallback;
  if (epId === 'openai')      return old.openai?.visionModel || fallback;
  if (epId === 'deepseek')    return old.deepseek?.chatModel || fallback;
  if (epId === 'siliconflow') return old.siliconflow?.visionModel || old.siliconflow?.chatModel || fallback;
  return fallback;
}
function modelOfV3Image(old, epId) {
  const fallback = PRESET_ENDPOINTS.find(p => p.id === epId)?.defaultModels?.image || '';
  if (!epId) return fallback;
  if (epId === 'volcengine')  return old.volcengine?.imageModel || fallback;
  if (epId === 'gemini')      return old.gemini?.imageModel || fallback;
  if (epId === 'openai')      return old.openai?.imageModel || fallback;
  if (epId === 'siliconflow') return old.siliconflow?.imageModel || fallback;
  if (epId === 'fal')         return old.fal?.fluxKontextModel || fallback;
  return fallback;
}

/** 测试期可重置缓存 */
export function _resetCache() { _cache = null; }
