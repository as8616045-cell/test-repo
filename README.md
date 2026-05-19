# 知识胶囊 (Knowledge Capsule)

> 把每天刷到的好内容真正变成你的能力。

## 这是什么

一个**给你自己用的"第二大脑"**：

- 📥 **随手收**：把小红书 / 抖音 / X / 公众号 / 网页等任何地方看到的好内容（链接 / 截图文字 / 文案）丢进来
- ✨ **AI 自动提炼**：用 DeepSeek 总结要点 + 抽取"可执行技巧" + 自动打标签
- 🔍 **语义搜索**：用大白话搜，比如"如何向上汇报"，就算原文写的是"向上管理"也能找到
- 🎯 **督促实践**：标记哪些已经实践过，主动提醒你回顾未实践的内容

**Phase 1（当前）**：作为 MCP Server 跑在你电脑上，接入 [Codex 桌面版](https://openai.com/codex/)（同样支持 OpenClaw / Hermes / Claude Desktop 等任何 MCP 客户端）。
**Phase 2（未来）**：同一份后端加一层 Web UI，浏览器 / 小程序就能用，给朋友试。
**Phase 3（未来）**：包成 React Native APP，面向大众。

---

## 技术栈

| 模块 | 选型 | 为什么 |
|------|------|-------|
| 数据库 | SQLite + [sqlite-vec](https://pypi.org/project/sqlite-vec/) | 单文件零运维，向量搜索就地完成 |
| 摘要 / 提炼 | [DeepSeek](https://platform.deepseek.com) (`deepseek-chat`) | 中文好，价格极低 |
| 语义向量 | [SiliconFlow / 硅基流动](https://cloud.siliconflow.cn) (`BAAI/bge-m3`) | DeepSeek 没有 embedding，硅基流动免费/便宜，国内访问稳 |
| MCP 协议 | 官方 [Python `mcp` SDK](https://pypi.python.org/pypi/mcp) (FastMCP) | 一份代码，Codex / OpenClaw / Hermes / Claude Desktop 通用 |
| Web (Phase 2) | FastAPI + Uvicorn | 与 service 层共用 |

---

## Windows 11 快速上手（10 分钟）

### 0. 准备账号 & 充值

| 服务 | 用来做什么 | 大概多少钱 |
|------|-----------|-----------|
| [DeepSeek 开放平台](https://platform.deepseek.com) | 摘要 / 技能提炼 | 充 ¥10 个人用很久 |
| [硅基流动 SiliconFlow](https://cloud.siliconflow.cn) | 语义搜索向量 | BGE-M3 免费额度够个人用 |

注册后各自创建一个 API Key，待会儿要填进 `.env`。

### 1. 装 Python（3.10+）

打开 PowerShell：

```powershell
python --version
```

如果提示找不到，去 [python.org](https://www.python.org/downloads/windows/) 下载 Python 3.12，安装时勾选 **Add python.exe to PATH**。

### 2. 拿代码

```powershell
git clone https://github.com/<你的用户名>/test-repo.git knowledge-capsule
cd knowledge-capsule
```

### 3. 建虚拟环境 + 装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

> 如果 PowerShell 拒绝运行 `Activate.ps1`，先执行一次：
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 4. 填 API Key

```powershell
copy .env.example .env
notepad .env
```

把 `DEEPSEEK_API_KEY` 和 `SILICONFLOW_API_KEY` 改成你刚才申请的 Key，保存。

### 5. 试跑一下

```powershell
python -m knowledge_capsule.mcp_server
```

如果命令行**没报错地挂起**（在那里等输入），说明 MCP Server 已经准备好通过 stdio 接收请求。**按 Ctrl+C 退出**。

---

## 接入 Codex 桌面版

详细步骤在 👉 [`docs/codex-setup.md`](docs/codex-setup.md)。

简而言之：编辑 `%USERPROFILE%\.codex\config.toml`，添加：

```toml
[mcp_servers.knowledge-capsule]
command = "C:/path/to/knowledge-capsule/.venv/Scripts/python.exe"
args = ["-m", "knowledge_capsule.mcp_server"]
```

重启 Codex 桌面版，就能在对话里说 **"帮我保存这条链接 https://..."**，Codex 会自动调用工具把它存进知识胶囊。

---

## 项目结构

```
knowledge-capsule/
├── pyproject.toml              # 依赖与入口点定义
├── .env.example                # 环境变量模板
├── data/                       # SQLite 数据库（已 gitignore）
├── docs/
│   └── codex-setup.md          # Codex 接入详细步骤
└── src/
    └── knowledge_capsule/
        ├── config.py           # 环境变量加载
        ├── models.py           # Pydantic 数据模型
        ├── db.py               # SQLite + sqlite-vec
        ├── ai.py               # DeepSeek + SiliconFlow
        ├── extractor.py        # URL → 正文抓取
        ├── service.py          # 业务编排（MCP/Web 共用）
        ├── mcp_server.py       # Phase 1: MCP Server
        └── web.py              # Phase 2: FastAPI 骨架
```

**关键设计**：所有业务逻辑都在 `service.py`，`mcp_server.py` 和 `web.py` 都只是薄薄的入口适配。Phase 2 加 Web UI 时不需要改任何业务代码。

---

## MCP 工具一览

Codex（或任何 MCP 客户端）启用后，会看到这些工具：

| 工具 | 作用 |
|------|------|
| `save_capture` | 保存一个 URL / 一段文字 / URL+文字组合 |
| `search_notes` | 语义搜索所有收藏 |
| `list_recent_notes` | 按时间倒序列出最近笔记 |
| `mark_practiced` | 标记某条已实践（或撤销） |
| `get_unpracticed_for_review` | 推送未实践的笔记给你回顾 |
| `get_note_detail` | 查看完整内容 |
| `export_note_json` | 导出某条笔记为 JSON |

---

## 路线图

- [x] Phase 1: 本地 MCP Server，接 Codex 桌面版
- [ ] Phase 2: 启用 `web.py`，部署到 Vercel/自己服务器，前端用 Next.js + Tailwind
- [ ] Phase 3: 微信小程序 + 微信登录
- [ ] Phase 4: React Native APP，分享菜单系统级集成
- [ ] Phase 5: 主动提醒（每周回顾邮件 / Bot 推送）

---

## 数据隐私

数据库 `data/capsule.db` 完全在你本地。AI 调用会把内容片段（最多 6000 字符）发送给 DeepSeek 和 SiliconFlow，不会发到其他地方。
