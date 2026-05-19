"""MCP server entry point.

Exposes the knowledge capsule capabilities as MCP tools so Codex (and any
other MCP-aware agent: OpenClaw, Hermes, Claude Desktop, etc.) can call them.

Each tool returns plain strings that read well in an agent's chat output.
Structured payloads are also embedded as JSON inside those strings for
downstream tooling.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from mcp.server.fastmcp import FastMCP

from . import service
from .models import Note, SearchHit, SourcePlatform


logger = logging.getLogger("knowledge_capsule.mcp")

mcp = FastMCP("knowledge-capsule")


# ---------- formatting helpers ----------


def _format_note(note: Note, include_raw: bool = False) -> dict:
    payload = {
        "id": note.id,
        "platform": note.source_platform.value,
        "title": note.title,
        "url": note.source_url,
        "summary": note.ai_summary,
        "skills": note.ai_skills,
        "tags": note.ai_tags,
        "practiced": note.practiced,
        "created_at": note.created_at.isoformat(),
    }
    if include_raw:
        payload["raw_content"] = note.raw_content
    return payload


def _render_note_card(note: Note) -> str:
    lines = [
        f"#{note.id}  [{note.source_platform.value}]"
        + (f"  {note.title}" if note.title else ""),
    ]
    if note.source_url:
        lines.append(f"链接：{note.source_url}")
    if note.ai_summary:
        lines.append(f"摘要：{note.ai_summary}")
    if note.ai_skills:
        lines.append("可执行技巧：")
        lines.extend(f"  - {s}" for s in note.ai_skills)
    if note.ai_tags:
        lines.append("标签：" + " / ".join(note.ai_tags))
    lines.append(f"实践状态：{'已实践' if note.practiced else '未实践'}")
    lines.append(f"收藏时间：{note.created_at.strftime('%Y-%m-%d %H:%M')}")
    return "\n".join(lines)


def _render_search_hit(hit: SearchHit) -> str:
    return f"[相关度 {1 / (1 + hit.distance):.2f}]\n{_render_note_card(hit.note)}"


# ---------- tools ----------


@mcp.tool()
async def save_capture(
    content: str,
    platform_hint: Optional[str] = None,
    extra_context: Optional[str] = None,
) -> str:
    """保存一条新的"知识胶囊"。

    参数：
      content: 必填。可以是一个 URL、一段文字（如截图 OCR 出的内容），或者
        URL + 文字混合。系统会自动检测 URL 并抓取正文（小红书/抖音等反爬严格
        的平台只会保留链接，请把文案一并粘贴）。
      platform_hint: 可选。手动指定来源平台。可选值：xhs（小红书）、douyin
        （抖音）、x、web、screenshot、text。不填则按 URL 自动判断。
      extra_context: 可选。补充说明，比如你想记下"为什么收藏这条"。

    返回：保存成功的提示，包含新笔记的 id、AI 提炼出的摘要和可执行技巧。
    """
    hint = None
    if platform_hint:
        try:
            hint = SourcePlatform(platform_hint.lower())
        except ValueError:
            return f"❌ platform_hint 无效：{platform_hint}。可选值：xhs / douyin / x / web / screenshot / text"

    try:
        note = await service.save_capture(content, hint, extra_context)
    except ValueError as e:
        return f"❌ {e}"
    except RuntimeError as e:
        return f"❌ 配置缺失：{e}"
    except Exception as e:
        logger.exception("save_capture failed")
        return f"❌ 保存失败：{e}"

    return "✅ 已保存\n\n" + _render_note_card(note)


@mcp.tool()
async def search_notes(query: str, limit: int = 5) -> str:
    """对收藏的所有内容做语义搜索。

    用大白话描述你想找的东西即可，比如"如何向上汇报"、"提高专注力的方法"。
    返回最相关的若干条笔记，按相关度排序。

    参数：
      query: 必填。搜索语句（中文/英文都行）。
      limit: 可选，默认 5，最多返回多少条。
    """
    if not query.strip():
        return "❌ 搜索词不能为空"

    try:
        hits = await service.search(query, limit=max(1, min(limit, 20)))
    except RuntimeError as e:
        return f"❌ 配置缺失：{e}"
    except Exception as e:
        logger.exception("search failed")
        return f"❌ 搜索失败：{e}"

    if not hits:
        return f"没有找到与「{query}」相关的笔记。"

    blocks = [_render_search_hit(h) for h in hits]
    return f"找到 {len(hits)} 条相关笔记：\n\n" + "\n\n---\n\n".join(blocks)


@mcp.tool()
def list_recent_notes(limit: int = 10, only_unpracticed: bool = False) -> str:
    """按时间倒序列出最近收藏的笔记。

    参数：
      limit: 可选，默认 10。
      only_unpracticed: 可选，True 时只列出未标记为已实践的笔记。
    """
    notes = service.list_recent(
        limit=max(1, min(limit, 50)),
        only_unpracticed=only_unpracticed,
    )
    if not notes:
        return "目前还没有任何笔记。"
    blocks = [_render_note_card(n) for n in notes]
    return f"最近 {len(notes)} 条笔记：\n\n" + "\n\n---\n\n".join(blocks)


@mcp.tool()
def mark_practiced(note_id: int, practiced: bool = True) -> str:
    """把一条笔记标记为"已实践"或撤销该标记。

    参数：
      note_id: 必填，笔记的 id。
      practiced: 可选，默认 True。传 False 可以撤销标记。
    """
    ok = service.mark_practiced(note_id, practiced=practiced)
    if not ok:
        return f"❌ 没找到 id={note_id} 的笔记"
    state = "已实践 ✅" if practiced else "未实践 ⏳"
    return f"笔记 #{note_id} 状态更新为：{state}"


@mcp.tool()
def get_unpracticed_for_review(limit: int = 5) -> str:
    """从你"还没实践"的笔记里挑几条出来回顾，鼓励你真正用起来。

    每次调用会把这些笔记的 reminded_at 标记为当前时间，方便后续避免重复推送。

    参数：
      limit: 可选，默认 5。
    """
    notes = service.get_unpracticed_for_review(limit=max(1, min(limit, 20)))
    if not notes:
        return "🎉 没有未实践的笔记，全部已经标记为已实践了！"
    blocks = [_render_note_card(n) for n in notes]
    return (
        f"📌 你有 {len(notes)} 条收藏过但还没实践的笔记，挑一条今天试试看？\n\n"
        + "\n\n---\n\n".join(blocks)
    )


@mcp.tool()
def get_note_detail(note_id: int) -> str:
    """查看某条笔记的完整内容（包括原始正文）。

    参数：
      note_id: 必填，笔记的 id。
    """
    note = service.get_note(note_id)
    if not note:
        return f"❌ 没找到 id={note_id} 的笔记"
    return _render_note_card(note) + "\n\n[原始内容]\n" + note.raw_content


@mcp.tool()
def export_note_json(note_id: int) -> str:
    """以 JSON 形式导出一条笔记。给需要进一步处理的下游工具用。"""
    note = service.get_note(note_id)
    if not note:
        return f"❌ 没找到 id={note_id} 的笔记"
    return json.dumps(_format_note(note, include_raw=True), ensure_ascii=False, indent=2)


# ---------- entry point ----------


def main() -> None:
    """Run the MCP server over stdio (the transport Codex desktop expects)."""
    logging.basicConfig(level=logging.INFO)
    mcp.run()


if __name__ == "__main__":
    main()
