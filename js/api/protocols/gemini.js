// js/api/protocols/gemini.js — Google Gemini 原生协议
// 接口形态：POST {baseURL}/models/{model}:generateContent?key={apiKey}
// contents[].parts 用 inline_data + text 构造多模态消息。
// 视频暂不支持（Veo 接口未开放）。

import { loadSettings } from '../../settings.js';

function withProxy(url) {
  const p = (loadSettings().corsProxy || '').replace(/\/+$/, '');
  return p ? p + '/' + url : url;
}

function inlinePart(dataURL) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataURL);
  if (!m) throw new Error('Gemini 协议要求图像为 base64 dataURL');
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

async function generateContent(endpoint, model, contents, generationConfig = {}, { signal } = {}) {
  const base = (endpoint.baseURL || '').replace(/\/+$/, '');
  const url = withProxy(`${base}/models/${model}:generateContent?key=${encodeURIComponent(endpoint.apiKey)}`);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig }),
    signal,
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

function defaultReversePrompt() {
  return [
    'Analyze this image and produce a single-line English prompt suitable for AI image generation.',
    'Cover: subject (person/product), appearance, pose, lighting, scene, composition, camera, style.',
    'Output only comma-separated keywords. No explanation, no quotes.',
  ].join(' ');
}

export async function reverseImage(endpoint, model, imageDataURLs, instruction, { signal } = {}) {
  const imgs = Array.isArray(imageDataURLs) ? imageDataURLs : [imageDataURLs];
  const parts = [
    ...imgs.map(inlinePart),
    { text: instruction || defaultReversePrompt() },
  ];
  const r = await generateContent(endpoint, model, [{ role: 'user', parts }], { temperature: 0.4 }, { signal });
  const out = r.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  return out.trim();
}

export async function chatText(endpoint, model, text, { signal } = {}) {
  const r = await generateContent(endpoint, model, [
    { role: 'user', parts: [{ text }] },
  ], { temperature: 0.6 }, { signal });
  return (r.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '').trim();
}

export async function generateImage(endpoint, model, opts = {}, { signal } = {}) {
  const { prompt, referenceImages = [] } = opts;
  const parts = [
    ...referenceImages.map(inlinePart),
    { text: prompt },
  ];
  const r = await generateContent(endpoint, model, [{ role: 'user', parts }], {
    responseModalities: ['IMAGE', 'TEXT'],
  }, { signal });
  const cand = r.candidates?.[0]?.content?.parts || [];
  const images = [];
  for (const p of cand) {
    const d = p.inline_data || p.inlineData;
    if (d) images.push(`data:${d.mime_type || d.mimeType};base64,${d.data}`);
  }
  if (!images.length) {
    const text = cand.find(p => p.text)?.text || '';
    throw new Error('Gemini 未返回图像。返回文本：' + text);
  }
  return { images, raw: r };
}

export async function editImage(endpoint, model, opts = {}, runOpts = {}) {
  return generateImage(endpoint, model, {
    prompt: opts.prompt,
    referenceImages: opts.images || [],
  }, runOpts);
}

export async function generateVideo() {
  throw new Error('Gemini 协议暂不支持视频生成（Veo 未开放给所有 Key）');
}

export const meta = {
  name: 'Google Gemini',
  capabilities: ['vision', 'chat', 'image', 'edit'],

  async ping(endpoint) {
    if (!endpoint.apiKey) throw new Error('未填 API Key');
    const t0 = performance.now();
    const base = (endpoint.baseURL || '').replace(/\/+$/, '');
    const url = withProxy(`${base}/models?key=${encodeURIComponent(endpoint.apiKey)}`);
    const r = await fetch(url, { method: 'GET' });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        msg += ' — ' + (j?.error?.message || '');
      } catch {}
      throw new Error(msg);
    }
    let count = '?';
    try {
      const j = await r.json();
      if (Array.isArray(j?.models)) count = String(j.models.length);
    } catch {}
    return `OK ${ms}ms · ${count} 模型`;
  },
};
