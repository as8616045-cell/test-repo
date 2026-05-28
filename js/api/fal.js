// js/api/fal.js — fal.ai adapter (Flux Kontext / Kling 等多模型聚合)
// Docs: https://docs.fal.ai/

import { loadSettings } from '../settings.js';
import { sleep } from '../utils.js';

const QUEUE = 'https://queue.fal.run';

function cfg() {
  const s = loadSettings();
  if (!s.fal.apiKey) {
    throw new Error('请先在「设置」里填写 fal.ai API Key');
  }
  return s.fal;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

function authHeaders() {
  const c = cfg();
  return {
    'Authorization': `Key ${c.apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** 提交任务到 fal queue 并轮询 */
async function runFalModel(modelPath, input, { onProgress, signal } = {}) {
  // submit
  const submitUrl = withProxy(`${QUEUE}/${modelPath}`);
  const sub = await fetch(submitUrl, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
    signal,
  });
  if (!sub.ok) {
    let msg = `fal.ai ${sub.status}`;
    try { const j = await sub.json(); msg += ': ' + JSON.stringify(j); }
    catch { msg += ': ' + await sub.text().catch(() => ''); }
    throw new Error(msg);
  }
  const subJson = await sub.json();
  const requestId = subJson.request_id;
  if (!requestId) throw new Error('fal.ai 提交未返回 request_id');

  // poll status
  const statusUrl = withProxy(`${QUEUE}/${modelPath}/requests/${requestId}/status`);
  const resultUrl = withProxy(`${QUEUE}/${modelPath}/requests/${requestId}`);
  for (let i = 0; i < 300; i++) {
    if (signal?.aborted) throw new Error('用户取消');
    await sleep(2000);
    const r = await fetch(statusUrl, { headers: authHeaders() });
    if (!r.ok) continue;
    const j = await r.json();
    onProgress?.(j.status, j);
    if (j.status === 'COMPLETED') break;
    if (j.status === 'FAILED' || j.status === 'CANCELLED') {
      throw new Error('fal.ai 任务失败：' + JSON.stringify(j));
    }
  }
  // fetch result
  const resp = await fetch(resultUrl, { headers: authHeaders() });
  if (!resp.ok) throw new Error('fal.ai 取结果失败：' + resp.status);
  return resp.json();
}

/** fal.ai 不擅长反推提示词（一般要用 LLaVA/Florence 等模型，模型路径不固定），暂不实现 */
export async function reverseImage() {
  throw new Error('fal.ai 适配器暂未实现反推提示词，请改用火山方舟或 Gemini');
}

/**
 * 文生图：默认走 Flux Pro Kontext（也可在设置改成其他模型路径）
 * Flux Kontext 同时支持纯文本和 image+text，是"保留主体改其他"的强项。
 */
export async function generateImage({ prompt, referenceImages = [], aspectRatio = '1:1' } = {}, opts = {}) {
  const c = cfg();
  const input = { prompt, aspect_ratio: aspectRatio };
  if (referenceImages.length) {
    // Flux Kontext 接受 image_url（单图）；多图请自行选支持模型
    input.image_url = referenceImages[0];
  }
  const r = await runFalModel(c.fluxKontextModel, input, opts);
  const images = (r.images || r.data?.images || []).map(x => x.url || x).filter(Boolean);
  if (!images.length) throw new Error('fal.ai 未返回图像：' + JSON.stringify(r));
  return { images, raw: r };
}

/** 编辑：同 generateImage（带参考图） */
export async function editImage({ prompt, images = [] } = {}, opts = {}) {
  return generateImage({ prompt, referenceImages: images }, opts);
}

/**
 * 视频：默认走 Kling v2 master image-to-video
 */
export async function generateVideo({ prompt, image, duration = 5 } = {}, opts = {}) {
  const c = cfg();
  if (!image) throw new Error('Kling i2v 需要一张起始图');
  const input = { prompt, image_url: image, duration: String(duration) };
  const r = await runFalModel(c.klingModel, input, opts);
  const videoUrl = r.video?.url || r.data?.video?.url;
  if (!videoUrl) throw new Error('fal.ai 未返回视频：' + JSON.stringify(r));
  return { videoUrl, raw: r };
}

export const meta = {
  name: 'fal.ai',
  signupUrl: 'https://fal.ai/dashboard/keys',
  capabilities: ['image', 'edit', 'video'],
};
