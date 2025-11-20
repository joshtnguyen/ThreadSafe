#!/usr/bin/env python3
"""Utility script to permanently delete expired messages."""

from __future__ import annotations

from datetime import datetime

from backend import create_app, db
from backend.models import Message

BATCH_SIZE = 500


def purge_expired_messages() -> int:
    """Delete expired messages in batches to avoid locking the table."""
    total_deleted = 0
    while True:
        expired = (
            Message.query.filter(Message.expiryTime <= datetime.utcnow())
            .order_by(Message.expiryTime.asc())
            .limit(BATCH_SIZE)
            .all()
        )
        if not expired:
            break
        for message in expired:
            db.session.delete(message)
        db.session.commit()
        total_deleted += len(expired)
    return total_deleted


def main() -> None:
    app = create_app()
    with app.app_context():
        deleted = purge_expired_messages()
        print(f"Deleted {deleted} expired messages.")


if __name__ == "__main__":
    main()
