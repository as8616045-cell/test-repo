---
inclusion: always
---

# AI 创作工作台 — 项目总览

## 是什么

`as8616045-cell/test-repo` —— 一个**纯前端、零后端、零构建**的个人 AI 创作工作台。设计目标：

- 单页静态网页，可双击 `index.html` 打开 / 推到 GitHub Pages / Cloudflare Pages 任意一种方式部署
- 把多家 AI 服务（火山方舟即梦4.0、OpenAI gpt-image、Google Gemini、DeepSeek、硅基流动、fal.ai）统一到一个工作流里
- 适合电商/带货级别的图像流水线：反推 prompt → 改写润色 → 生图（含一致性、换装、换背景）→ 历史记录
- API Key 仅存浏览器 localStorage，永不上传任何服务器

## 技术栈

- **HTML + 原生 ES Modules** —— 不用 React/Vue 不用 npm，TailwindCSS 用 CDN
- **localStorage** —— 设置（API Key、模型名、偏好）
- **IndexedDB** —— 历史记录（生成结果、参考图、时间线）
- **Fetch API** —— 直接从浏览器调用各家 AI API（火山方舟原生支持 CORS；境外 API 用 Cloudflare Worker 代理可选）

## 文件结构

```
test-repo/
├── index.html                    # 单页入口（侧边栏 + 路由）
├── README.md                     # 用户说明
├── assets/styles.css             # Tailwind CDN 之上的少量自定义样式
└── js/
    ├── app.js                    # Tab 路由
    ├── settings.js               # 设置（localStorage）
    ├── storage.js                # 历史记录（IndexedDB）
    ├── batch.js                  # 并发任务队列
    ├── components.js             # 复用 UI（stepFrame, subCard, providerSelect, imageDropzone, ...）
    ├── utils.js                  # 工具函数
    ├── api/
    │   ├── index.js              # 统一接口路由（reverseImage / chatText / generateImage / editImage / generateVideo）
    │   ├── volcengine.js         # 火山方舟 adapter（即梦 4.0 / 豆包视觉 / Seedance）
    │   ├── openai.js             # OpenAI 兼容 adapter（gpt-image-1 / dall-e / 任意 OpenAI 兼容中转站）
    │   ├── gemini.js             # Google Gemini adapter（含 Nano Banana 生图）
    │   ├── deepseek.js           # DeepSeek（仅 chatText）
    │   ├── siliconflow.js        # 硅基流动（OpenAI 兼容聚合，DeepSeek + Qwen-VL + Kolors 等）
    │   └── fal.js                # fal.ai 异步队列协议（Flux Kontext / Kling 等）
    └── pages/
        ├── workflow.js           # 主工作流页面（核心，~750 行）
        ├── history.js            # 历史记录
        └── settings-page.js      # 设置 / API Key 管理
```

## 核心抽象

### 1. 三步骤工作流（`pages/workflow.js`）

每个步骤是 `stepFrame` —— 紫色序号气泡 + 标题 + 子卡片。

- **Step 1 「主 Prompt」**
  - 子卡片：Prompt 模板（rows=8 大 textarea）+ LLM 改写润色按钮（带独立 chat provider 选择器）
  - 子卡片：反推（可选，上传图 → 反推 prompt 写入主模板）
  - 子卡片：提示词列表（可选，每行一个 prompt 替代主模板）
- **Step 2 「元素槽位」**
  - 三个槽位 `model` / `outfit` / `scene`
  - 每个槽位有：mode 切换（`text` / `image` / `images`，默认 `off` 不使用 —— 没有"不使用"按钮，再点已激活按钮即取消）+ 独立的"指令"textarea + 图片上传区
  - 多图模式下指令框上方显示 `@图片N` chip，点击插入光标位置
- **Step 3 「生成」**
  - 子卡片：生成参数（服务商 / 1K-2K-4K 分辨率按钮组 / 比例下拉含横竖标注 / 张数 1-8 按钮组+自定义输入 / 重复次数 / 备注）
  - 子卡片：启动（运行 / 停止 / 估算徽章 / 进度条）
  - 子卡片：结果（按 task 分组的 result-card，含来源 tag、@图片N 引用追踪）

### 2. 任务组合（`composeTasks`）

```
总任务数 = (prompts 列表大小，默认 1) × (槽位笛卡尔积，≥1) × (重复次数)
```

每个 task 由 `buildTask` 生成：
1. 主 prompt 模板里的 `{model} {outfit} {scene}` 占位符按 cartesian 选中的值替换
2. 各槽位的"指令"被追加到任务 prompt 末尾
3. 槽位指令里的 `@图片N` 被替换为 `[第 N 张参考图：filename]`，并把对应图片加入任务的 `referenceImages`（去重）

### 3. 历史记录

`storage.js` 用 IndexedDB 存 `{ kind: 'workflow', prompt, provider, inputs, outputs, params, ... }`，`pages/history.js` 渲染。

## 当前 PR 历史

| PR | 状态 | 内容 |
|---|---|---|
| #3 | merged | 初版，7 个分散页面（反推/一致性/换产品/换背景/批量/历史/设置） |
| #4 | merged | 改造为统一工作流 + OpenAI 中转站支持（含一个 TDZ bug） |
| #5 | merged → **被 #6 revert** | 修 TDZ + UI 框架统一 + 批量逻辑简化 |
| #6 | merged | revert PR #5 |
| #7 | merged | 重新引入 PR #5 内容 + 主 prompt 加大 + DeepSeek + 1K/2K/4K + 槽位指令 + @图片N |
| #8 | merged | 硅基流动 + 宽 prompt 框 + n=1-8 + 自定义 + 移除"不使用"按钮 |

## 当前部署

- GitHub Pages: `https://as8616045-cell.github.io/test-repo/`
- 用户可在 Pages 设置里启用 Cloudflare Pages 替代

## 已避免的雷

- **CORS**：火山方舟开放 CORS，浏览器直连无需代理；其他境外 API 偶尔需要 Cloudflare Worker 代理（`settings.corsProxy` 字段，README 里有 Worker 代码模板）
- **TDZ bug**：`const insertProvider = (block) => card.insertBefore(block, prefs);` 引用了还没声明的 `prefs` —— PR #5 修复，已避免再犯
- **fal.ai 比例字符串**：fal.ai 只接受标准比例如 `9:16`，不能用 `gcd` 计算；用 `RATIOS` 查表。
- **AbortSignal 透传**：runBatch 的 worker 必须接 `signal` 并往 fetch 传，否则停止按钮无效
