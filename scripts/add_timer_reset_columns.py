#!/usr/bin/env python
"""
Migration script to add timer_reset_at columns to message and group_message_status tables.

This enables the timer reset feature: when a user unsaves a message, the deletion
timer restarts from the current time rather than deleting on the next scheduler sweep.

Safe to re-run; columns that already exist are skipped.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "instance" / "app.db"


def column_exists(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    """Check if a column exists in a table."""
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"SQLite database not found at {DB_PATH}. Did you run the backend once?")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    added = []

    # Add timer_reset_at to message table
    if not column_exists(cursor, "message", "timer_reset_at"):
        cursor.execute("ALTER TABLE message ADD COLUMN timer_reset_at DATETIME")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_message_timer_reset_at ON message (timer_reset_at)")
        added.append("message.timer_reset_at")
        print("✓ Added timer_reset_at column to message table")
    else:
        print("⊙ message.timer_reset_at already exists")

    # Add timer_reset_at to group_message_status table
    if not column_exists(cursor, "group_message_status", "timer_reset_at"):
        cursor.execute("ALTER TABLE group_message_status ADD COLUMN timer_reset_at DATETIME")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_group_message_status_timer_reset_at ON group_message_status (timer_reset_at)")
        added.append("group_message_status.timer_reset_at")
        print("✓ Added timer_reset_at column to group_message_status table")
    else:
        print("⊙ group_message_status.timer_reset_at already exists")

    conn.commit()
    conn.close()

    if added:
        print(f"\n✓ Migration complete! Added: {', '.join(added)}")
    else:
        print("\n⊙ No changes needed. Database already up to date.")


if __name__ == "__main__":
    main()
