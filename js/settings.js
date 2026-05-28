// js/settings.js — manages API keys + provider preferences in localStorage

const STORAGE_KEY = 'ai-studio:settings:v1';

// Default schema. Add new providers here as we extend.
export const DEFAULT_SETTINGS = {
  // Volcengine (火山方舟) - 即梦4.0 / 豆包视觉 / 可灵
  volcengine: {
    apiKey: '',
    // Defaults match Volcengine Ark public model IDs (用户可自行修改)
    visionModel: 'doubao-seed-1-6-vision-250815',     // 豆包视觉理解
    imageModel:  'doubao-seedream-4-0-250828',        // 即梦 4.0
    videoModel:  'doubao-seedance-1-0-pro-250528',    // 即梦视频 Seedance
  },

  // Google Gemini - 视觉理解 + Nano Banana 生图编辑
  gemini: {
    apiKey: '',
    visionModel: 'gemini-2.5-flash',
    imageModel:  'gemini-2.5-flash-image',  // Nano Banana
  },

  // fal.ai - Flux Kontext / Kling 等海量模型聚合
  fal: {
    apiKey: '',
    // Default endpoints (fal model paths)
    fluxKontextModel: 'fal-ai/flux-pro/kontext',
    klingModel:       'fal-ai/kling-video/v2/master/image-to-video',
  },

  // 默认服务商选择（每个能力可选一家）
  preferred: {
    vision:  'volcengine', // 反推提示词
    image:   'volcengine', // 生图
    edit:    'volcengine', // 图像编辑（换产品/换背景）
    video:   'volcengine', // 生视频
  },

  // 通用并发控制
  concurrency: 3,

  // 可选 CORS 代理（个别 API 浏览器调不通时用）
  corsProxy: '',
};

let _cache = null;

export function loadSettings() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      _cache = deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
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
