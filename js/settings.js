// js/settings.js — manages API keys + provider preferences in localStorage

const STORAGE_KEY = 'ai-studio:settings:v3';

// Default schema. Add new providers here as we extend.
export const DEFAULT_SETTINGS = {
  // Volcengine (火山方舟) - 即梦4.0 / 豆包视觉 / 可灵
  volcengine: {
    apiKey: '',
    visionModel: 'doubao-seed-1-6-vision-250815',
    imageModel:  'doubao-seedream-4-0-250828',
    videoModel:  'doubao-seedance-1-0-pro-250528',
  },

  // Google Gemini - 视觉理解 + Nano Banana 生图编辑
  gemini: {
    apiKey: '',
    visionModel: 'gemini-2.5-flash',
    imageModel:  'gemini-2.5-flash-image',
  },

  // fal.ai - Flux Kontext / Kling 等海量模型聚合
  fal: {
    apiKey: '',
    fluxKontextModel: 'fal-ai/flux-pro/kontext',
    klingModel:       'fal-ai/kling-video/v2/master/image-to-video',
  },

  // OpenAI 官方 / 任意 OpenAI 兼容中转站（OneAPI / NewAPI / 直接代理 等）
  openai: {
    apiKey:  '',
    baseURL: 'https://api.openai.com',
    visionModel: 'gpt-4o',
    imageModel:  'gpt-image-1',
  },

  // DeepSeek - 国内主流文本 LLM（用于改写润色，不生图）
  deepseek: {
    apiKey: '',
    baseURL: 'https://api.deepseek.com',
    chatModel: 'deepseek-chat',  // 或 deepseek-reasoner
  },

  // 默认服务商选择（每个能力可选一家）
  preferred: {
    vision:  'volcengine',
    image:   'volcengine',
    edit:    'volcengine',
    video:   'volcengine',
    chat:    'volcengine',  // prompt 改写默认用火山豆包
  },

  concurrency: 3,
  corsProxy: '',
};

let _cache = null;

export function loadSettings() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // also try migrating from older versions
    const v2 = !raw ? localStorage.getItem('ai-studio:settings:v2') : null;
    const v1 = !raw && !v2 ? localStorage.getItem('ai-studio:settings:v1') : null;
    const seed = raw || v2 || v1;
    if (seed) {
      _cache = deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(seed));
    } else {
      _cache = structuredClone(DEFAULT_SETTINGS);
    }
  } catch {
    _cache = structuredClone(DEFAULT_SETTINGS);
  }
  return _cache;
}

export function saveSettings(s) {
  _cache = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function updateSettings(patch) {
  const cur = loadSettings();
  const next = deepMerge(cur, patch);
  saveSettings(next);
  return next;
}

export function exportSettings() {
  return JSON.stringify(loadSettings(), null, 2);
}

export function importSettings(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  saveSettings(deepMerge(structuredClone(DEFAULT_SETTINGS), obj));
}

export function clearKeys() {
  const s = loadSettings();
  s.volcengine.apiKey = '';
  s.gemini.apiKey = '';
  s.fal.apiKey = '';
  s.openai.apiKey = '';
  s.deepseek.apiKey = '';
  saveSettings(s);
}

function deepMerge(a, b) {
  if (b == null) return a;
  if (Array.isArray(a) || typeof a !== 'object') return b;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
      out[k] = deepMerge(a[k] || {}, b[k]);
    } else {
      out[k] = b[k];
    }
  }
  return out;
}
