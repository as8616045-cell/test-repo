# 把"知识胶囊"接入 Codex 桌面版

> 假设你已经按 [README](../README.md) 跑通过 `python -m knowledge_capsule.mcp_server`。

---

## 1. 装 Codex 桌面版（Windows 11）

如果还没装：

1. 去 [openai.com/codex](https://openai.com/codex/) 下载 Windows 版（自 2026 年 3 月 4 日起可用）
2. 用 ChatGPT 账号登录

---

## 2. 找到 Codex 配置文件

Codex 的 CLI、IDE 插件、桌面版**共用同一个配置文件**：

```
%USERPROFILE%\.codex\config.toml
```

> 在 PowerShell 里看具体路径：`echo $env:USERPROFILE\.codex\config.toml`

如果文件不存在：

```powershell
mkdir $env:USERPROFILE\.codex -Force
ni $env:USERPROFILE\.codex\config.toml -ItemType File -Force
```

---

## 3. 找到你项目的 venv Python 路径

在你 clone 项目的目录里：

```powershell
(Get-Command python).Source
```

激活 venv 后这条命令会返回类似：

```
C:\Users\你\knowledge-capsule\.venv\Scripts\python.exe
```

把这条路径复制下来。

---

## 4. 编辑 `config.toml`

```powershell
notepad $env:USERPROFILE\.codex\config.toml
```

加入这一段（**注意斜杠用 `/` 或者双反斜杠 `\\`，TOML 里单反斜杠是转义符**）：

```toml
[mcp_servers.knowledge-capsule]
command = "C:/Users/你/knowledge-capsule/.venv/Scripts/python.exe"
args = ["-m", "knowledge_capsule.mcp_server"]
```

如果你不想依赖 `.env` 文件，也可以把 API Key 直接写在配置里（**不推荐，明文存储**）：

```toml
[mcp_servers.knowledge-capsule]
command = "C:/Users/你/knowledge-capsule/.venv/Scripts/python.exe"
args = ["-m", "knowledge_capsule.mcp_server"]
env = { DEEPSEEK_API_KEY = "sk-...", SILICONFLOW_API_KEY = "sk-..." }
```

> 推荐做法：保留 `.env` 文件方式，更安全，也方便切环境。

保存关闭。

---

## 5. 重启 Codex 桌面版

完全退出（任务栏右下角图标右键 → Quit），再重新打开。

---

## 6. 验证：在 Codex 里测试

打开 Codex 的对话框，输入：

```
帮我保存这条内容：
"汇报时先说结论，再说三个支撑要点，最后讲风险点。这是 BLUF 沟通法。"
```

Codex 应该会：

1. 识别到你想用 `save_capture` 工具
2. 调用 MCP Server
3. 几秒后返回一个 ✅ 卡片，包含：
   - 笔记 id
   - AI 生成的摘要
   - 抽取出的可执行技巧
   - 自动打的标签

接着试搜索：

```
搜索一下我之前收藏的关于汇报的内容
```

Codex 会调用 `search_notes`，返回相关笔记。

---

## 7. 常见问题

### Q1: Codex 看不到工具

- 检查 `config.toml` 里 `[mcp_servers.knowledge-capsule]` 这行没有打错
- 确保 `command` 路径里的 Python 是项目 venv 里的，不是系统 Python（否则找不到包）
- 完全退出 Codex 再重启，不只是关闭窗口
- 在 Codex 设置里查看 MCP Servers 状态，看是否报错

### Q2: 调用工具时报"DEEPSEEK_API_KEY is not configured"

- 检查项目根目录有没有 `.env` 文件（`.env.example` 不算）
- 或者把 key 直接写到 `config.toml` 的 `env = {...}` 里

### Q3: 路径里有中文 / 空格

把 TOML 里的 `command` 用引号包好，斜杠改成 `/`，例如：

```toml
command = "C:/Users/张三 的电脑/knowledge-capsule/.venv/Scripts/python.exe"
```

### Q4: 想看 MCP Server 的日志

启动时把 stderr 重定向：

```toml
[mcp_servers.knowledge-capsule]
command = "C:/Users/你/knowledge-capsule/.venv/Scripts/python.exe"
args = ["-m", "knowledge_capsule.mcp_server"]
# 或者临时手动跑：
# python -m knowledge_capsule.mcp_server 2> mcp.log
```

---

## 同样适用于其他 MCP 客户端

把上面的 `[mcp_servers.knowledge-capsule]` 段配置（命令 + 参数）按各家格式填到对应客户端：

| 客户端 | 配置文件位置 |
|-------|-------------|
| **Codex 桌面版 / CLI / IDE** | `~/.codex/config.toml` |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json`（JSON 格式） |
| **OpenClaw** | 看 OpenClaw 的 `agents.toml` 或 SOUL 目录 |
| **Hermes Agent** | 看 Hermes 的 skills 配置 |

格式略有不同，但 `command` + `args` + 可选 `env` 这三个核心字段是通用的。
