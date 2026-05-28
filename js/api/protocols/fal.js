// js/api/protocols/fal.js — fal.ai 异步队列协议
// fal 不是 OpenAI 兼容也不是 Gemini，自成一派：
//   POST  {baseURL}/{model}                               -> 提交任务，返回 request_id
//   GET   {baseURL}/{model}/requests/{id}/status          -> 查任务状态
//   GET   {baseURL}/{model}/requests/{id}                 -> 取结果
//
// 模型路径由调用方传入（capabilities[*].model 字段保存），
// 例：'fal-ai/flux-pro/kontext'、'fal-ai/kling-video/v2/master/image-to-video'
//
// fal 没有 chat 也没有可靠的 vision；本协议只声明 image / edit / video 能力。

import { sleep } from '../../utils.js';
import { loadSettings } from '../../settings.js';

function withProxy(url) {
  const p = (loadSettings().corsProxy || '').replace(/\/+$/, '');
  return p ? p + '/' + url : url;
}

function authHeaders(endpoint) {
  return {
    'Authorization': `Key ${endpoint.apiKey}`,
    'Content-Type': 'application/json',
  };
}

function normBase(endpoint) {
  return (endpoint.baseURL || 'https://queue.fal.run').replace(/\/+$/, '');
}

async function runFalModel(endpoint, modelPath, input, { onProgress, signal } = {}) {
  const base = normBase(endpoint);
  // 提交
  const submitUrl = withProxy(`${base}/${modelPath}`);
  const sub = await fetch(submitUrl, {
    method: 'POST',
    headers: authHeaders(endpoint),
    body: JSON.stringify(input),
    signal,
  });
  if (!sub.ok) {
    let msg = `${sub.status}`;
    try { const j = await sub.json(); msg += ': ' + (j?.error || JSON.stringify(j)); }
    catch { msg += ': ' + await sub.text().catch(() => ''); }
    throw new Error(msg);
  }
  const subJson = await sub.json();
  const requestId = subJson.request_id;
  if (!requestId) throw new Error('fal.ai 提交未返回 request_id');

  // 轮询
  const statusUrl = withProxy(`${base}/${modelPath}/requests/${requestId}/status`);
  const resultUrl = withProxy(`${base}/${modelPath}/requests/${requestId}`);
  for (let i = 0; i < 300; i++) {
    if (signal?.aborted) throw new Error('用户取消');
    await sleep(2000);
    const r = await fetch(statusUrl, { headers: authHeaders(endpoint) });
    if (!r.ok) continue;
    const j = await r.json();
    onProgress?.(j.status, j);
    if (j.status === 'COMPLETED') break;
    if (j.status === 'FAILED' || j.status === 'CANCELLED') {
      throw new Error('fal.ai 任务失败：' + JSON.stringify(j));
    }
  }
  // 取结果
  const resp = await fetch(resultUrl, { headers: authHeaders(endpoint) });
  if (!resp.ok) throw new Error('fal.ai 取结果失败：' + resp.status);
  return resp.json();
}

/* ───────────────── image / edit / video ───────────────── */

export async function generateImage(endpoint, model, opts = {}, runOpts = {}) {
  const { prompt, referenceImages = [], aspectRatio = '1:1' } = opts;
  if (!model) throw new Error('fal.ai 需要在能力配置里填模型路径，如 fal-ai/flux-pro/kontext');
  const input = { prompt, aspect_ratio: aspectRatio };
  if (referenceImages.length) {
    input.image_url = referenceImages[0]; // Flux Kontext 接受单张
  }
  const r = await runFalModel(endpoint, model, input, runOpts);
  const list = r.images || r.data?.images || [];
  const images = list.map(x => x.url || x).filter(Boolean);
  if (!images.length) throw new Error('fal.ai 未返回图像：' + JSON.stringify(r));
  return { images, raw: r };
}

export async function editImage(endpoint, model, opts = {}, runOpts = {}) {
  return generateImage(endpoint, model, {
    prompt: opts.prompt,
    referenceImages: opts.images || [],
    aspectRatio: opts.aspectRatio,
  }, runOpts);
}

export async function generateVideo(endpoint, model, opts = {}, runOpts = {}) {
  const { prompt, image, duration = 5 } = opts;
  if (!image) throw new Error('fal.ai i2v 需要一张起始图');
  if (!model) throw new Error('fal.ai 需要在能力配置里填模型路径');
  const input = { prompt, image_url: image, duration: String(duration) };
  const r = await runFalModel(endpoint, model, input, runOpts);
  const videoUrl = r.video?.url || r.data?.video?.url;
  if (!videoUrl) throw new Error('fal.ai 未返回视频：' + JSON.stringify(r));
  return { videoUrl, raw: r };
}

// fal 不暴露 chat / vision —— meta.capabilities 会过滤掉它在那两个下拉里出现
export async function reverseImage() {
  throw new Error('fal.ai 协议不支持视觉理解，请改用 OpenAI 兼容或 Gemini 端点');
}
export async function chatText() {
  throw new Error('fal.ai 协议不支持纯文本 LLM，请改用 OpenAI 兼容或 Gemini 端点');
}

export const meta = {
  name: 'fal.ai',
  capabilities: ['image', 'edit', 'video'],

  async ping(endpoint) {
    if (!endpoint.apiKey) throw new Error('未填 API Key');
    const t0 = performance.now();
    // fal 没有官方 healthcheck；用一个不存在的 modelPath 提交一个任务,
    // 401/403 表示鉴权失败，404 / 其他 4xx 表示鉴权通过（已能命中网关）
    const url = withProxy(`${normBase(endpoint)}/_kiro_ping_/requests/_/status`);
    const r = await fetch(url, { headers: authHeaders(endpoint) });
    const ms = Math.round(performance.now() - t0);
    if (r.status === 401 || r.status === 403) {
      throw new Error(`HTTP ${r.status} — API Key 无效`);
    }
    // 任何其他状态都算"网关连通,凭据被识别"
    return `OK ${ms}ms · 网关可达（HTTP ${r.status}）`;
  },
};
