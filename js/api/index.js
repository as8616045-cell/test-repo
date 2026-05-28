// js/api/index.js — unified API router. Picks provider from settings.

import * as volcengine from './volcengine.js';
import * as gemini from './gemini.js';
import * as fal from './fal.js';
import * as openai from './openai.js';
import { loadSettings } from '../settings.js';

export const PROVIDERS = { volcengine, gemini, fal, openai };

export const PROVIDER_LIST = [
  { id: 'volcengine', name: '火山方舟（即梦 4.0 / 豆包视觉 / Seedance）' },
  { id: 'openai',     name: 'OpenAI / 中转站（gpt-image-1/2、dall-e）' },
  { id: 'gemini',     name: 'Google Gemini（视觉 + Nano Banana）' },
  { id: 'fal',        name: 'fal.ai（Flux Kontext / Kling 等）' },
];

function pick(capability, override) {
  const s = loadSettings();
  const id = override || s.preferred[capability];
  const p = PROVIDERS[id];
  if (!p) throw new Error(`未知服务商：${id}`);
  return { id, p };
}

/** 反推提示词 */
export async function reverseImage(imageDataURLs, instruction, providerId) {
  const { id, p } = pick('vision', providerId);
  if (!p.reverseImage) throw new Error(`服务商 ${id} 不支持反推`);
  return { provider: id, text: await p.reverseImage(imageDataURLs, instruction) };
}

/** LLM 文本改写（用视觉/聊天模型当文本 LLM） */
export async function rewritePrompt(originalPrompt, providerId, customInstruction) {
  const { id, p } = pick('vision', providerId);
  if (!p.reverseImage) throw new Error(`服务商 ${id} 不支持文本改写`);
  // 复用 reverseImage 的 vision endpoint，但传一张占位图会出错；改为用 chat completions 风格
  // 取巧：把空图省掉，直接走 chat 文本路径 — 各家适配器需要支持
  // 简化方案：用 generateContent / chat 直接调
  const instruction = customInstruction || `请把下面这段中文/英文 AI 生图 prompt 改写得更具体、更有画面感，输出英文 prompt（逗号分隔的关键词形式），保留原意，不要解释：\n\n${originalPrompt}`;
  // hack: pass a tiny 1x1 transparent PNG when adapter requires image — just skip and call provider's chat directly
  return { provider: id, text: await rewriteViaChat(p, instruction) };
}

async function rewriteViaChat(adapter, instruction) {
  // We piggy-back on reverseImage but tell the model there is no image.
  // Adapters that strictly require images will fail; in practice volcengine/openai/gemini accept text-only.
  // For volcengine and openai it's OpenAI-style chat; we send a fake call that pure text works on chat.completions.
  // Each adapter MAY expose a `chatText` later; for now reuse with an empty-ish data URL.
  const transparent1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  return adapter.reverseImage(transparent1x1, instruction);
}

/** 生图 */
export async function generateImage(opts, providerId) {
  const { id, p } = pick('image', providerId);
  if (!p.generateImage) throw new Error(`服务商 ${id} 不支持生图`);
  const r = await p.generateImage(opts);
  return { provider: id, ...r };
}

/** 编辑（换产品/换背景） */
export async function editImage(opts, providerId) {
  const { id, p } = pick('edit', providerId);
  if (!p.editImage) throw new Error(`服务商 ${id} 不支持图像编辑`);
  const r = await p.editImage(opts);
  return { provider: id, ...r };
}

/** 生视频 */
export async function generateVideo(opts, providerId, runOpts) {
  const { id, p } = pick('video', providerId);
  if (!p.generateVideo) throw new Error(`服务商 ${id} 不支持生视频`);
  const r = await p.generateVideo(opts, runOpts);
  return { provider: id, ...r };
}
