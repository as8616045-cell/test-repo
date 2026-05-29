// js/api/protocols/openai.js — OpenAI 兼容协议
// 服务于：OpenAI 官方、DeepSeek、SiliconFlow、火山方舟、OneAPI / NewAPI / 任意中转站
//
// 协议特点：
//   - chat/vision 走 /v1/chat/completions，messages[].content 用 [{type:'image_url',...}, {type:'text',...}]
//   - 标准生图走 POST /v1/images/generations + size + n
//   - 标准编辑走 POST /v1/images/edits（multipart）
//
// ⚠️ 火山方舟（baseURL 含 volcengine|ark|volces）的特殊点：
//   - 生图也走 /images/generations（无 /v1/）
//   - 多图参考用 image 字段（string 或 string[]），不是 multipart image[]
//   - 需要 sequential_image_generation: 'disabled'
//   - 不走 /images/edits，统一 /images/generations + image 字段
//
// ⚠️ SiliconFlow（baseURL 含 siliconflow）的特殊点：
//   - 生图用 image_size 和 batch_size 字段，不是 OpenAI 标准 size + n
//   - 不支持图生图（参考图），收到时抛错让上层降级到其他端点

import { sleep } from '../../utils.js';
import { loadSettings } from '../../settings.js';

/* ───────────────── helpers ───────────────── */

function isVolcengine(endpoint) {
  return /volcengine|ark|volces/i.test(endpoint.baseURL || '');
}
function isSiliconflow(endpoint) {
  return /siliconflow/i.test(endpoint.baseURL || '');
}

function withProxy(url) {
  const p = (loadSettings().corsProxy || '').replace(/\/+$/, '');
  return p ? p + '/' + url : url;
}

/**
 * 把抽象路径 ('/v1/chat/completions') 拼到 endpoint.baseURL 上。
 * 如果 baseURL 已经包含 /v1 / /v1beta / /api/v3 这种版本前缀，
 * 就把传入路径里的 /v1 段去掉，避免拼出 /v1/v1/...。
 */
function buildURL(endpoint, path) {
  let base = (endpoint.baseURL || '').replace(/\/+$/, '');
  // 火山方舟 / DeepSeek（含 v3 / vN/vNbeta）等已带版本前缀
  if (/\/api\/v\d+$|\/v\d+(?:beta)?$/.test(base)) {
    return base + path.replace(/^\/v\d+(?:beta)?/, '');
  }
  return base + path;
}

async function postJSON(endpoint, path, body, { signal } = {}) {
  const r = await fetch(withProxy(buildURL(endpoint, path)), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${endpoint.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) await throwHTTP(r);
  return r.json();
}

async function postForm(endpoint, path, formData, { signal } = {}) {
  const r = await fetch(withProxy(buildURL(endpoint, path)), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${endpoint.apiKey}` },
    body: formData,
    signal,
  });
  if (!r.ok) await throwHTTP(r);
  return r.json();
}

async function throwHTTP(r) {
  let msg = `${r.status}`;
  try {
    const j = await r.json();
    msg += ': ' + (j?.error?.message || j?.message || JSON.stringify(j));
  } catch {
    msg += ': ' + await r.text().catch(() => '');
  }
  throw new Error(msg);
}

function dataURLtoBlob(dataURL) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataURL);
  if (!m) throw new Error('图片必须为 base64 dataURL');
  const mime = m[1], b64 = m[2];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function defaultReversePrompt() {
  return [
    '请仔细分析这张图，输出一段可以直接用于 AI 生图的英文 prompt。',
    '描述：主体外观/姿态/表情、场景、光线、构图、镜头、风格。',
    '只输出逗号分隔的关键词，不要解释。',
  ].join('\n');
}

function parseImagesResp(r) {
  const data = r.data || r.images || [];
  const images = data.map(x => {
    if (typeof x === 'string') return x;
    if (x.b64_json) return `data:image/png;base64,${x.b64_json}`;
    if (x.url) return x.url;
    return null;
  }).filter(Boolean);
  if (!images.length) throw new Error('未返回图像：' + JSON.stringify(r));
  return { images, raw: r };
}

/* ───────────────── chat / vision ───────────────── */

export async function reverseImage(endpoint, model, imageDataURLs, instruction, { signal } = {}) {
  const imgs = Array.isArray(imageDataURLs) ? imageDataURLs : [imageDataURLs];
  const content = [
    ...imgs.map(url => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: instruction || defaultReversePrompt() },
  ];
  const r = await postJSON(endpoint, '/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.4,
  }, { signal });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

export async function chatText(endpoint, model, text, { signal } = {}) {
  const r = await postJSON(endpoint, '/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: text }],
    temperature: 0.6,
  }, { signal });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

/* ───────────────── image: generate / edit ───────────────── */

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string[]} [opts.referenceImages]
 * @param {string} [opts.size]   - '1024x1024'
 * @param {number} [opts.n]
 * @param {string} [opts.aspectRatio] - 仅用于火山方舟 image 字段时的可选透传
 * @param {string} [opts.quality]
 */
export async function generateImage(endpoint, model, opts = {}, { signal } = {}) {
  const { prompt, referenceImages = [], size = '1024x1024', n = 1, quality } = opts;

  // ── SiliconFlow：image_size + batch_size，不支持图生图
  if (isSiliconflow(endpoint)) {
    if (referenceImages.length) {
      throw new Error('SiliconFlow 通道暂不支持图生图（参考图），请改用其他端点');
    }
    const r = await postJSON(endpoint, '/v1/images/generations', {
      model,
      prompt,
      image_size: size,
      batch_size: n,
    }, { signal });
    return parseImagesResp(r);
  }

  // ── 火山方舟：image 字段（string | string[]） + sequential_image_generation
  if (isVolcengine(endpoint)) {
    const body = { model, prompt, size, n, response_format: 'url' };
    if (referenceImages.length) {
      body.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
      body.sequential_image_generation = 'disabled';
    }
    const r = await postJSON(endpoint, '/v1/images/generations', body, { signal });
    return parseImagesResp(r);
  }

  // ── OpenAI 标准
  if (referenceImages.length) {
    // multipart -> /v1/images/edits
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('n', String(n));
    fd.append('size', size);
    if (quality) fd.append('quality', quality);
    for (let i = 0; i < referenceImages.length; i++) {
      const blob = dataURLtoBlob(referenceImages[i]);
      const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
      fd.append('image[]', blob, `ref_${i + 1}.${ext}`);
    }
    const r = await postForm(endpoint, '/v1/images/edits', fd, { signal });
    return parseImagesResp(r);
  } else {
    const body = { model, prompt, n, size };
    if (quality) body.quality = quality;
    const r = await postJSON(endpoint, '/v1/images/generations', body, { signal });
    return parseImagesResp(r);
  }
}

export async function editImage(endpoint, model, opts = {}, runOpts = {}) {
  const { prompt, images = [], size, n } = opts;
  return generateImage(endpoint, model, {
    prompt,
    referenceImages: images,
    size,
    n,
  }, runOpts);
}

/* ───────────────── video（仅火山方舟支持） ───────────────── */

export async function generateVideo(endpoint, model, opts = {}, { signal, onProgress } = {}) {
  if (!isVolcengine(endpoint)) {
    throw new Error('当前端点不支持视频生成（仅火山方舟在 OpenAI 协议下提供）');
  }
  const { prompt, image, ratio = '16:9', duration = 5 } = opts;
  const submit = await postJSON(endpoint, '/v1/contents/generations/tasks', {
    model,
    content: [
      { type: 'text', text: `${prompt} --rt ${ratio} --dur ${duration}` },
      ...(image ? [{ type: 'image_url', image_url: { url: image } }] : []),
    ],
  }, { signal });
  const taskId = submit.id;
  if (!taskId) throw new Error('提交视频任务失败：未返回 id');

  for (let i = 0; i < 120; i++) {
    if (signal?.aborted) throw new Error('用户取消');
    await sleep(5000);
    const url = withProxy(buildURL(endpoint, `/v1/contents/generations/tasks/${taskId}`));
    const r = await fetch(url, { headers: { Authorization: `Bearer ${endpoint.apiKey}` } });
    if (!r.ok) continue;
    const t = await r.json();
    onProgress?.(t.status, t);
    if (t.status === 'succeeded') {
      const videoUrl = t.content?.video_url || t.content?.url;
      if (!videoUrl) throw new Error('任务完成但未返回视频 URL');
      return { videoUrl, raw: t };
    }
    if (t.status === 'failed' || t.status === 'cancelled') {
      throw new Error('视频任务失败：' + (t.failure_reason || t.status));
    }
  }
  throw new Error('视频任务超时');
}

/* ───────────────── list models ─────────────────
 *
 * GET /v1/models —— OpenAI 官方、火山方舟、DeepSeek、SiliconFlow、
 * 任何 OneAPI/NewAPI 中转站都支持。返回 [{ id, name }, ...]。
 * 失败时抛错。
 */
export async function listModels(endpoint) {
  const r = await fetch(withProxy(buildURL(endpoint, '/v1/models')), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${endpoint.apiKey}` },
  });
  if (!r.ok) await throwHTTP(r);
  const j = await r.json();
  const list = j?.data || j?.models || j;
  if (!Array.isArray(list)) return [];
  return list
    .map(m => {
      const id = typeof m === 'string' ? m : (m.id || m.name || m.model);
      return id ? { id, name: id } : null;
    })
    .filter(Boolean);
}

/* ───────────────── meta + ping ───────────────── */

export const meta = {
  name: 'OpenAI Compatible',
  capabilities: ['vision', 'chat', 'image', 'edit', 'video'],

  /**
   * 连通性测试。成功返回简短描述（'OK 200ms 看到 N 个模型'），失败抛错。
   */
  async ping(endpoint) {
    if (!endpoint.apiKey) throw new Error('未填 API Key');
    const t0 = performance.now();
    // SiliconFlow / 火山方舟 / DeepSeek / OpenAI 都支持 GET /v1/models
    const r = await fetch(withProxy(buildURL(endpoint, '/v1/models')), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${endpoint.apiKey}` },
    });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        msg += ' — ' + (j?.error?.message || j?.message || '');
      } catch {}
      throw new Error(msg);
    }
    let count = '?';
    try {
      const j = await r.json();
      const list = j?.data || j?.models || j;
      if (Array.isArray(list)) count = String(list.length);
    } catch {}
    return `OK ${ms}ms · ${count} 模型`;
  },
};
