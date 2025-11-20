#!/usr/bin/env python3
"""
Background scheduler for periodic message cleanup.

This script runs the cleanup job every minute to delete expired messages
based on per-user retention settings.

Usage:
    python scheduler.py
"""
import time
from datetime import datetime

from backend import create_app
from backend.utils.cleanup_manager import cleanup_expired_messages


def run_cleanup_job():
    """Run the cleanup job within application context."""
    app = create_app()
    with app.app_context():
        print(f"\n[{datetime.utcnow().isoformat()}] Running cleanup job...")
        result = cleanup_expired_messages()
        print(f"  Hard deleted: {result['hard_deleted_count']} messages")
        print(f"  Soft deleted: {result['soft_deleted_count']} messages")
        print(f"  Total modified: {result['messages_modified']} messages")
        print(f"  Checked: {result['checked_count']} messages")


def main():
    """Run cleanup job every 5 seconds."""
    print("Starting message cleanup scheduler...")
    print("Runs every 5 seconds for real-time deletion")
    print("Press Ctrl+C to stop")

    try:
        while True:
            run_cleanup_job()
            print(f"Sleeping for 5 seconds...")
            time.sleep(5)  # Run every 5 seconds for near-real-time deletion
    except KeyboardInterrupt:
        print("\nScheduler stopped by user")


if __name__ == "__main__":
    main()
