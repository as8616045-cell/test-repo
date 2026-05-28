// js/api/deepseek.js — DeepSeek adapter (OpenAI-compatible chat).
// DeepSeek 是国内主流文本 LLM，OpenAI 兼容协议，只接 /v1/chat/completions。
// 这里仅暴露 chatText（用于 prompt 改写润色），不实现生图/视觉/视频。
// Docs: https://api-docs.deepseek.com/

import { loadSettings } from '../settings.js';

function cfg() {
  const s = loadSettings();
  if (!s.deepseek?.apiKey) {
    throw new Error('请先在「设置」里填写 DeepSeek API Key');
  }
  return s.deepseek;
}

function withProxy(url) {
  const s = loadSettings();
  return s.corsProxy ? s.corsProxy.replace(/\/$/, '') + '/' + url : url;
}

function baseURL() {
  return (cfg().baseURL || 'https://api.deepseek.com').replace(/\/+$/, '');
}

async function postJSON(path, body, { signal } = {}) {
  const c = cfg();
  const r = await fetch(withProxy(baseURL() + path), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let msg = `DeepSeek ${r.status}`;
    try { const j = await r.json(); msg += ': ' + (j?.error?.message || JSON.stringify(j)); }
    catch { msg += ': ' + await r.text().catch(() => ''); }
    throw new Error(msg);
  }
  return r.json();
}

/** 纯文本 LLM —— prompt 改写润色 */
export async function chatText(text, { signal } = {}) {
  const c = cfg();
  const r = await postJSON('/v1/chat/completions', {
    model: c.chatModel || 'deepseek-chat',
    messages: [{ role: 'user', content: text }],
    temperature: 0.6,
  }, { signal });
  return r.choices?.[0]?.message?.content?.trim() || '';
}

/** DeepSeek 不提供视觉/生图/视频 —— 抛错让上层路由到其他服务商 */
export async function reverseImage() { throw new Error('DeepSeek 不支持视觉理解，请改用火山方舟 / Gemini / OpenAI'); }
export async function generateImage() { throw new Error('DeepSeek 不支持生图'); }
export async function editImage() { throw new Error('DeepSeek 不支持图像编辑'); }
export async function generateVideo() { throw new Error('DeepSeek 不支持视频生成'); }

export const meta = {
  name: 'DeepSeek',
  signupUrl: 'https://platform.deepseek.com/api_keys',
  capabilities: ['chat'],
};
