// js/api/index.js — unified API router. Picks provider from settings.
// Each adapter exposes:
//   reverseImage(imageDataURLs, instruction, { signal })   [requires meta.capabilities.includes('vision')]
//   chatText(text, { signal })                              [requires 'chat']
//   generateImage({ prompt, referenceImages, size, n }, { signal })  [requires 'image']
//   editImage({ prompt, images, size, n }, { signal })      [requires 'edit']
//   generateVideo({ prompt, image, ... }, { signal, onProgress })  [requires 'video']
//   meta = { name, signupUrl, capabilities: [...] }

import * as volcengine from './volcengine.js';
import * as gemini from './gemini.js';
import * as fal from './fal.js';
import * as openai from './openai.js';
import * as deepseek from './deepseek.js';
import * as siliconflow from './siliconflow.js';
import { loadSettings } from '../settings.js';

export const PROVIDERS = { volcengine, gemini, fal, openai, deepseek, siliconflow };

export const PROVIDER_LIST = [
  { id: 'volcengine',  name: '火山方舟（即梦 4.0 / 豆包视觉 / Seedance）' },
  { id: 'siliconflow', name: '硅基流动（DeepSeek / Qwen-VL / Kolors / Flux 等聚合）' },
  { id: 'openai',      name: 'OpenAI / 中转站（gpt-image / dall-e）' },
  { id: 'gemini',      name: 'Google Gemini（视觉 + Nano Banana）' },
  { id: 'deepseek',    name: 'DeepSeek（仅文本改写润色）' },
  { id: 'fal',         name: 'fal.ai（Flux Kontext / Kling 等）' },
];

/** List providers that support a given capability. Used by providerSelect to filter. */
export function providersFor(capability) {
  return PROVIDER_LIST.filter(p => {
    const caps = PROVIDERS[p.id]?.meta?.capabilities || [];
    return caps.includes(capability);
  });
}

function pick(capability, override) {
  const s = loadSettings();
  let id = override || s.preferred[capability];
  let p = PROVIDERS[id];
  // If chosen provider doesn't support this capability, fall back to the first one that does.
  const caps = p?.meta?.capabilities || [];
  if (!p || !caps.includes(capability)) {
    const fallback = providersFor(capability)[0];
    if (!fallback) throw new Error(`没有任何服务商支持 "${capability}" 能力`);
    id = fallback.id;
    p = PROVIDERS[id];
  }
  return { id, p };
}

/** 反推提示词 */
export async function reverseImage(imageDataURLs, instruction, providerId, runOpts = {}) {
  const { id, p } = pick('vision', providerId);
  return { provider: id, text: await p.reverseImage(imageDataURLs, instruction, runOpts) };
}

/** LLM 文本改写（纯文本，不需要传图） */
export async function rewritePrompt(originalPrompt, providerId, customInstruction, runOpts = {}) {
  const { id, p } = pick('chat', providerId);
  if (!p.chatText) throw new Error(`服务商 ${id} 不支持文本改写`);
  const instruction = customInstruction || [
    '你是一名 AI 生图 prompt 工程师。',
    '请把下面这段 prompt 改写得更具体、更有画面感（增加镜头、光线、材质、构图等细节），',
    '保留原意不要扩张主题。输出英文 prompt（逗号分隔的关键词形式），不要解释、不要前后缀。',
    '',
    '原 prompt：',
    originalPrompt,
  ].join('\n');
  return { provider: id, text: await p.chatText(instruction, runOpts) };
}

/** 生图（文/图生图，统一入口；adapter 内部根据 referenceImages 是否非空切换路径） */
export async function generateImage(opts, providerId, runOpts = {}) {
  const { id, p } = pick('image', providerId);
  const r = await p.generateImage(opts, runOpts);
  return { provider: id, ...r };
}

/** 图像编辑（多图参考 + 自然语言指令） */
export async function editImage(opts, providerId, runOpts = {}) {
  const { id, p } = pick('edit', providerId);
  const r = await p.editImage(opts, runOpts);
  return { provider: id, ...r };
}

/** 视频生成 */
export async function generateVideo(opts, providerId, runOpts = {}) {
  const { id, p } = pick('video', providerId);
  const r = await p.generateVideo(opts, runOpts);
  return { provider: id, ...r };
}
