---
inclusion: always
---

# 待实施：API 统一重构（v3 → v4）

## 用户已确认的需求（2026-05-28）

> 然后还有一个问题，就是能不能把这个API的接口全部统一掉，这样子无论用户输入的是OpenAI或者是谷歌，或者是国内的一些大模型，它都能够起到一个自动识别并且成功完成调用的一个方式，需要用户去选择，给它集成到一个选项里面去，还有呢，就是分析图片提示词的API能不能和生图的API分开来

需求拆解：

1. **统一 API 入口**：用户只填 `baseURL + apiKey`，系统按 baseURL **自动识别**该端点说哪种协议（OpenAI 兼容 / Google Gemini 原生 / fal.ai 异步队列），不再需要用户在五个写死的 provider 板块里选。
2. **视觉与生图分离**：每个"能力"（vision / chat / image / edit / video）独立指派端点 + 模型。这样能"反推用 Gemini，生图用即梦"自由组合。

## 已确认的 5 个设计点

1. **预设端点** ✅ —— 用户首次进入时自动创建 6 个模板端点（火山方舟 / OpenAI / Gemini / DeepSeek / 硅基流动 / fal.ai），用户填 Key 即可用，可删除可重加
2. **旧设置自动迁移** ✅ —— v3 schema 里已有的 `volcengine` `openai` `gemini` `fal` `deepseek` `siliconflow` 字段 + `preferred` 自动映射到 v4 的 endpoints + capabilities，**用户已填的 Key 不会丢**
3. **fal.ai 也走端点系统** ✅ —— 系统识别到 `fal.run|fal.ai` 域名自动走 fal 队列协议
4. **测试连通性按钮** ✅ —— 每个 endpoint 旁边 "测试" 按钮，点击后用最简单的 ping 调用验证 Key
5. **保留临时切换** ✅ —— 工作流页面每个能力旁边保留一个端点选择器（`endpointSelect`），临时覆盖 settings 默认值，方便"这次反推临时用 Gemini 试试"

## 数据结构

### 旧 v3（要废弃）

```js
{
  volcengine:  { apiKey, visionModel, imageModel, videoModel },
  gemini:      { apiKey, visionModel, imageModel },
  fal:         { apiKey, fluxKontextModel, klingModel },
  openai:      { apiKey, baseURL, visionModel, imageModel },
  deepseek:    { apiKey, baseURL, chatModel },
  siliconflow: { apiKey, baseURL, chatModel, visionModel, imageModel },
  preferred:   { vision, chat, image, edit, video },  // 服务商 id
  concurrency, corsProxy,
}
```

### 新 v4

```js
{
  endpoints: [
    {
      id: string,           // 稳定 id，初始化时生成
      name: string,         // 用户起的别名，如"火山方舟"
      baseURL: string,      // 如 'https://ark.cn-beijing.volces.com/api/v3'
      apiKey: string,
      protocol: 'auto' | 'openai' | 'gemini' | 'fal',  // 'auto' 表示按 baseURL 自动识别
    },
    ...
  ],
  capabilities: {
    vision: { endpointId, model },   // 反推视觉
    chat:   { endpointId, model },   // Prompt 改写润色
    image:  { endpointId, model },   // 生图（文生图）
    edit:   { endpointId, model },   // 图像编辑（图生图、换 X）
    video:  { endpointId, model },   // 视频生成
  },
  concurrency: number,
  corsProxy: string,
}
```

storage key 升级到 `'ai-studio:settings:v4'`，从 v3/v2/v1 读到的旧数据走 `migrateFromV3` 自动转换。

### 6 个预设端点（首次初始化用）

```js
const PRESET_ENDPOINTS = [
  {
    id: 'volcengine',
    name: '火山方舟（即梦 4.0 / 豆包视觉 / Seedance）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    protocol: 'auto',  // → openai 兼容
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseURL: 'https://api.openai.com',
    apiKey: '',
    protocol: 'auto',  // → openai
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    protocol: 'auto',  // → gemini
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（仅文本）',
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    protocol: 'auto',  // → openai 兼容
  },
  {
    id: 'siliconflow',
    name: '硅基流动（聚合）',
    baseURL: 'https://api.siliconflow.cn',
    apiKey: '',
    protocol: 'auto',  // → openai 兼容
  },
  {
    id: 'fal',
    name: 'fal.ai',
    baseURL: 'https://queue.fal.run',
    apiKey: '',
    protocol: 'auto',  // → fal
  },
];

const DEFAULT_CAPABILITIES = {
  vision: { endpointId: 'volcengine', model: 'doubao-seed-1-6-vision-250815' },
  chat:   { endpointId: 'volcengine', model: 'doubao-seed-1-6-vision-250815' },
  image:  { endpointId: 'volcengine', model: 'doubao-seedream-4-0-250828' },
  edit:   { endpointId: 'volcengine', model: 'doubao-seedream-4-0-250828' },
  video:  { endpointId: 'volcengine', model: 'doubao-seedance-1-0-pro-250528' },
};
```

## 协议自动识别

```js
function detectProtocol(endpoint) {
  if (endpoint.protocol && endpoint.protocol !== 'auto') return endpoint.protocol;
  const url = (endpoint.baseURL || '').toLowerCase();
  if (/generativelanguage\.googleapis\.com/.test(url)) return 'gemini';
  if (/queue\.fal\.run|fal\.ai/.test(url)) return 'fal';
  return 'openai'; // 默认 OpenAI 兼容（覆盖 OpenAI 官方/DeepSeek/SiliconFlow/火山方舟/OneAPI/NewAPI/任意中转站）
}
```

⚠️ **火山方舟特殊点**：chat / vision 是完全 OpenAI 兼容的；但 images/generations 字段差异：
- 多图参考用 `image` 字段（string 或 string[]），**不**是 multipart `image[]`
- 需要 `sequential_image_generation: 'disabled'`
- 不走 `/v1/images/edits` 路径，统一走 `/images/generations` 加 `image` 参数

OpenAI 协议适配器要在 `generateImage` / `editImage` 时检查 `endpoint.baseURL` 是否含 `volcengine|ark|volces`，如果是就走火山方舟字段格式。这点对用户透明。

## 文件改动清单

### 新建（3 个协议层）

```
js/api/protocols/openai.js   - OpenAI 兼容协议（含火山方舟特殊处理）
js/api/protocols/gemini.js   - Google Gemini 原生协议
js/api/protocols/fal.js      - fal.ai 异步队列协议
```

每个 protocol 模块导出 5 个**纯函数**（接受 endpoint 参数，不再从 settings 读全局）：

```js
// 统一签名
export async function reverseImage(endpoint, model, imageDataURLs, instruction, { signal })
export async function chatText(endpoint, model, text, { signal })
export async function generateImage(endpoint, model, { prompt, referenceImages, size, n, aspectRatio }, { signal })
export async function editImage(endpoint, model, { prompt, images, size, n }, { signal })
export async function generateVideo(endpoint, model, { prompt, image, ratio, duration }, { signal, onProgress })

// 元数据：声明协议支持哪些能力 + 测试连通性的方法
export const meta = {
  name: 'OpenAI Compatible',
  capabilities: ['vision', 'chat', 'image', 'edit'],
  // ping 用最便宜的调用验证 Key
  async ping(endpoint) { ... },  // throws on failure, returns string status on success
};
```

### 重写

#### `js/settings.js`
- 删掉旧的 6 个 provider 字段块
- 新 schema 见上
- `migrateFromV3(oldSettings)` 函数：
  - 把 `volcengine.apiKey/visionModel/...` → 找 id='volcengine' 的预设端点填进去 + 更新 capabilities[vision].model 等
  - `openai.baseURL/apiKey/visionModel/imageModel` → id='openai' endpoint
  - `gemini.apiKey/visionModel/imageModel` → id='gemini'（baseURL 用预设的）
  - `deepseek.apiKey/baseURL/chatModel` → id='deepseek'
  - `siliconflow.apiKey/baseURL/chatModel/visionModel/imageModel` → id='siliconflow'
  - `fal.apiKey` → id='fal'
  - `preferred.{vision/chat/image/edit/video}` → 映射到 capabilities[cap].endpointId（火山方舟 → 'volcengine'，gemini → 'gemini'，等等）
- 新工具函数：`addEndpoint(name, baseURL, apiKey)` `removeEndpoint(id)` `updateEndpoint(id, patch)` `getEndpoint(id)` `setCapability(cap, endpointId, model)`

#### `js/api/index.js`
- 完全重写。不再有 `PROVIDERS / PROVIDER_LIST / providersFor`
- 新接口：

```js
import * as openaiP from './protocols/openai.js';
import * as geminiP from './protocols/gemini.js';
import * as falP from './protocols/fal.js';
import { loadSettings } from '../settings.js';

const PROTOCOLS = { openai: openaiP, gemini: geminiP, fal: falP };

function detectProtocol(endpoint) { /* ... 见上 */ }

function resolve(capability, override) {
  const s = loadSettings();
  const cap = override?.endpointId
    ? { endpointId: override.endpointId, model: override.model || s.capabilities[capability].model }
    : s.capabilities[capability];
  const endpoint = s.endpoints.find(e => e.id === cap.endpointId);
  if (!endpoint) throw new Error(`未找到端点 "${cap.endpointId}"，请到设置里配置`);
  if (!endpoint.apiKey) throw new Error(`端点 "${endpoint.name}" 还没填 API Key`);
  const proto = PROTOCOLS[detectProtocol(endpoint)];
  if (!proto) throw new Error(`未知协议`);
  // verify protocol supports this capability
  if (!proto.meta.capabilities.includes(capability)) {
    throw new Error(`端点 "${endpoint.name}"（${detectProtocol(endpoint)} 协议）不支持 ${capability}`);
  }
  return { endpoint, model: cap.model, proto };
}

export async function reverseImage(images, instruction, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('vision', override);
  return { provider: endpoint.name, text: await proto.reverseImage(endpoint, model, images, instruction, runOpts) };
}

export async function rewritePrompt(prompt, override, customInstruction, runOpts = {}) {
  const { endpoint, model, proto } = resolve('chat', override);
  const text = (customInstruction || DEFAULT_REWRITE_INSTRUCTION).replace('{prompt}', prompt);
  return { provider: endpoint.name, text: await proto.chatText(endpoint, model, text, runOpts) };
}

export async function generateImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('image', override);
  const r = await proto.generateImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

export async function editImage(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('edit', override);
  const r = await proto.editImage(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

export async function generateVideo(opts, override, runOpts = {}) {
  const { endpoint, model, proto } = resolve('video', override);
  const r = await proto.generateVideo(endpoint, model, opts, runOpts);
  return { provider: endpoint.name, ...r };
}

// New: list endpoints for a capability (used by endpointSelect in UI)
export function endpointsFor(capability) {
  const s = loadSettings();
  return s.endpoints.filter(ep => {
    const proto = PROTOCOLS[detectProtocol(ep)];
    return proto?.meta?.capabilities?.includes(capability);
  });
}

export async function pingEndpoint(endpoint) {
  const proto = PROTOCOLS[detectProtocol(endpoint)];
  if (!proto?.ping) throw new Error('该协议不支持连通性测试');
  return proto.ping(endpoint);
}
```

#### `js/pages/settings-page.js`

完全重写。不再有 5 个写死的 providerBlock。新结构：

```
⚙️ 设置 / API 端点

[端点列表卡片]
  ┌──────────────────────────────────────────┐
  │ 火山方舟（即梦 4.0 / 豆包视觉 / Seedance）  [拖拽移动] [×删除]
  │   Base URL：[https://ark.cn-beijing...   ]
  │   ↳ 自动识别为：OpenAI 兼容协议  [手动覆盖▼]
  │   API Key：[●●●●●●●●●●]
  │   [💚 测试连通性]  [上次测试：2026-05-28 14:23 OK]
  └──────────────────────────────────────────┘
  ... (其他端点)
  [+ 添加自定义端点]  [📋 从预设添加 ▼]
                              · 火山方舟
                              · OpenAI 官方
                              · Google Gemini
                              · DeepSeek
                              · 硅基流动
                              · fal.ai

[能力指派卡片]
  反推视觉 (vision)  端点：[火山方舟▼]  模型：[doubao-seed-1-6-vision-250815]
  Prompt 改写 (chat) 端点：[DeepSeek▼]  模型：[deepseek-chat]
  生图 (image)        端点：[OpenAI▼]    模型：[gpt-image-1]
  图像编辑 (edit)     端点：[火山方舟▼]  模型：[doubao-seedream-4-0-250828]
  视频生成 (video)    端点：[火山方舟▼]  模型：[doubao-seedance-1-0-pro-250528]

[通用]
  并发数 / CORS 代理 ...

[导入 / 导出 / 重置 / 清除全部 Key]
```

端点选择器只显示**支持该能力**的端点（用 `endpointsFor(cap)` 过滤）。例如 fal.ai 协议没有 chat 能力，所以"Prompt 改写"的端点下拉里不会出现 fal.ai。

#### `js/components.js`

新增 `endpointSelect(capability, currentId)` 组件，类似旧的 `providerSelect` 但是从 `endpointsFor(cap)` 读列表。

`providerSelect` 删除（旧组件）。

#### `js/pages/workflow.js`

- 把所有 `providerSelect('chat')` `providerSelect('image')` `providerSelect('vision')` 改成 `endpointSelect('chat')` 等
- 用户在工作流里选的端点是**临时覆盖**，不写回 settings.capabilities（保留旧行为：保存到 state，不污染设置）
- API 调用时 override 改传 `{ endpointId, model: undefined }`（model 沿用 capabilities 默认）

具体行：
- `buildPromptSubCard`：rewrite 的 provSel 改为 `endpointSelect('chat')`
- `buildReverseSubCard`：reverse 的 provSel 改为 `endpointSelect('vision')`
- `buildGenerationStep`：image 的 provSel 改为 `endpointSelect('image')`
- 调 API 时 override 是 `{ endpointId: provSel.value }`

### 删除（6 个旧 adapter 文件）

```
js/api/volcengine.js
js/api/openai.js
js/api/gemini.js
js/api/deepseek.js
js/api/siliconflow.js
js/api/fal.js
```

### 不动

- `js/app.js` `js/storage.js` `js/batch.js` `js/utils.js` `index.html` `assets/styles.css` `pages/history.js`

## 协议层细节

### `protocols/openai.js`（含火山方舟特殊处理）

复用现有 `js/api/openai.js` 的逻辑，但改为参数化（接 endpoint 参数）。两处特殊点：

```js
function isVolcengine(endpoint) {
  return /volcengine|ark\.cn-beijing|volces\.com/i.test(endpoint.baseURL);
}

export async function generateImage(endpoint, model, { prompt, referenceImages, size, n }, { signal }) {
  const c = endpoint;
  const baseURL = c.baseURL.replace(/\/+$/, '');
  // 火山方舟：用 image 字段（string|string[]），统一走 /images/generations
  if (isVolcengine(c)) {
    const body = { model, prompt, size, n, response_format: 'url' };
    if (referenceImages?.length) {
      body.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
      body.sequential_image_generation = 'disabled';
    }
    const r = await postJSON(c, '/chat/completions'.replace('chat/completions', 'images/generations'), body, { signal });
    // volcengine 路径其实是 /api/v3/images/generations，baseURL 已含 /api/v3
    return parseImagesResp(r);
  }
  // OpenAI 官方 / DeepSeek（无图）/ SiliconFlow（用 image_size + batch_size）/ 中转站
  if (/api\.siliconflow\.(cn|com)/i.test(baseURL)) {
    if (referenceImages?.length) throw new Error('SiliconFlow 不支持图生图，请改用其他端点');
    const r = await postJSON(c, '/v1/images/generations', { model, prompt, image_size: size, batch_size: n }, { signal });
    return parseSiliconflowResp(r);
  }
  // 其余按 OpenAI 标准
  if (referenceImages?.length) {
    // multipart /v1/images/edits
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('n', String(n));
    fd.append('size', size);
    referenceImages.forEach((d, i) => fd.append('image[]', dataURLtoBlob(d), `ref_${i+1}.png`));
    const r = await postForm(c, '/v1/images/edits', fd, { signal });
    return parseImagesResp(r);
  } else {
    const r = await postJSON(c, '/v1/images/generations', { model, prompt, n, size, quality: 'high' }, { signal });
    return parseImagesResp(r);
  }
}
```

`postJSON` / `postForm` 里 `/v1/...` 路径在 baseURL 含 `/api/v3` 的情况下需要特殊处理（火山方舟 chat 端点是 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`，没有 `/v1` 前缀）—— 所以函数里要：

```js
function buildURL(endpoint, path) {
  let url = endpoint.baseURL.replace(/\/+$/, '');
  // 如果 baseURL 已经含完整版本前缀（/api/v3 或 /v1 或 /v1beta），直接拼最后一段
  if (/\/api\/v\d+|\/v\d+(?:beta)?$/.test(url)) {
    // path 形如 '/chat/completions'，把 '/v1/' 之类的前缀剥掉
    return url + path.replace(/^\/v\d+(?:beta)?/, '');
  }
  return url + path;
}
```

### `protocols/gemini.js`

复用现有 `js/api/gemini.js`，参数化即可。`ping` 用 `GET /models?key=...` 验证。

### `protocols/fal.js`

复用现有 `js/api/fal.js`。`fal` 的 endpoint 不需要 model 字段（model path 写在 endpoint 里更合适？），但为统一接口签名，model 字段可以填如 `fal-ai/flux-pro/kontext`。

`ping` 用列出账户余额或 dashboard endpoint，或者 HEAD 请求验证 Key 头格式。

## 测试连通性

每个协议实现 `meta.ping(endpoint)`：

- OpenAI 协议：`GET {baseURL}/v1/models`，带 Bearer。火山方舟：`GET {baseURL}/models` 或直接发个最小的 chat/completions（成本一低）
- Gemini 协议：`GET {baseURL}/models?key={apiKey}`
- fal.ai 协议：`HEAD https://fal.ai/api/_user`（或简单的 GET 带 Authorization）

UI 里展示三种状态：未测试 / 测试中 / `✓ OK 200ms` / `✗ 401 Unauthorized`。

## 实施顺序（建议）

1. 先在新分支 `feat/v4-unified-api-architecture` 上工作
2. 创建 `js/api/protocols/` 目录 + 3 个协议文件（从现有 adapter 复制改造）
3. 重写 `js/settings.js`（含 v3→v4 迁移）
4. 重写 `js/api/index.js`
5. 改 `js/components.js` 加 `endpointSelect`
6. 改 `js/pages/workflow.js`（替换 providerSelect 为 endpointSelect）
7. 重写 `js/pages/settings-page.js`
8. 删除 6 个旧 adapter 文件
9. **手工跑一遍三种最常见组合**：
   - 火山方舟 vision + 火山方舟 image：原有用法保持
   - DeepSeek chat + 火山方舟 image：分离用法
   - Gemini vision + OpenAI image：跨协议
10. 提单一 PR，**不分多次提交**（避免 #5 那种被 revert 的事故）

## 用户已踩过的雷（吸取教训）

- 之前 PR #5 被 revert 过一次，原因可能是用户合并后没立刻看到效果就以为坏了。**这次重构后 README 要写清楚"等 GitHub Pages 构建完成（看 Actions 页面变绿色）再刷新"**
- 不要用 `setInterval` 不清理（之前 estimateBadge 那个）
- 工具调用名要用 `fs_write` `str_replace`，不能用裸的 `create` `replace`
- `force_with_lease=False` 默认就好；除非有冲突，否则不要 force push 到 main

## 验收标准

完成 v4 重构后，用户应该能：

- ✅ 在设置页看到 6 个预设端点（首次访问）或自己已填的端点（迁移后）
- ✅ 添加一个新端点（如 OneAPI 中转站），系统自动识别为 OpenAI 协议
- ✅ 点测试按钮能看到"OK"或具体的错误码
- ✅ 在能力指派区把"反推视觉"指派到 Gemini，"生图"指派到 OpenAI（跨协议）
- ✅ 工作流页面正常运行，端点切换器只显示支持当前能力的端点
- ✅ 旧用户从 v3 升级后所有 Key 还在
