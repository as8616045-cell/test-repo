"""AI providers: DeepSeek for distillation, SiliconFlow for embeddings.

Both providers expose OpenAI-compatible APIs, so we use the official `openai`
SDK with custom base URLs.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from openai import AsyncOpenAI

from .config import settings
from .models import AIDistillation


logger = logging.getLogger(__name__)


# ---------- clients ----------


def _deepseek_client() -> AsyncOpenAI:
    if not settings.deepseek_api_key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is not configured. Set it in .env to enable distillation."
        )
    return AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )


def _siliconflow_client() -> AsyncOpenAI:
    if not settings.siliconflow_api_key:
        raise RuntimeError(
            "SILICONFLOW_API_KEY is not configured. Set it in .env to enable semantic search."
        )
    return AsyncOpenAI(
        api_key=settings.siliconflow_api_key,
        base_url=settings.siliconflow_base_url,
    )


# ---------- distillation (summary + skills + tags) ----------


_DISTILL_SYSTEM_PROMPT = """你是一个专业的"知识提炼助手"。你的任务是从用户提供的内容（文章、短视频文案、社交媒体帖子等）中，提炼出对个人成长真正有用的信息。

请严格输出 JSON 格式，包含三个字段：
1. summary: 一段中文摘要，不超过 200 字，抓住内容最核心的洞见或观点
2. skills: 一个数组，列出从内容中可以"立即实践"的具体技巧或方法。每条都要具体到"做什么、怎么做"，避免空洞的口号。最多 5 条，没有就给空数组。
3. tags: 一个数组，给内容打 1-4 个主题标签，如"沟通"、"写作"、"时间管理"、"投资"、"健身"等。

要求：
- 只输出 JSON，不要任何其他文字
- 中文输出
- skills 强调可操作性，比如"汇报先说结论再说原因"，而不是"提高沟通能力"
"""


_DISTILL_USER_TEMPLATE = """请提炼以下内容：

来源平台：{platform}
标题：{title}
正文：
{content}
"""


async def distill(
    content: str,
    platform: str = "unknown",
    title: Optional[str] = None,
) -> AIDistillation:
    """Use DeepSeek to extract summary, actionable skills, and tags.

    Returns an empty distillation on failure (so the note can still be saved).
    """
    if not content.strip():
        return AIDistillation()

    client = _deepseek_client()
    user_prompt = _DISTILL_USER_TEMPLATE.format(
        platform=platform,
        title=title or "(无)",
        content=content[:6000],  # rough cap to keep tokens manageable
    )

    try:
        response = await client.chat.completions.create(
            model=settings.deepseek_model,
            messages=[
                {"role": "system", "content": _DISTILL_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        return AIDistillation(
            summary=str(data.get("summary", "")).strip(),
            skills=[str(s).strip() for s in data.get("skills", []) if str(s).strip()],
            tags=[str(t).strip() for t in data.get("tags", []) if str(t).strip()],
        )
    except Exception as e:
        logger.warning("Distillation failed, falling back to empty: %s", e)
        return AIDistillation()


# ---------- embeddings ----------


async def embed(text: str) -> list[float]:
    """Get a 1024-dim BGE-M3 embedding from SiliconFlow.

    Raises if the API call fails (an empty embedding would silently break search).
    """
    client = _siliconflow_client()
    response = await client.embeddings.create(
        model=settings.embedding_model,
        input=text[:8000],  # BGE-M3 supports up to 8192 tokens
    )
    return response.data[0].embedding


async def embed_for_indexing(distillation: AIDistillation, raw_content: str) -> list[float]:
    """Build the text we embed for a saved note.

    We embed a concatenation of summary + skills + tags + a slice of raw content.
    This makes semantic search match both natural-language queries and the
    actual phrases in the original.
    """
    parts: list[str] = []
    if distillation.summary:
        parts.append(distillation.summary)
    if distillation.skills:
        parts.append("可执行技巧：" + "；".join(distillation.skills))
    if distillation.tags:
        parts.append("标签：" + " ".join(distillation.tags))
    parts.append(raw_content[:1500])
    return await embed("\n\n".join(parts))
