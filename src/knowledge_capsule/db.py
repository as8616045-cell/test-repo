"""SQLite + sqlite-vec storage layer.

Schema:
  - notes: regular table with the note content and AI distillation
  - notes_vec: vec0 virtual table holding the embedding vectors

Both tables are linked by note_id.
"""

from __future__ import annotations

import json
import sqlite3
import struct
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

import sqlite_vec

from .config import settings
from .models import AIDistillation, Note, NoteCreate, SearchHit, SourcePlatform


# ---------- low-level helpers ----------


def _serialize_vector(vector: list[float]) -> bytes:
    """Pack a float vector into the binary format sqlite-vec expects."""
    return struct.pack(f"{len(vector)}f", *vector)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_note(row: sqlite3.Row) -> Note:
    return Note(
        id=row["id"],
        source_platform=SourcePlatform(row["source_platform"]),
        source_url=row["source_url"],
        title=row["title"],
        raw_content=row["raw_content"],
        ai_summary=row["ai_summary"] or "",
        ai_skills=json.loads(row["ai_skills"] or "[]"),
        ai_tags=json.loads(row["ai_tags"] or "[]"),
        practiced=bool(row["practiced"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
        reminded_at=(
            datetime.fromisoformat(row["reminded_at"]) if row["reminded_at"] else None
        ),
    )


# ---------- connection management ----------


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Open a SQLite connection with the sqlite-vec extension loaded."""
    conn = sqlite3.connect(str(settings.database_file))
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if they don't exist. Safe to call multiple times."""
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                source_platform  TEXT    NOT NULL,
                source_url       TEXT,
                title            TEXT,
                raw_content      TEXT    NOT NULL,
                ai_summary       TEXT    NOT NULL DEFAULT '',
                ai_skills        TEXT    NOT NULL DEFAULT '[]',
                ai_tags          TEXT    NOT NULL DEFAULT '[]',
                practiced        INTEGER NOT NULL DEFAULT 0,
                created_at       TEXT    NOT NULL,
                updated_at       TEXT    NOT NULL,
                reminded_at      TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_notes_created_at
                ON notes(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_practiced
                ON notes(practiced, created_at DESC);
            """
        )

        # vec0 virtual table for embeddings (BGE-M3 = 1024 dim)
        conn.execute(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(
                note_id INTEGER PRIMARY KEY,
                embedding FLOAT[{settings.embedding_dimension}]
            );
            """
        )


# ---------- write operations ----------


def insert_note(
    payload: NoteCreate,
    distillation: AIDistillation,
    embedding: list[float],
) -> int:
    """Insert a note plus its embedding, returning the new note id."""
    now = _now_iso()
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO notes (
                source_platform, source_url, title, raw_content,
                ai_summary, ai_skills, ai_tags,
                practiced, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                payload.source_platform.value,
                payload.source_url,
                payload.title,
                payload.raw_content,
                distillation.summary,
                json.dumps(distillation.skills, ensure_ascii=False),
                json.dumps(distillation.tags, ensure_ascii=False),
                now,
                now,
            ),
        )
        note_id = cursor.lastrowid
        assert note_id is not None

        conn.execute(
            "INSERT INTO notes_vec(note_id, embedding) VALUES (?, ?)",
            (note_id, _serialize_vector(embedding)),
        )
        return note_id


def mark_practiced(note_id: int, practiced: bool = True) -> bool:
    """Toggle the practiced flag. Returns True if a row was updated."""
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE notes SET practiced = ?, updated_at = ? WHERE id = ?",
            (1 if practiced else 0, _now_iso(), note_id),
        )
        return cursor.rowcount > 0


def touch_reminded(note_id: int) -> None:
    """Record that we just surfaced this note in a reminder."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE notes SET reminded_at = ? WHERE id = ?",
            (_now_iso(), note_id),
        )


# ---------- read operations ----------


def get_note(note_id: int) -> Optional[Note]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _row_to_note(row) if row else None


def list_recent(limit: int = 20, only_unpracticed: bool = False) -> list[Note]:
    sql = "SELECT * FROM notes"
    params: tuple = ()
    if only_unpracticed:
        sql += " WHERE practiced = 0"
    sql += " ORDER BY created_at DESC LIMIT ?"
    params = params + (limit,)
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note(r) for r in rows]


def search_by_vector(query_embedding: list[float], limit: int = 5) -> list[SearchHit]:
    """KNN search on notes_vec, joined back to notes."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                n.*,
                v.distance AS distance
            FROM notes_vec v
            JOIN notes n ON n.id = v.note_id
            WHERE v.embedding MATCH ?
              AND k = ?
            ORDER BY v.distance
            """,
            (_serialize_vector(query_embedding), limit),
        ).fetchall()
        return [
            SearchHit(note=_row_to_note(row), distance=row["distance"]) for row in rows
        ]
