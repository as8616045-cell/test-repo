"""Pydantic models for the knowledge capsule domain."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SourcePlatform(str, Enum):
    """Where the note came from."""

    XIAOHONGSHU = "xhs"
    DOUYIN = "douyin"
    X = "x"
    WEB = "web"
    SCREENSHOT = "screenshot"
    TEXT = "text"
    UNKNOWN = "unknown"


class NoteCreate(BaseModel):
    """Input payload when saving a new note."""

    source_url: Optional[str] = None
    raw_content: str
    title: Optional[str] = None
    source_platform: SourcePlatform = SourcePlatform.UNKNOWN


class AIDistillation(BaseModel):
    """Structured output from the AI distillation step."""

    summary: str = Field(default="", description="Concise summary in Chinese.")
    skills: list[str] = Field(
        default_factory=list,
        description="Concrete, actionable techniques extracted from the content.",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Topic tags for the note.",
    )


class Note(BaseModel):
    """A fully hydrated note as stored in the database."""

    id: int
    source_platform: SourcePlatform
    source_url: Optional[str] = None
    title: Optional[str] = None
    raw_content: str
    ai_summary: str = ""
    ai_skills: list[str] = Field(default_factory=list)
    ai_tags: list[str] = Field(default_factory=list)
    practiced: bool = False
    created_at: datetime
    updated_at: datetime
    reminded_at: Optional[datetime] = None


class SearchHit(BaseModel):
    """A single hit returned from semantic search."""

    note: Note
    distance: float = Field(description="Lower means more relevant.")
