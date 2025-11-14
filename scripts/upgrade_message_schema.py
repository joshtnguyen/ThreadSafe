#!/usr/bin/env python
"""
Utility script to backfill the `message` table with the new encryption columns.

Older SQLite databases were created before the hybrid-encryption fields
(`encrypted_aes_key`, `ephemeral_public_key`, etc.) existed. When the
application loads conversations it now selects those columns and SQLite
raises `OperationalError: no such column ...`.

Running this script once upgrades the existing `instance/app.db` by adding the
missing columns if they do not already exist. Safe to re-run; columns that
already exist are skipped.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "instance" / "app.db"

# Column definitions (column name -> SQL fragment for ALTER TABLE)
COLUMNS = {
    "encrypted_aes_key": "TEXT",
    "ephemeral_public_key": "TEXT",
    "sender_encrypted_content": "TEXT",
    "sender_iv": "TEXT",
    "sender_hmac": "TEXT",
    "sender_encrypted_aes_key": "TEXT",
    "sender_ephemeral_public_key": "TEXT",
}


def column_exists(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"SQLite database not found at {DB_PATH}. Did you run the backend once?")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    added = []
    for column, definition in COLUMNS.items():
        if column_exists(cursor, "message", column):
            continue
        cursor.execute(f"ALTER TABLE message ADD COLUMN {column} {definition}")
        added.append(column)

    conn.commit()
    conn.close()

    if added:
        print(f"Added columns to message table: {', '.join(added)}")
    else:
        print("Message table already contains the required columns.")


if __name__ == "__main__":
    main()
