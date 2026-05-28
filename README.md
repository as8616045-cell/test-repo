# ✨ AI 创作工作台 · Personal Studio

一个**纯前端、零依赖、零部署**的个人 AI 创作面板，专为电商/带货级别的图像/视频流水线设计。

## 核心能力

| 模块 | 功能 |
|---|---|
| 🔍 反推提示词 | 上传图片 → 输出可直接拿去生图的 prompt |
| 🎭 一致性生图 | 参考图 + prompt → 保持人物/风格/场景一致的成图 |
| 👗 固定模特换产品 | 1 张模特图 + N 张产品图 → 批量生成"该模特展示这些产品"的图 |
| 🌆 固定模特+产品换背景 | 1 张主体图 + N 个背景描述 → 批量换背景 |
| ⚡ 批量任务 | CSV / 多行文本喂入，几十上百条 prompt 一次跑完 |
| 📚 历史记录 | 所有生成自动存浏览器 IndexedDB，可回看/下载 |

## 支持的 API（按需开通其中一家即可）

| 服务商 | 拿来做什么 | 申请地址 |
|---|---|---|
| **火山方舟 Volcengine** | 即梦 4.0（生图+编辑+一致性）、豆包视觉（反推）、Seedance（生视频） | https://www.volcengine.com/product/ark |
| **Google Gemini** | 视觉理解、Nano Banana（gemini-2.5-flash-image，角色一致性极强） | https://aistudio.google.com/app/apikey |
| **fal.ai** | Flux Kontext（编辑王者）、Kling 视频 等海量模型聚合 | https://fal.ai/dashboard/keys |

> **国内首选火山方舟**：免备案直连、即梦 4.0 原生支持"角色保持/主体保持/换装/换背景"，最贴合您的需求。

---

## 🚀 三种使用方式（任选其一）

### 方式 A：本地双击打开（最简单，零安装）

1. 把仓库下载下来（`Code → Download ZIP` 或 `git clone`）
2. 解压后 **双击 `index.html`** 在浏览器打开
3. 进入「设置」填 API Key，开始用

> ⚠️ 因浏览器对 `file://` 协议下的 ES module 有限制，部分浏览器（Chrome）需要简单起一个本地 server。最简单的办法：在仓库目录下执行 `python3 -m http.server 8080`，然后访问 http://localhost:8080

### 方式 B：GitHub Pages 在线访问（推荐，手机也能用）

1. 推送本仓库到 GitHub（已在您账号下）
2. 仓库 → **Settings → Pages → Source 选 `main` / `(root)` → Save**
3. 等 1 分钟，得到您的专属网址：`https://<你的用户名>.github.io/test-repo/`
4. 收藏到手机/电脑书签即可。**所有 API Key 仍只存在您本机浏览器**

### 方式 C：Cloudflare Pages（同样免费，速度更快）

1. 登录 https://dash.cloudflare.com → Pages → Create → 连接 GitHub 仓库
2. Build command 留空、Output directory 填 `/`
3. Deploy 后得到 `xxx.pages.dev` 域名

---

## 🔑 API Key 怎么填

打开应用 → 左侧 **⚙️ 设置** → 在对应服务商粘贴 Key → **保存**

> Key 只存您浏览器的 `localStorage`，**永远不会上传任何服务器**（您可以打开浏览器开发者工具 → Network 自己验证）。

---

## 🌐 关于 CORS（境外 API 浏览器调不通时）

**火山方舟（国内）默认开放 CORS，浏览器可直连，无需任何代理**。

Gemini / fal.ai 在浏览器调用时，**通常**也是允许 CORS 的，但偶尔出现 `CORS error` 时，您可以：

### 方案 1：自部署一个 Cloudflare Worker（5 分钟，永久免费）

1. 登录 https://dash.cloudflare.com → Workers & Pages → Create
2. 把下面的代码贴进去：

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const target = url.pathname.slice(1) + url.search; // 去掉前导 /
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

3. 部署后得到 `https://your-worker.workers.dev`
4. 在「设置 → 通用 → CORS 代理」填入这个地址，保存即可

> 实现原理：把 `https://api.example.com/foo` 访问改写为 `https://your-worker.workers.dev/https://api.example.com/foo`，由 Worker 中转并加上 CORS 头。

---

## 🧠 推荐工作流（针对您的场景）

```
1) 拿到一张爆款图（竞品/灵感图）
   → 用「反推提示词」拿到 prompt

2) 微调 prompt 后 → 「一致性生图」生成自己的版本
   （把模特/产品参考图一起喂进去，保持一致）

3) 「固定模特换产品」批量生成全产品系列图
   （上传 1 个模特 + N 个产品 → 一次出 N 张）

4) 「固定模特+产品换背景」生成不同场景版
   （列出"摄影棚 / 海边 / 街头 / 森林"等 → 一次出 N 张）

5) 用历史记录回看任意一张图，二次微调
```

---

## 📁 项目结构

```
test-repo/
├── index.html              # 单页入口
├── assets/styles.css       # 自定义样式（其余用 Tailwind CDN）
├── js/
│   ├── app.js              # 主控：Tab 路由
│   ├── settings.js         # API Key / 偏好（localStorage）
│   ├── storage.js          # 历史记录（IndexedDB）
│   ├── batch.js            # 并发任务队列
│   ├── components.js       # 复用 UI（dropzone / gallery / modal）
│   ├── utils.js            # 工具函数
│   ├── api/
│   │   ├── index.js        # 统一接口（reverseImage / generateImage / editImage / generateVideo）
│   │   ├── volcengine.js   # 火山方舟
│   │   ├── gemini.js       # Gemini / Nano Banana
│   │   └── fal.js          # fal.ai
│   └── pages/              # 各功能页（路由由 app.js 加载）
│       ├── reverse.js
│       ├── consistent.js
│       ├── change-product.js
│       ├── change-bg.js
│       ├── batch-page.js
│       ├── history.js
│       └── settings-page.js
└── README.md
```

## ➕ 想加新的 API（比如 Replicate / Runway / Stability / 阿里 通义万相）

复制 `js/api/fal.js` → 改名 → 改成对应 API 的请求格式 → 在 `js/api/index.js` 的 `PROVIDERS` 注册一下即可。每个 adapter 只要导出 4 个函数：`reverseImage / generateImage / editImage / generateVideo`（不支持的就抛错）。

---

## 🛡️ 隐私

- API Key、历史记录、所有数据都只存在您浏览器本地（localStorage + IndexedDB）
- 应用本身不连任何"我们的服务器"，只直连您配置的 AI 服务商
- 关闭浏览器/换电脑数据不会跨设备同步（这是特性，不是 bug）；想备份就用「设置 → 导出 JSON」

---

## License

MIT — 想怎么改怎么改。
