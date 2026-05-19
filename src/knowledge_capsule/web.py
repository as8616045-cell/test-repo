"""FastAPI web skeleton (Phase 2).

Phase 1 (current): 你只用 MCP Server，这个文件不会被启动。
Phase 2 (later):   ``knowledge-capsule-web`` 命令启动这个 API，给浏览器 /
                   小程序前端使用。后端逻辑完全复用 service.py。

启动方式（Phase 2 时再用）：
    knowledge-capsule-web
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import service
from .config import settings
from .models import Note, SearchHit, SourcePlatform


logger = logging.getLogger(__name__)


app = FastAPI(
    title="Knowledge Capsule API",
    version="0.1.0",
    description="Phase 2 web frontend for the knowledge capsule. Same backend as the MCP server.",
)


# ---------- request models ----------


class SaveRequest(BaseModel):
    content: str = Field(..., description="URL 或文字，可混合")
    platform_hint: Optional[SourcePlatform] = None
    extra_context: Optional[str] = None


class PracticeRequest(BaseModel):
    practiced: bool = True


# ---------- endpoints ----------


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


@app.post("/notes", response_model=Note)
async def create_note(req: SaveRequest) -> Note:
    try:
        return await service.save_capture(
            content=req.content,
            hint_platform=req.platform_hint,
            extra_context=req.extra_context,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/notes", response_model=list[Note])
def get_notes(limit: int = 20, only_unpracticed: bool = False) -> list[Note]:
    return service.list_recent(
        limit=max(1, min(limit, 100)),
        only_unpracticed=only_unpracticed,
    )


@app.get("/notes/{note_id}", response_model=Note)
def get_note(note_id: int) -> Note:
    note = service.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
    return note


@app.patch("/notes/{note_id}/practice", response_model=Note)
def update_practice(note_id: int, req: PracticeRequest) -> Note:
    if not service.mark_practiced(note_id, practiced=req.practiced):
        raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
    note = service.get_note(note_id)
    assert note is not None
    return note


@app.get("/search", response_model=list[SearchHit])
async def search(q: str, limit: int = 5) -> list[SearchHit]:
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query 'q' must not be empty.")
    try:
        return await service.search(q, limit=max(1, min(limit, 20)))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/review", response_model=list[Note])
def review(limit: int = 5) -> list[Note]:
    return service.get_unpracticed_for_review(limit=max(1, min(limit, 20)))


# ---------- entry point ----------


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(
        "knowledge_capsule.web:app",
        host=settings.web_host,
        port=settings.web_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
