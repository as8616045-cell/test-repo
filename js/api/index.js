// js/api/index.js — v4 unified API router
//
// 架构：
//   3 个协议层（protocols/openai.js / gemini.js / fal.js）—— 纯函数，接 endpoint 参数
//   端点 + 能力指派从 settings 读
//   detectProtocol(endpoint) 按 baseURL 自动识别协议（支持手动覆盖）
//
// 调用形态：
//   API.reverseImage(images, instr, override?, runOpts?)
//   API.rewritePrompt(text,           override?, customInstr?, runOpts?)
//   API.generateImage(opts,           override?, runOpts?)
//   API.editImage(opts,               override?, runOpts?)
//   API.generateVideo(opts,           override?, runOpts?)
//
// override = undefined         → 用 settings.capabilities[cap]
// override = { endpointId, model? } → 临时切换端点（model 不传则用默认能力的 model）

import * as openaiP from './protocols/openai.js';
import * as geminiP from './protocols/gemini.js';
import * as falP    from './protocols/fal.js';
import { loadSettings, getEndpoint } from '../settings.js';

const PROTOCOLS = {
  openai: openaiP,
  gemini: geminiP,
  fal:    falP,
};

/* ───────────────── protocol detection ───────────────── */

export function detectProtocol(endpoint) {
  if (!endpoint) return 'openai';
  if (endpoint.protocol && endpoint.protocol !== 'auto') {
    return endpoint.protocol;
  }
  const url = (endpoint.baseURL || '').toLowerCase();
  if (/generativelanguage\.googleapis\.com/.test(url)) return 'gemini';
  if (/queue\.fal\.run|fal\.ai|fal\.run/.test(url)) return 'fal';
  return 'openai'; // 默认 OpenAI 兼容（OpenAI官方 / DeepSeek / SiliconFlow / 火山方舟 / OneAPI / NewAPI / 任意中转站）
}

export function getProtocol(endpoint) {
  return PROTOCOLS[detectProtocol(endpoint)];
}

/* ───────────────── capability resolver ───────────────── */

function resolve(capability, override) {
  const s = loadSettings();
  const cap = s.capabilities?.[capability];
  if (!cap) throw new Error(`未知能力 "${capability}"`);

  const endpointId = override?.endpointId || cap.endpointId;
  const model = override?.model || cap.model;

  const endpoint = s.endpoints.find(e => e.id === endpointId);
  if (!endpoint) {
    throw new Error(`未找到端点 "${endpointId}"。请到「设置」检查能力指派`);
  }
  if (!endpoint.apiKey) {
    throw new Error(`端点「${endpoint.name}」还没填 API Key`);
  }
  const proto = getProtocol(endpoint);
  if (!proto) {
    throw new Error(`端点「${endpoint.name}」无法识别协议`);
  }
  if (!proto.meta.capabilities.includes(capability)) {
    throw new Error(`端点「${endpoint.name}」（${proto.meta.name}）不支持「${capability}」能力`);
  }
  if (!model) {
    throw new Error(`能力「${capability}」未指定模型，请到「设置」填写`);
  }
  return { endpoint, model, proto };
}

/* ───────────────── public API ───────────────── */

/** 反推提示词（vision） */
export async function reverseImage(imageDataURLs, instruction, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('vision', override);
  const text = await proto.reverseImage(endpoint, model, imageDataURLs, instruction, runOpts);
  return { provider: endpoint.name, text };
}

/** 改写润色（chat） */
export async function rewritePrompt(originalPrompt, override, customInstruction, runOpts = {}) {
  const { endpoint, model, proto } = resolve('chat', override);
  const instruction = customInstruction || [
    '你是一名 AI 生图 prompt 工程师。',
    '请把下面这段 prompt 改写得更具体、更有画面感（增加镜头、光线、材质、构图等细节），',
    '保留原意不要扩张主题。输出英文 prompt（逗号分隔的关键词形式），不要解释、不要前后缀。',
    '',
    '原 prompt：',
    originalPrompt,
  ].join('\n');
  const text = await proto.chatText(endpoint, model, instruction, runOpts);
  return { provider: endpoint.name, text };
}

/** 生图 */
export async function generateImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('image', override);
  const r = await proto.generateImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/** 图像编辑 */
export async function editImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('edit', override);
  const r = await proto.editImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/** 视频生成 */
export async function generateVideo(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('video', override);
  const r = await proto.generateVideo(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/* ───────────────── helpers for UI ───────────────── */

/** 列出支持指定能力的所有端点（用于工作流的 endpointSelect 和设置页能力指派下拉） */
export function endpointsFor(capability) {
  const s = loadSettings();
  return s.endpoints.filter(ep => {
    const proto = getProtocol(ep);
    return proto?.meta?.capabilities?.includes(capability);
  });
}

/** 测试连通性 */
export async function pingEndpoint(endpoint) {
  const ep = typeof endpoint === 'string' ? getEndpoint(endpoint) : endpoint;
  if (!ep) throw new Error('端点不存在');
  const proto = getProtocol(ep);
  if (!proto?.meta?.ping) throw new Error('该协议不支持连通性测试');
  return proto.meta.ping(ep);
}

/** 给定端点列出协议名称（UI 用） */
export function protocolName(endpoint) {
  return getProtocol(endpoint)?.meta?.name || 'Unknown';
}
