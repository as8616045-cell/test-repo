// js/api/gemini.js — Google Gemini adapter
// Models: gemini-2.5-flash (vision) / gemini-2.5-flash-image (Nano Banana, image gen + edit)
// Docs:   https://ai.google.dev/gemini-api/docs

import { loadSettings } from '../settings.js';
import { stripDataURL } from '../utils.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function cfg() {
  const s = loadSettings();
  if (!s.gemini.apiKey) {
    throw new Error('请先在「设置」里填写 Gemini API Key');
  }
  return s.gemini;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

function inlinePart(dataURL) {
  // dataURL = data:image/png;base64,xxx
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataURL);
  if (!m) {
    // Allow http(s) URLs via fileData (Gemini 支持 file_data with mime + uri，但跨域 fetch 后传 base64 更稳)
    throw new Error('Gemini 适配器要求图像为 base64 dataURL');
  }
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

async function generateContent(model, contents, generationConfig = {}, { signal } = {}) {
  const c = cfg();
  const url = withProxy(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(c.apiKey)}`);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig }),
    signal,
  });
  if (!r.ok) {
    let msg = `Gemini ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

/** 反推提示词 */
export async function reverseImage(imageDataURLs, instruction, { signal } = {}) {
  const c = cfg();
  const imgs = Array.isArray(imageDataURLs) ? imageDataURLs : [imageDataURLs];
  const parts = [
    ...imgs.map(inlinePart),
    { text: instruction || defaultReversePrompt() },
  ];
  const r = await generateContent(c.visionModel, [{ role: 'user', parts }], {
    temperature: 0.4,
  }, { signal });
  const out = r.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  return out.trim();
}

/** 纯文本 LLM（用于 prompt 改写等） */
export async function chatText(text, { signal } = {}) {
  const c = cfg();
  const r = await generateContent(c.visionModel, [
    { role: 'user', parts: [{ text }] },
  ], { temperature: 0.6 }, { signal });
  return (r.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '').trim();
}

function defaultReversePrompt() {
  return [
    'Analyze this image and produce a single-line English prompt suitable for AI image generation.',
    'Cover: subject (person/product), appearance, pose, lighting, scene, composition, camera, style.',
    'Output only comma-separated keywords. No explanation, no quotes.',
  ].join(' ');
}

/**
 * 文生图 / 参考图生图（Nano Banana - gemini-2.5-flash-image）
 * Nano Banana 支持把多张图作为参考喂入，然后给指令。
 */
export async function generateImage({ prompt, referenceImages = [] } = {}, { signal } = {}) {
  const c = cfg();
  const parts = [
    ...referenceImages.map(inlinePart),
    { text: prompt },
  ];
  const r = await generateContent(c.imageModel, [{ role: 'user', parts }], {
    responseModalities: ['IMAGE', 'TEXT'],
  }, { signal });
  const cand = r.candidates?.[0]?.content?.parts || [];
  const images = [];
  for (const p of cand) {
    if (p.inline_data || p.inlineData) {
      const d = p.inline_data || p.inlineData;
      images.push(`data:${d.mime_type || d.mimeType};base64,${d.data}`);
    }
  }
  if (!images.length) {
    const text = cand.find(p => p.text)?.text || '';
    throw new Error('Gemini 未返回图像。返回文本：' + text);
  }
  return { images, raw: r };
}

/** 图像编辑：复用 generateImage（Nano Banana 同一接口） */
export async function editImage({ prompt, images = [] } = {}, { signal } = {}) {
  return generateImage({ prompt, referenceImages: images }, { signal });
}

/** Gemini 暂未提供视频生成（Veo 暂未对所有 Key 开放），抛错让上层选其他家 */
export async function generateVideo() {
  throw new Error('Gemini 适配器暂未实现视频生成，请改用火山方舟或 fal.ai');
}

export const meta = {
  name: 'Google Gemini',
  signupUrl: 'https://aistudio.google.com/app/apikey',
  capabilities: ['vision', 'image', 'edit', 'chat'],
};
