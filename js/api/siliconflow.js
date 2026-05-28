// js/api/siliconflow.js — 硅基流动 SiliconFlow adapter
// 国内主流 OpenAI 兼容聚合平台，集合了 DeepSeek、Qwen、Kolors、Flux、SD3.5 等多种模型。
// Endpoints (OpenAI-compatible base + SiliconFlow images quirks):
//   POST {baseURL}/v1/chat/completions   (chat, vision)
//   POST {baseURL}/v1/images/generations (text-to-image; uses image_size + batch_size, NOT size + n)
// Docs: https://docs.siliconflow.cn/

import { loadSettings } from '../settings.js';

function cfg() {
  const s = loadSettings();
  if (!s.siliconflow?.apiKey) {
    throw new Error('请先在「设置」里填写硅基流动 API Key');
  }
  return s.siliconflow;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

function baseURL() {
  return (cfg().baseURL || 'https://api.siliconflow.cn').replace(/\/+$/, '');
}

async function postJSON(path, body, { signal } = {}) {
  const c = cfg();
  const r = await fetch(withProxy(baseURL() + path), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let msg = `SiliconFlow ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || j?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

/** 视觉理解 / 反推（用 vision 模型，OpenAI 兼容 messages 格式） */
export async function reverseImage(imageDataURLs, instruction, { signal } = {}) {
  const c = cfg();
  const imgs = Array.isArray(imageDataURLs) ? imageDataURLs : [imageDataURLs];
  const content = [
    ...imgs.map(url => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: instruction || defaultReversePrompt() },
  ];
  const r = await postJSON('/v1/chat/completions', {
    model: c.visionModel,
    messages: [{ role: 'user', content }],
    temperature: 0.4,
  }, { signal });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

/** 纯文本 LLM —— prompt 改写润色 */
export async function chatText(text, { signal } = {}) {
  const c = cfg();
  const r = await postJSON('/v1/chat/completions', {
    model: c.chatModel,
    messages: [{ role: 'user', content: text }],
    temperature: 0.6,
  }, { signal });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

function defaultReversePrompt() {
  return [
    '请仔细分析这张图，输出一段可以直接用于 AI 生图的英文 prompt。',
    '描述：主体外观/姿态/表情、场景、光线、构图、镜头、风格。',
    '只输出逗号分隔的关键词，不要解释。',
  ].join('\n');
}

/**
 * 文生图（SiliconFlow 的 images/generations 用 image_size 和 batch_size 字段）
 * 不支持 reference images（图生图），收到时抛错由上层路由其他服务商。
 */
export async function generateImage({ prompt, referenceImages = [], size = '1024x1024', n = 1 } = {}, { signal } = {}) {
  if (referenceImages.length) {
    throw new Error('硅基流动通道暂不支持图生图（参考图），请改用火山方舟 / Gemini / OpenAI');
  }
  const c = cfg();
  const r = await postJSON('/v1/images/generations', {
    model: c.imageModel,
    prompt,
    image_size: size,
    batch_size: n,
  }, { signal });
  const list = r.data || r.images || [];
  const images = list.map(x =>
    x.url || (x.b64_json ? `data:image/png;base64,${x.b64_json}` : null)
  ).filter(Boolean);
  if (!images.length) throw new Error('SiliconFlow 未返回图像：' + JSON.stringify(r));
  return { images, raw: r };
}

/** SiliconFlow 暂不支持图像编辑 */
export async function editImage() {
  throw new Error('硅基流动通道暂不支持图像编辑（图生图），请改用火山方舟 / Gemini / OpenAI');
}

/** SiliconFlow 暂不在标准接口里直接生视频 */
export async function generateVideo() {
  throw new Error('硅基流动通道暂未实现视频生成，请改用火山方舟或 fal.ai');
}

export const meta = {
  name: '硅基流动 (SiliconFlow)',
  signupUrl: 'https://cloud.siliconflow.cn/account/ak',
  capabilities: ['chat', 'vision', 'image'],
};
