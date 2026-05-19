"""Business orchestration: combine extractor + AI + db into user-facing flows.

This is the single place where the MCP server and the future Web API both go
to perform high-level operations. Keep entry points thin; keep policy here.
"""

from __future__ import annotations

import logging
from typing import Optional

from . import ai, db, extractor
from .models import (
    AIDistillation,
    Note,
    NoteCreate,
    SearchHit,
    SourcePlatform,
)


logger = logging.getLogger(__name__)


# ---------- save flow ----------


async def save_capture(
    content: str,
    hint_platform: Optional[SourcePlatform] = None,
    extra_context: Optional[str] = None,
) -> Note:
    """Save anything: a URL, free-form text, or a URL with surrounding context.

    Steps:
      1. If a URL is found, fetch + extract its content (best effort).
      2. Combine extracted text with any user-supplied context.
      3. Distill with DeepSeek (summary + skills + tags).
      4. Embed the distilled+raw text with BGE-M3.
      5. Persist to SQLite + vec0 table.
    """
    db.init_db()

    raw = (content or "").strip()
    extra = (extra_context or "").strip()
    if not raw and not extra:
        raise ValueError("Cannot save an empty capture.")

    url = extractor.find_first_url(raw)
    title: Optional[str] = None
    platform = hint_platform or SourcePlatform.TEXT
    extraction_note: Optional[str] = None

    if url:
        extracted = await extractor.fetch_url(url)
        platform = hint_platform or extracted.platform
        title = extracted.title
        extraction_note = extracted.note

        # Build the canonical raw_content. Order: extracted body, then user's
        # supplemental text, then a marker about extraction quality if any.
        sections: list[str] = []
        if extracted.text:
            sections.append(extracted.text)
        # User's free-form text (everything they wrote, including the URL line)
        # is preserved so we never lose context they typed in by hand.
        if raw and raw != url:
            sections.append(f"[原始输入]\n{raw}")
        if extra:
            sections.append(f"[补充说明]\n{extra}")
        if extraction_note and not extracted.text:
            sections.append(f"[抓取提示] {extraction_note}")
        raw_content = "\n\n".join(sections).strip() or url
    else:
        # Pure text capture (e.g. a screenshot OCR result the user pasted).
        platform = hint_platform or SourcePlatform.TEXT
        raw_content = raw if not extra else f"{raw}\n\n[补充说明]\n{extra}"

    payload = NoteCreate(
        source_url=url,
        raw_content=raw_content,
        title=title,
        source_platform=platform,
    )

    distillation = await ai.distill(
        content=raw_content,
        platform=platform.value,
        title=title,
    )
    embedding = await ai.embed_for_indexing(distillation, raw_content)

    note_id = db.insert_note(payload, distillation, embedding)
    saved = db.get_note(note_id)
    assert saved is not None
    return saved


# ---------- search & list ----------


async def search(query: str, limit: int = 5) -> list[SearchHit]:
    """Semantic search over saved notes."""
    db.init_db()
    if not query.strip():
        return []
    query_vector = await ai.embed(query)
    return db.search_by_vector(query_vector, limit=limit)


def list_recent(limit: int = 20, only_unpracticed: bool = False) -> list[Note]:
    db.init_db()
    return db.list_recent(limit=limit, only_unpracticed=only_unpracticed)


def get_note(note_id: int) -> Optional[Note]:
    db.init_db()
    return db.get_note(note_id)


# ---------- practice & review ----------


def mark_practiced(note_id: int, practiced: bool = True) -> bool:
    db.init_db()
    return db.mark_practiced(note_id, practiced=practiced)


def get_unpracticed_for_review(limit: int = 5) -> list[Note]:
    """Surface notes the user collected but never marked as practiced.

    Side effect: stamps `reminded_at` on each returned note so future calls
    can prefer ones that haven't been resurfaced recently (future enhancement).
    """
    db.init_db()
    notes = db.list_recent(limit=limit, only_unpracticed=True)
    for note in notes:
        db.touch_reminded(note.id)
    return notes
