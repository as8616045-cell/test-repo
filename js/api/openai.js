// js/api/openai.js — OpenAI gpt-image-1 / gpt-image-2 + 任意 OpenAI 兼容中转站
// Endpoints:
//   POST {baseURL}/v1/images/generations  (text -> image)
//   POST {baseURL}/v1/images/edits        (image + prompt -> image, multipart)
//   POST {baseURL}/v1/chat/completions    (vision)
// Docs: https://platform.openai.com/docs/api-reference/images

import { loadSettings } from '../settings.js';
import { stripDataURL, sleep } from '../utils.js';

function cfg() {
  const s = loadSettings();
  if (!s.openai.apiKey) {
    throw new Error('请先在「设置」里填写 OpenAI / 中转站 API Key');
  }
  return s.openai;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

function baseURL() {
  return cfg().baseURL.replace(/\/+$/, '');
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
    let msg = `OpenAI ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

async function postForm(path, formData, { signal } = {}) {
  const c = cfg();
  const r = await fetch(withProxy(baseURL() + path), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${c.apiKey}` },
    body: formData,
    signal,
  });
  if (!r.ok) {
    let msg = `OpenAI ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

/** Vision via /v1/chat/completions（OpenAI 兼容） */
export async function reverseImage(imageDataURLs, instruction) {
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
  });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

function defaultReversePrompt() {
  return [
    '请仔细分析这张图，输出一段可以直接用于 AI 生图的英文 prompt。',
    '描述：主体外观/姿态/表情、场景、光线、构图、镜头、风格。',
    '只输出逗号分隔的关键词，不要解释。',
  ].join('\n');
}

/** 文生图 / 图生图（gpt-image-1 / gpt-image-2 / dall-e-3 等） */
export async function generateImage({ prompt, referenceImages = [], size = '1024x1024', n = 1, quality = 'high' } = {}) {
  const c = cfg();
  // 有参考图 → /images/edits（multipart） ；无参考图 → /images/generations
  if (referenceImages.length) {
    const fd = new FormData();
    fd.append('model', c.imageModel);
    fd.append('prompt', prompt);
    fd.append('n', String(n));
    fd.append('size', size);
    if (quality) fd.append('quality', quality);
    // multiple reference images: append as image[]
    for (let i = 0; i < referenceImages.length; i++) {
      const blob = dataURLtoBlob(referenceImages[i]);
      const ext = blob.type.split('/')[1] || 'png';
      fd.append('image[]', blob, `ref_${i + 1}.${ext}`);
    }
    const r = await postForm('/v1/images/edits', fd);
    return parseImagesResp(r);
  } else {
    const body = {
      model: c.imageModel,
      prompt, n, size,
    };
    if (quality) body.quality = quality;
    const r = await postJSON('/v1/images/generations', body);
    return parseImagesResp(r);
  }
}

/** 图像编辑（同 generateImage 的 edits 路径） */
export async function editImage({ prompt, images = [], size = '1024x1024', n = 1 } = {}) {
  return generateImage({ prompt, referenceImages: images, size, n });
}

/** OpenAI 暂不在标准 API 里直接提供视频，抛错让上层路由到其他服务商 */
export async function generateVideo() {
  throw new Error('OpenAI 通道暂未提供视频生成，请改用火山方舟或 fal.ai');
}

function parseImagesResp(r) {
  const data = r.data || [];
  const images = data.map(x => {
    if (x.b64_json) {
      // gpt-image 默认返 base64
      return `data:image/png;base64,${x.b64_json}`;
    }
    return x.url; // dall-e 兼容
  }).filter(Boolean);
  if (!images.length) throw new Error('OpenAI 未返回图像：' + JSON.stringify(r));
  return { images, raw: r };
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

export const meta = {
  name: 'OpenAI / 中转站',
  signupUrl: 'https://platform.openai.com/api-keys',
  capabilities: ['vision', 'image', 'edit'],
};
