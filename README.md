# photo2livephoto

> 把一文件夹的静态照片，**批量**转成 iPhone 真正能识别的 Live Photo。
> 不需要本地部署任何 AI 模型；用云端顶级 I2V 模型生成"会动的人物动作"，再自动打包成苹果原生 Live Photo 对（`.jpeg` + `.mov`，带匹配的 `ContentIdentifier`）。

---

## 它解决了什么问题

市面上的"图生视频"分两类：

1. **垃圾档**（SVD、早期 Pika）—— 只是给画面加镜头晃动 / 视差，画面里的人物**不会动**。
2. **真档**（Wan 2.2、Hailuo 02、Kling 3.0、Seedance 2.0）—— 模型理解"画面里的人在做什么"，然后让动作**自然延续**。比如照片里有人在吃面，生成 3 秒视频后，他真的会继续夹一筷子塞嘴里。

本工具**只用第二类模型**，并把生成结果自动打包成 iPhone 原生 Live Photo。

---

## 工作流（一图概括）

```
inbox/                          out/
├── lunch.jpg            ───▶   ├── lunch.jpeg   ┐
├── kid_smile.heic       ───▶   ├── lunch.mov    ┘  ← Live Photo 对
└── dog_running.png             ├── kid_smile.jpeg
                                ├── kid_smile.mov
                                ├── dog_running.jpeg
                                └── dog_running.mov
```

每对 `.jpeg` + `.mov` 已经写好了匹配的 `ContentIdentifier` UUID，AirDrop 到 iPhone 之后，**照片 App 会自动识别为单个 Live Photo**。

---

## 快速开始（5 分钟）

### 1. 装依赖

```bash
# 系统级：必须有 ffmpeg
brew install ffmpeg          # macOS
# sudo apt install ffmpeg    # Ubuntu
# winget install Gyan.FFmpeg # Windows

# Python 包
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 拿一个 API token（二选一）

| 服务 | 注册 | 单条视频价格 | 注 |
|---|---|---|---|
| **Replicate** ⭐推荐 | https://replicate.com → API Tokens | **$0.05** (Wan 2.2 Fast) | 新用户有少量免费额度；后续按用量充值 |
| fal.ai | https://fal.ai/dashboard/keys | $0.05–$0.30 | 模型选择更多（Hailuo / Kling / Wan） |

```bash
cp .env.example .env
# 把 REPLICATE_API_TOKEN=r8_xxx 填进去
```

### 3. 配一下

```bash
cp config.example.yaml config.yaml
# 默认就够用，按需改 model / max_workers
```

### 4. 跑！

```bash
mkdir -p inbox
cp ~/Desktop/photos/*.jpg inbox/

python -m photo2livephoto.cli
```

进度条跑完之后 `out/` 里就是一对一对的 Live Photo 了。

### 5. 传到 iPhone

- **macOS**：在 Finder 里同时选中一对的 `.jpeg` 和 `.mov`，AirDrop 给 iPhone。iPhone 弹"添加到照片图库" → 收下后照片库里就是会动的 Live Photo。
- **Windows / Linux**：用 iCloud 网页版上传 / iCloud for Windows / iMazing 这类工具同步即可，关键是**两个文件必须一起到达 iPhone**。

---

## 模型选择指南

`config.yaml` 里改 `model` 字段：

| `model` | provider | 价格 | 适用场景 |
|---|---|---|---|
| `wan-2.2-fast` ⭐默认 | replicate | ~$0.05/视频 | **首选**。性价比之王，开源 SOTA，动作连贯 |
| `wan-2.2` | replicate | ~$0.20/视频 | 同模型完整版，画质更细 |
| `hailuo-02` | fal | ~$0.27/6 秒 | **物理感**最强（衣物、毛发、水流） |
| `kling-2.1` / `kling-2.5` | fal | $0.30+ | **人物动作**最自然 |
| `wan-2.2-turbo` | fal | ~$0.10/视频 | fal 上的 Wan 加速版 |

**1000 张照片成本估算（默认配置）**：~$50 / ¥360。

---

## 高级用法

### 给单张照片单独写 prompt

在照片旁边放一个同名 `.txt` 文件即可：

```
inbox/
├── lunch.jpg
├── lunch.txt           ← "the man calmly continues eating his bowl of noodles"
├── kid_smile.heic
└── kid_smile.txt       ← "the toddler giggles, blinks, and tilts her head"
```

CLI 会优先读取同名 `.txt`，没有的话就用 `config.yaml` 里的 `default_prompt`。

### 命令行覆盖

```bash
python -m photo2livephoto.cli \
    --input ./family_photos \
    --output ./live_photos \
    --provider fal \
    --model hailuo-02 \
    --prompt "subtle, cinematic, lifelike continuation of the scene"
```

### 并发控制

`config.yaml` 里 `max_workers: 3` 决定一次跑几张。Replicate / fal 都按用量计费，不会因为并发更省钱，但能省墙上时间。

---

## 故障排查

| 现象 | 原因 / 解法 |
|---|---|
| `ffmpeg not found` | 装 ffmpeg（见上文） |
| `REPLICATE_API_TOKEN is not set` | `.env` 没填或 `dotenv` 没加载，确认你在项目根目录跑 |
| iPhone 收下后只是普通照片，不会动 | `.jpeg` 和 `.mov` 必须**同一次** AirDrop 一起选中传输 |
| 生成视频是镜头晃动效果 | 你切到了 `model: wan-2.2-fast` 之外的旧模型；或 prompt 写得太抽象，给具体的动作描述 |
| HEIC 报错 | `pip install pillow-heif` 即可 |

---

## 设计取舍

- **不用本地模型**：Wan 2.2 14B 自己跑要 24GB+ VRAM，对绝大多数用户不现实。  
- **不用免费 HuggingFace Space**：免费 Space 有排队 / 单文件 / 不能脚本批量调用的硬限制，做不到"批量"。  
- **不用国内厂商免费 web UI**：海螺/即梦每日额度太少，且没有公开 API，做不到自动化。  
- **选 Replicate Wan 2.2 Fast**：5 美分一条 + 开源 SOTA + 官方维护 + 稳定的 Python SDK，目前是 **批量 + 高质量 + 可控成本** 唯一的甜点。

---

## 致谢

- [Wan-Video / Wan2.2](https://github.com/Wan-Video/Wan2.2) — 阿里通义万相开源 I2V 模型
- [RhetTbull / makelive](https://github.com/RhetTbull/makelive) — 苹果 Live Photo 元数据写入
- [Replicate](https://replicate.com) / [fal.ai](https://fal.ai) — 模型托管平台
