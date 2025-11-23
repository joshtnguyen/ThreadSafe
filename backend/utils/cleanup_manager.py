"""Message cleanup manager with sender-driven deletion logic."""
from __future__ import annotations

from datetime import datetime, timedelta
from sqlalchemy import or_

from ..database import db
from ..models import Message, User
from ..websocket_helper import emit_message_deleted


def cleanup_expired_messages() -> dict:
    """
    Delete expired messages based on sender-driven deletion logic.

    Sender-Driven Deletion Rules:
    1. Saved messages → Never mark as deleted
    2. Both parties read → Use sender's retention to delete sender copy and receiver copy (skips sides that are saved)
    3. Not read by both → Mark deleted for both at (sent_time + 24 hours)
    4. Actually delete message when deleted_for_sender AND deleted_for_receiver both true

    Returns:
        dict: Statistics about deleted/soft-deleted messages
    """
    now = datetime.utcnow()
    hard_deleted_count = 0
    soft_deleted_count = 0
    messages_modified = 0

    # Smart query: Only check messages that could actually expire
    # Skip messages that are:
    # 1. Already deleted for both parties (nothing to do)
    # Note: We check per-user saved status later in the loop
    messages_to_check = Message.query.filter(
        or_(
            Message.deleted_for_sender == False,
            Message.deleted_for_receiver == False
        )
    ).all()

    print(f"Smart query: Checking {len(messages_to_check)} messages (skipped fully-deleted messages)")

    for message in messages_to_check:
        modified = False

        # Skip unsent messages - they are handled by cleanup_unsent_placeholders()
        if message.is_unsent:
            continue

        # Get sender and receiver
        sender = User.query.get(message.senderID)
        receiver = User.query.get(message.receiverID)

        if not sender or not receiver:
            continue

        # Shared saved flag: if either user saved, treat as saved for both
        is_saved = bool(message.saved_by_sender or message.saved_by_receiver)

        # Get sender's retention setting (in hours). Receiver's timer should not delete incoming messages.
        sender_retention_hours = sender.settings.get('messageRetentionHours', 24) if sender.settings else 24

        # Debug: Print retention settings
        print(f"  Message {message.msgID}: Sender({sender.username}) retention={sender_retention_hours}h")

        # Check if both parties have read the message
        print(f"    read_by_sender_at: {message.read_by_sender_at}, read_by_receiver_at: {message.read_by_receiver_at}")
        if message.read_by_sender_at and message.read_by_receiver_at:
            # Both read: Use sender retention from when both read
            both_read_time = max(message.read_by_sender_at, message.read_by_receiver_at)

            # Use sender's retention to drive deletion for both sides
            sender_start_time = both_read_time
            if sender.settings_updated_at and sender.settings_updated_at > both_read_time:
                sender_start_time = sender.settings_updated_at
                print(f"    Sender changed settings at {sender.settings_updated_at}, using as start time")

            sender_deletion_time = sender_start_time + timedelta(hours=sender_retention_hours)
            time_until_sender_delete = (sender_deletion_time - now).total_seconds()
            print(f"    Sender-driven deletion in {time_until_sender_delete:.1f}s (start time: {sender_start_time})")

            if now >= sender_deletion_time:
                if is_saved:
                    print("    Message is saved - skipping deletion for both users")
                else:
                    if not message.deleted_for_sender:
                        print(f"    -> Deleting for SENDER {sender.username}")
                        message.deleted_for_sender = True
                        modified = True
                        soft_deleted_count += 1
                        emit_message_deleted(message.senderID, message.msgID, message.receiverID)

                    if not message.deleted_for_receiver:
                        print(f"    -> Deleting for RECEIVER {receiver.username} (sender retention hit)")
                        message.deleted_for_receiver = True
                        modified = True
                        soft_deleted_count += 1
                        emit_message_deleted(message.receiverID, message.msgID, message.senderID)
        else:
            # Not read by both: Apply 24-hour fallback for both users
            fallback_deletion_time = message.timeStamp + timedelta(hours=24)
            time_until_fallback = (fallback_deletion_time - now).total_seconds()
            print(f"    -> Using 24-hour fallback (expires in {time_until_fallback:.1f}s)")

            if now >= fallback_deletion_time:
                if is_saved:
                    print("    Message is saved - skipping fallback deletion for both users")
                else:
                    if not message.deleted_for_sender:
                        message.deleted_for_sender = True
                        modified = True
                        soft_deleted_count += 1
                        emit_message_deleted(message.senderID, message.msgID, message.receiverID)
                    if not message.deleted_for_receiver:
                        message.deleted_for_receiver = True
                        modified = True
                        soft_deleted_count += 1
                        emit_message_deleted(message.receiverID, message.msgID, message.senderID)

        # Actually delete if both users have marked it deleted
        if message.deleted_for_sender and message.deleted_for_receiver:
            db.session.delete(message)
            hard_deleted_count += 1
            modified = True

        if modified:
            messages_modified += 1

    if messages_modified > 0:
        db.session.commit()

    return {
        "hard_deleted_count": hard_deleted_count,
        "soft_deleted_count": soft_deleted_count,
        "messages_modified": messages_modified,
        "timestamp": now.isoformat(),
        "checked_count": len(messages_to_check),
    }


def cleanup_unsent_placeholders() -> dict:
    """
    Remove unsent message placeholders that are older than 24 hours.

    When a user unsends a message:
    - The message is immediately deleted for the sender
    - The receiver sees a placeholder: "username unsent a message"
    - After 24 hours, this placeholder should be removed

    Returns:
        dict: Statistics about deleted placeholder messages
    """
    now = datetime.utcnow()
    deleted_count = 0

    # Find all unsent messages that are more than 24 hours old
    expiry_threshold = now - timedelta(hours=24)

    unsent_messages = Message.query.filter(
        Message.is_unsent == True,
        Message.unsent_at != None,
        Message.unsent_at < expiry_threshold
    ).all()

    print(f"Found {len(unsent_messages)} unsent message placeholders older than 24 hours")

    for message in unsent_messages:
        # Notify the receiver that the unsent placeholder is being removed
        emit_message_deleted(message.receiverID, message.msgID, message.senderID)

        # Delete the message
        db.session.delete(message)
        deleted_count += 1

    if deleted_count > 0:
        db.session.commit()

    return {
        "deleted_placeholder_count": deleted_count,
        "timestamp": now.isoformat(),
    }
