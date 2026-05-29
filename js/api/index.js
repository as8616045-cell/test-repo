// js/api/index.js — v4 unified API router (2-bucket model: llm + image)
//
// 架构:
//   3 个协议层（protocols/openai.js / gemini.js / fal.js）—— 纯函数,接 endpoint 参数
//   端点 + 能力指派从 settings 读
//   detectProtocol(endpoint) 按 baseURL 自动识别协议（支持手动覆盖）
//
// 用户只填 baseURL + apiKey,系统自动识别厂商和协议。
// 能力简化为 2 个桶:
//   - llm   桶 -> 处理 vision（反推）+ chat（改写）
//   - image 桶 -> 处理 image（生图）+ edit（编辑）+ video（视频）
//
// 调用形态:
//   API.reverseImage(images, instr, override?, runOpts?)
//   API.rewritePrompt(text,           override?, customInstr?, runOpts?)
//   API.generateImage(opts,           override?, runOpts?)
//   API.editImage(opts,               override?, runOpts?)
//   API.generateVideo(opts,           override?, runOpts?)
//
// override = undefined         -> 用 settings.capabilities[bucket]
// override = { endpointId, model? } -> 临时切换端点（model 不传则用默认能力的 model）

import * as openaiP from './protocols/openai.js';
import * as geminiP from './protocols/gemini.js';
import * as falP    from './protocols/fal.js';
import { loadSettings, getEndpoint, BUCKETS, CAPABILITY_TO_BUCKET } from '../settings.js';

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
  return 'openai'; // 默认 OpenAI 兼容
}

export function getProtocol(endpoint) {
  return PROTOCOLS[detectProtocol(endpoint)];
}

/* ───────────────── capability resolver ───────────────── */

export function bucketFor(capability) {
  return CAPABILITY_TO_BUCKET[capability] || 'llm';
}

function resolve(capability, override) {
  const bucket = bucketFor(capability);
  const s = loadSettings();
  const cap = s.capabilities?.[bucket] || { endpointId: '', model: '' };

  const endpointId = override?.endpointId || cap.endpointId;
  const model = override?.model || cap.model;

  if (!endpointId) {
    throw new Error(`「${bucketLabel(bucket)}」还没指派端点。请到设置页添加一个 API,然后在「能力指派」里选定它。`);
  }
  const endpoint = s.endpoints.find(e => e.id === endpointId);
  if (!endpoint) {
    throw new Error(`未找到端点「${endpointId}」。请到设置页检查能力指派。`);
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
    throw new Error(`「${bucketLabel(bucket)}」桶未填模型,请到设置页填写`);
  }
  return { endpoint, model, proto };
}

function bucketLabel(bucket) {
  return ({ llm: '💬 LLM', image: '🖼️ 图片' })[bucket] || bucket;
}

/* ───────────────── public API ───────────────── */

/** 反推提示词（vision -> llm 桶） */
export async function reverseImage(imageDataURLs, instruction, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('vision', override);
  const text = await proto.reverseImage(endpoint, model, imageDataURLs, instruction, runOpts);
  return { provider: endpoint.name, text };
}

/** 改写润色（chat -> llm 桶） */
export async function rewritePrompt(originalPrompt, override, customInstruction, runOpts = {}) {
  const { endpoint, model, proto } = resolve('chat', override);
  const instruction = customInstruction || [
    '你是一名 AI 生图 prompt 工程师。',
    '请把下面这段 prompt 改写得更具体、更有画面感（增加镜头、光线、材质、构图等细节）,',
    '保留原意不要扩张主题。输出英文 prompt（逗号分隔的关键词形式）,不要解释、不要前后缀。',
    '',
    '原 prompt:',
    originalPrompt,
  ].join('\n');
  const text = await proto.chatText(endpoint, model, instruction, runOpts);
  return { provider: endpoint.name, text };
}

/** 生图（image -> 图片桶） */
export async function generateImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('image', override);
  const r = await proto.generateImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/** 图像编辑（edit -> 图片桶） */
export async function editImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('edit', override);
  const r = await proto.editImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/** 视频生成（video -> 图片桶,复用同一端点） */
export async function generateVideo(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('video', override);
  const r = await proto.generateVideo(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

/* ───────────────── helpers for UI ───────────────── */

/**
 * 列出可用于指定桶的所有端点。
 *   - 'llm' 桶: 协议必须支持 chat 或 vision 中的至少一个
 *   - 'image' 桶: 协议必须支持 image / edit / video 中的至少一个
 *
 * 也接受 fine-grained capability 名称（'vision'/'chat'/'image'/'edit'/'video'）,
 * 那时直接按协议是否声明该 capability 过滤。
 */
export function endpointsFor(bucketOrCapability) {
  const s = loadSettings();
  const isBucket = BUCKETS.includes(bucketOrCapability);
  const wantedCaps = isBucket
    ? (bucketOrCapability === 'llm' ? ['chat', 'vision'] : ['image', 'edit', 'video'])
    : [bucketOrCapability];

  return s.endpoints.filter(ep => {
    const proto = getProtocol(ep);
    if (!proto?.meta?.capabilities) return false;
    return wantedCaps.some(c => proto.meta.capabilities.includes(c));
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

/**
 * 列出端点上真实可用的模型列表。
 *
 * - OpenAI 兼容: 走 GET /v1/models（OpenAI / DeepSeek / SiliconFlow /
 *   火山方舟 / OneAPI / NewAPI / 任何中转站都支持）
 * - Gemini: 走 GET /models?key=...
 * - fal.ai: 没有公开的 listing API,返回空
 *
 * 失败时抛错;连不上 / Key 无效 / 协议不支持时由调用方捕获。
 * 返回 [{ id, name }, ...]。
 */
export async function listEndpointModels(endpoint) {
  if (!endpoint?.baseURL || !endpoint?.apiKey) return [];
  const proto = getProtocol(endpoint);
  if (!proto?.listModels) return [];
  return proto.listModels(endpoint);
}

/**
 * 给定真实模型列表 + 桶类型, 用一组优先级正则挑出最合适的模型。
 *
 * - LLM 桶: 优先选 vision-capable 的 chat 模型(反推需要看图)
 * - 图片桶: 优先选明确的图像生成模型
 *
 * 找不到匹配时返回 null —— 调用方决定 fallback (可能给 list[0] 或保留旧值)。
 */
export function pickModelForBucket(modelList, bucket) {
  const ids = modelList.map(m => m.id);
  // 多模型按 id 匹配;返回第一个匹配的真实 id
  const find = (patterns) => {
    for (const p of patterns) {
      const id = ids.find(x => p.test(x));
      if (id) return id;
    }
    return null;
  };

  if (bucket === 'llm') {
    return find([
      // 火山方舟 vision 模型
      /doubao.*vision/i, /seed.*vision/i, /seed-1-6-vision/i,
      // OpenAI vision-capable
      /^gpt-4o(?!-mini)/i, /^gpt-4-turbo/i, /^gpt-4o/i,
      // Anthropic
      /claude.*opus/i, /claude.*sonnet/i, /claude.*haiku/i, /claude/i,
      // Google
      /gemini.*pro/i, /gemini.*flash/i, /gemini/i,
      // Qwen VL
      /qwen.*vl/i, /qwen2.*vl/i,
      // 其他通用 vision 关键词
      /vision/i, /vl-\d/i, /-vl$/i,
    ]);
  }
  if (bucket === 'image') {
    return find([
      // 火山方舟 seedream / 即梦
      /seedream/i, /doubao.*image/i, /seed.*image/i,
      // OpenAI
      /^gpt-image/i, /dall-e-3/i, /dall-e/i,
      // Google Imagen
      /imagen/i, /gemini.*image/i,
      // SiliconFlow
      /kolors/i,
      // Flux / Stable Diffusion
      /flux.*pro/i, /flux/i, /sd3/i, /sdxl/i, /stable.*diffusion/i,
    ]);
  }
  return null;
}

/** 给定端点列出协议名称（UI 用） */
export function protocolName(endpoint) {
  return getProtocol(endpoint)?.meta?.name || 'Unknown';
}
