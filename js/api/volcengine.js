// js/api/volcengine.js — 火山方舟 (Volcengine Ark) adapter
// Models: 豆包视觉 (vision) / 即梦 4.0 Seedream (image) / Seedance (video)
// Docs:   https://www.volcengine.com/docs/82379

import { loadSettings } from '../settings.js';
import { stripDataURL, sleep } from '../utils.js';

const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

function cfg() {
  const s = loadSettings();
  if (!s.volcengine.apiKey) {
    throw new Error('请先在「设置」里填写火山方舟 API Key');
  }
  return s.volcengine;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

async function http(path, body, { signal } = {}) {
  const c = cfg();
  const url = withProxy(BASE + path);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let msg = `Volcengine ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

/**
 * 反推提示词 / 图像理解（豆包视觉）
 * @param {string|string[]} imageDataURLs - 一张或多张 dataURL / http URL
 * @param {string} instruction - 自定义指令
 * @returns {Promise<string>}
 */
export async function reverseImage(imageDataURLs, instruction) {
  const c = cfg();
  const imgs = Array.isArray(imageDataURLs) ? imageDataURLs : [imageDataURLs];
  const content = [
    ...imgs.map(url => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: instruction || defaultReversePrompt() },
  ];
  const r = await http('/chat/completions', {
    model: c.visionModel,
    messages: [{ role: 'user', content }],
    temperature: 0.4,
  });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

function defaultReversePrompt() {
  return [
    '请仔细分析这张图，输出一段可以直接用于 AI 生图的英文提示词 (prompt)。',
    '要求：',
    '1. 描述主体（人物/产品）的外观、材质、姿态、表情',
    '2. 描述场景、光线、构图、镜头',
    '3. 描述风格（摄影/插画/3D 等）',
    '4. 用逗号分隔的关键词形式输出，不要解释',
    '只输出 prompt 本身，不要任何前后缀。',
  ].join('\n');
}

/**
 * 文生图 / 参考图生图（即梦 4.0 Seedream）
 * 即梦 4.0 同时支持纯文本和 image+text。
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string[]} [opts.referenceImages] - dataURL or http URLs (用于一致性、参考图)
 * @param {string} [opts.size] - e.g. '1024x1024', '1024x1792'
 * @param {number} [opts.n]
 * @returns {Promise<{images: string[]}>} images are http URLs
 */
export async function generateImage({ prompt, referenceImages = [], size = '1024x1024', n = 1 } = {}) {
  const c = cfg();
  const body = {
    model: c.imageModel,
    prompt,
    size,
    n,
    response_format: 'url',
  };
  if (referenceImages.length) {
    // 即梦 4.0 接受 image 字段，可为 string 或 string[]
    body.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
    body.sequential_image_generation = 'disabled';
  }
  const r = await http('/images/generations', body);
  const urls = (r.data || []).map(d => d.url).filter(Boolean);
  return { images: urls, raw: r };
}

/**
 * 图像编辑（用即梦 4.0 同接口完成"换产品 / 换背景"）。
 * 这是 Seedream 4.0 的「图像编辑」能力 —— 把多张图作为参考喂入 + 自然语言指令。
 */
export async function editImage({ prompt, images = [], size = '1024x1024' } = {}) {
  return generateImage({ prompt, referenceImages: images, size, n: 1 });
}

/**
 * 生视频（Seedance / 可灵 视火山方舟模型而定）
 * 异步任务：提交 -> 轮询。
 */
export async function generateVideo({ prompt, image, duration = 5, ratio = '16:9' } = {}, { onProgress, signal } = {}) {
  const c = cfg();
  const submit = await http('/contents/generations/tasks', {
    model: c.videoModel,
    content: [
      { type: 'text', text: `${prompt} --rt ${ratio} --dur ${duration}` },
      ...(image ? [{ type: 'image_url', image_url: { url: image } }] : []),
    ],
  }, { signal });
  const taskId = submit.id;
  if (!taskId) throw new Error('提交视频任务失败：未返回 id');
  // poll
  for (let i = 0; i < 120; i++) {
    if (signal?.aborted) throw new Error('用户取消');
    await sleep(5000);
    const t = await getVideoTask(taskId);
    onProgress?.(t.status, t);
    if (t.status === 'succeeded') {
      const url = t.content?.video_url || t.content?.url;
      if (!url) throw new Error('任务完成但未返回视频 URL');
      return { videoUrl: url, raw: t };
    }
    if (t.status === 'failed' || t.status === 'cancelled') {
      throw new Error('视频任务失败：' + (t.failure_reason || t.status));
    }
  }
  throw new Error('视频任务超时');
}

async function getVideoTask(id) {
  const c = cfg();
  const url = withProxy(`${BASE}/contents/generations/tasks/${id}`);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${c.apiKey}` } });
  if (!r.ok) throw new Error('查询视频任务失败：' + r.status);
  return r.json();
}

export const meta = {
  name: '火山方舟 (Volcengine)',
  signupUrl: 'https://www.volcengine.com/product/ark',
  capabilities: ['vision', 'image', 'edit', 'video'],
};
