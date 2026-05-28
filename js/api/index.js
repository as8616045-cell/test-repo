// js/api/index.js — unified API router. Picks provider from settings.

import * as volcengine from './volcengine.js';
import * as gemini from './gemini.js';
import * as fal from './fal.js';
import { loadSettings } from '../settings.js';

export const PROVIDERS = { volcengine, gemini, fal };

export const PROVIDER_LIST = [
  { id: 'volcengine', name: '火山方舟（即梦 4.0 / 豆包视觉 / Seedance）' },
  { id: 'gemini',     name: 'Google Gemini（视觉 + Nano Banana 生图）' },
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
