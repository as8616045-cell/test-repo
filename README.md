# ✨ AI 创作工作台 · Personal Studio

**一个统一的工作流，把"反推 / 文生图 / 图生图 / 一致性 / 换 X / 批量"全部组合在一个页面里。**

纯前端、零依赖、零部署。浏览器打开就能用，支持火山方舟、OpenAI（含中转站）、Gemini、fal.ai。

---

## 🎨 一个工作流，覆盖所有场景

打开应用后，主页面 **🎨 工作流** 由 6 个步骤组成：

```
① 反推（可选）→ 上传图自动反推 prompt 填到下方
   ↓
② 主 Prompt 模板（可用占位符 {model} {outfit} {scene}）
   [✨ LLM 改写润色] 一键扩写
   ↓
③ 三个槽位（每个独立选模式）
   ┌─模特─┐ ┌─服装/产品─┐ ┌─场景/背景─┐
   │ 不用  │ │ 不用       │ │ 不用      │
   │ 文字  │ │ 文字       │ │ 文字      │
   │ 单图  │ │ 单图       │ │ 单图      │
   │ 多图  │ │ 多图       │ │ 多图      │
   └──────┘ └────────────┘ └───────────┘
   ↓
④ 服务商 / 模型 / 尺寸 / 每任务出几张
   ↓
⑤ 批量模式：单次 / 同 prompt 多变体 / 不同 prompt 列表 / 槽位笛卡尔积
   ↓
⑥ ▶ 运行 → 实时进度 → 带溯源信息的结果（每张图都标注用了哪个槽位）
```

### 🎯 同一套界面，任意组合实现 9 种需求

| 您要做的 | 怎么配 |
|---|---|
| **纯文生图** | 三个槽位都"不用" → 写 prompt → 跑 |
| **图生图（一致性）** | 模特槽 = 单图 → prompt 写"她在..." → 跑 |
| **多图参考** | 模特槽 = 单图 + 服装槽 = 单图 + 场景槽 = 单图 |
| **只换模特** | 模特槽 = 多图，其余 = 单图 → 批量模式选"笛卡尔积" |
| **只换装** | 服装槽 = 多图，其余 = 单图 → 笛卡尔积 |
| **只换场景** | 场景槽 = 多图（或文字列表），其余 = 单图 |
| **同 prompt 多变体** | 槽位随便配 → 批量模式选"重复 N 次" |
| **不同 prompt 批量** | 在"不同提示词列表"里粘多行 prompt |
| **大批量笛卡尔积** | 多个槽位都设多图 → 笛卡尔积自动两两组合 |

举几个具体例子：
- 1 个模特 × 5 个产品 = **5 张**（产品图轮换展示）
- 1 个模特 × 5 个产品 × 4 个场景 = **20 张**（全组合）
- 3 个模特 × 1 个产品 × 1 个场景 = **3 张**（不同人代言同款）
- 单次模式 + 槽位都填 = **1 张**（精修单图）

---

## 🔌 支持的 API（按需开通其中一家）

| 服务商 | 拿来做什么 | 入口 |
|---|---|---|
| **火山方舟 Volcengine** | 即梦 4.0（一致性极强）、豆包视觉（反推/改写）、Seedance（视频） | https://www.volcengine.com/product/ark |
| **OpenAI / 中转站** | gpt-image-1 / gpt-image-2 / dall-e-3 / gpt-4o；**支持任意 OpenAI 兼容中转站**（OneAPI / NewAPI / 私有代理），改 baseURL 即可 | https://platform.openai.com/api-keys |
| **Google Gemini** | 视觉理解、Nano Banana（角色一致性强） | https://aistudio.google.com/app/apikey |
| **fal.ai** | Flux Kontext、Kling 视频等 | https://fal.ai/dashboard/keys |

> **国内首选火山方舟**：免备案直连、即梦 4.0 原生支持"角色保持/主体保持/换装/换背景"。
> **想用 GPT-Image 但没 OpenAI 账号**：在 OneAPI / NewAPI 等中转站买个 Key，把"Base URL"改成中转站域名即可。

---

## 🚀 部署方式（任选一种）

### 方式 A：GitHub Pages（已经在用）
仓库 → Settings → Pages → Source 选 `Deploy from a branch` → Branch `main` → Save

→ `https://as8616045-cell.github.io/test-repo/`

### 方式 B：Cloudflare Pages（更快）
dash.cloudflare.com → Workers & Pages → Create → Connect 仓库 → Build 留空 → Output `/` → Deploy

### 方式 C：本地
```bash
git clone https://github.com/as8616045-cell/test-repo
cd test-repo
python3 -m http.server 8080
```
浏览器开 http://localhost:8080

---

## 🔑 第一次使用

1. 打开应用 → 左侧 **⚙️ 设置 / API Key**
2. 至少配一家服务商（推荐火山方舟，国内直连最稳）
3. 火山方舟控制台还要去**「模型推理 → 在线推理」**逐个开通：
   - `doubao-seedream-4-0-250828`（即梦 4.0）
   - `doubao-seed-1-6-vision-250815`（豆包视觉）
   - `doubao-seedance-1-0-pro-250528`（Seedance Pro）
4. **保存** → 切到 🎨 工作流 → 开干

---

## 🌐 OpenAI 中转站怎么接

很多用户没法直接访问 OpenAI 官方，但可以通过**第三方中转站**用 GPT-Image 等模型。这个工具原生支持任何**OpenAI 兼容**的中转站：

1. 在中转站（OneAPI / NewAPI / 自部署 / 商用）买 Key
2. 应用内：⚙️ 设置 → 🤖 OpenAI / 中转站 板块
3. **Base URL** 改成中转站域名（例如 `https://your-proxy.com`，不要带 `/v1` 后缀）
4. **API Key** 填中转站给的
5. **生图模型** 填中转站支持的型号（如 `gpt-image-1` / `gpt-image-2` / `dall-e-3`）
6. **视觉/聊天模型** 填如 `gpt-4o` / `gpt-4o-mini`
7. 保存 → 工作流页面在"服务商"下拉里选 `OpenAI / 中转站`

---

## 🛡️ CORS（境外 API 浏览器调不通时）

火山方舟原生支持 CORS，浏览器直连无需代理。
其他 API（OpenAI 直连、Gemini、fal.ai）大多也允许 CORS，**少数中转站可能不支持**。如出现 `CORS error`，5 分钟自部署一个 Cloudflare Worker：

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const target = url.pathname.slice(1) + url.search;
    if (!target.startsWith('http')) return new Response('proxy ok', { status: 200 });
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    });
    const h = new Headers(upstream.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Headers', '*');
    h.set('Access-Control-Allow-Methods', '*');
    return new Response(upstream.body, { status: upstream.status, headers: h });
  }
}
```

部署后把 `https://your-worker.workers.dev` 填到 ⚙️ 设置 → 通用 → CORS 代理。

---

## 📁 项目结构

```
test-repo/
├── index.html              # 单页入口（侧边栏：工作流 / 历史 / 设置）
├── assets/styles.css
├── js/
│   ├── app.js              # Tab 路由
│   ├── settings.js         # API Key / 偏好（localStorage）
│   ├── storage.js          # 历史记录（IndexedDB）
│   ├── batch.js            # 并发任务队列
│   ├── components.js       # 复用 UI 组件
│   ├── utils.js            # 工具函数
│   ├── api/
│   │   ├── index.js        # 统一接口
│   │   ├── volcengine.js   # 火山方舟
│   │   ├── openai.js       # OpenAI / 任意中转站
│   │   ├── gemini.js       # Gemini / Nano Banana
│   │   └── fal.js          # fal.ai
│   └── pages/
│       ├── workflow.js     # 🎨 主工作流（核心）
│       ├── history.js      # 📚 历史记录
│       └── settings-page.js# ⚙️ 设置
└── README.md
```

## ➕ 加新 API（比如阿里通义万相 / Replicate / Runway）

复制 `js/api/openai.js` 改成对应 API → 在 `js/api/index.js` 的 `PROVIDERS` 里注册一行 → 在 `js/settings.js` 的 `DEFAULT_SETTINGS` 加配置项 → 在 `js/pages/settings-page.js` 加一个板块。

每个 adapter 只要实现这 4 个函数：`reverseImage / generateImage / editImage / generateVideo`（不支持的就抛错）。

---

## 🛡️ 隐私

- API Key、历史记录、所有数据都只存在您浏览器本地（localStorage + IndexedDB）
- 应用本身不连任何"我们的服务器"，只直连您配置的 AI 服务商
- 想备份就用「⚙️ 设置 → 导出 JSON」

## License

MIT
