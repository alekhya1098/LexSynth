"""
SQLite-based query history — persists research sessions across restarts.
"""
import sqlite3
import json
import os
from datetime import datetime
from pathlib import Path

DB_PATH = os.getenv("HISTORY_DB", "./history.db")


def _conn():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with _conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts        TEXT NOT NULL,
                question  TEXT NOT NULL,
                jurisdiction TEXT,
                memo      TEXT,
                accuracy  TEXT,
                angles    TEXT,
                sources   TEXT
            )
        """)
        con.commit()


def save_session(question: str, jurisdiction: str, memo: str,
                 accuracy: dict, angles: list, sources: list) -> int:
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO sessions (ts,question,jurisdiction,memo,accuracy,angles,sources) VALUES (?,?,?,?,?,?,?)",
            (
                datetime.utcnow().isoformat(),
                question, jurisdiction,
                memo,
                json.dumps(accuracy),
                json.dumps(angles),
                json.dumps(sources),
            )
        )
        con.commit()
        return cur.lastrowid


def list_sessions(limit: int = 50) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT id,ts,question,jurisdiction FROM sessions ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_session(session_id: int) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    for key in ("accuracy", "angles", "sources"):
        try:
            d[key] = json.loads(d[key] or "null")
        except Exception:
            d[key] = None
    return d


def delete_session(session_id: int):
    with _conn() as con:
        con.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        con.commit()


init_db()
