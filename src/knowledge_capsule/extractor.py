"""URL content extraction.

Reality check: 小红书 / 抖音 aggressively block crawlers and serve their real
content via JS. So this module is intentionally honest about what it can and
cannot do:

  - Generic web pages (blogs, news, public articles): full readability extraction.
  - X / Twitter: best-effort oEmbed; otherwise just the URL is recorded.
  - 小红书 / 抖音: platform is detected so the AI knows the source, but we don't
    pretend to scrape — the caller is expected to paste the actual文案 / 字幕
    alongside the URL when capturing from these platforms.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from readability import Document

from .models import SourcePlatform


logger = logging.getLogger(__name__)


_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_URL_PATTERN = re.compile(r"https?://[^\s]+", re.IGNORECASE)


@dataclass
class ExtractedContent:
    """What we managed to pull from a URL."""

    platform: SourcePlatform
    url: str
    title: Optional[str] = None
    text: str = ""
    note: Optional[str] = None  # human-readable hint about extraction quality


# ---------- platform detection ----------


def detect_platform(url: str) -> SourcePlatform:
    """Best-effort platform detection from the host portion of a URL."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return SourcePlatform.UNKNOWN

    if not host:
        return SourcePlatform.UNKNOWN

    if "xiaohongshu.com" in host or "xhslink.com" in host:
        return SourcePlatform.XIAOHONGSHU
    if "douyin.com" in host or "iesdouyin.com" in host:
        return SourcePlatform.DOUYIN
    if host in {"x.com", "twitter.com"} or host.endswith(".x.com") or host.endswith(".twitter.com"):
        return SourcePlatform.X
    return SourcePlatform.WEB


def find_first_url(text: str) -> Optional[str]:
    """Pull the first URL out of a free-form pasted string."""
    match = _URL_PATTERN.search(text)
    return match.group(0) if match else None


# ---------- fetching ----------


async def fetch_url(url: str, timeout: float = 15.0) -> ExtractedContent:
    """Fetch a URL and try to extract clean title + body text.

    Always returns an ExtractedContent (never raises) — failures are surfaced
    via the `note` field so the caller can still save *something*.
    """
    platform = detect_platform(url)

    # 平台特定提示：明确告诉调用方哪些平台只能拿到链接
    if platform == SourcePlatform.XIAOHONGSHU:
        return ExtractedContent(
            platform=platform,
            url=url,
            note="小红书反爬严格，无法自动抓取正文。请把文案 / 截图 OCR 内容一并粘贴。",
        )
    if platform == SourcePlatform.DOUYIN:
        return ExtractedContent(
            platform=platform,
            url=url,
            note="抖音反爬严格，无法自动抓取视频字幕。请把字幕 / 文案一并粘贴。",
        )

    headers = {"User-Agent": _USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
    except Exception as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return ExtractedContent(
            platform=platform,
            url=url,
            note=f"抓取失败：{e}. 请把内容直接粘贴。",
        )

    title, text = _extract_article(html)

    if not text:
        return ExtractedContent(
            platform=platform,
            url=url,
            title=title,
            note="未能提取到正文（可能是 JS 渲染页面）。请粘贴内容或截图。",
        )

    return ExtractedContent(platform=platform, url=url, title=title, text=text)


# ---------- HTML -> clean text ----------


def _extract_article(html: str) -> tuple[Optional[str], str]:
    """Run readability + a BeautifulSoup pass to get title and plain text."""
    title: Optional[str] = None
    text = ""

    # 1. readability for main content
    try:
        doc = Document(html)
        title = (doc.short_title() or "").strip() or None
        summary_html = doc.summary(html_partial=True)
        soup = BeautifulSoup(summary_html, "html.parser")
        text = soup.get_text("\n", strip=True)
    except Exception as e:
        logger.warning("readability failed: %s", e)

    # 2. fallback: grab the page title from <title> if readability missed it
    if not title:
        try:
            soup = BeautifulSoup(html, "html.parser")
            if soup.title and soup.title.string:
                title = soup.title.string.strip()
        except Exception:
            pass

    return title, text
