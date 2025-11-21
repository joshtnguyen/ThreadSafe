"""Message cleanup manager with per-user hybrid deletion logic."""
from __future__ import annotations

from datetime import datetime, timedelta
from sqlalchemy import or_

from ..database import db
from ..models import Message, User
from ..websocket_helper import emit_message_deleted


def cleanup_expired_messages() -> dict:
    """
    Delete expired messages based on per-user hybrid deletion logic.

    Per-User Deletion Rules:
    1. Saved messages → Never mark as deleted
    2. Both parties read → Mark deleted for user at (read_by_both_time + user's_retention)
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

        # Get sender and receiver
        sender = User.query.get(message.senderID)
        receiver = User.query.get(message.receiverID)

        if not sender or not receiver:
            continue

        # Get each user's retention settings (in hours)
        sender_retention_hours = sender.settings['messageRetentionHours'] if sender.settings else 24
        receiver_retention_hours = receiver.settings['messageRetentionHours'] if receiver.settings else 24

        # Debug: Print retention settings
        print(f"  Message {message.msgID}: Sender({sender.username})={sender_retention_hours}h, Receiver({receiver.username})={receiver_retention_hours}h")

        # Check if both parties have read the message
        print(f"    read_by_sender_at: {message.read_by_sender_at}, read_by_receiver_at: {message.read_by_receiver_at}")
        if message.read_by_sender_at and message.read_by_receiver_at:
            # Both read: Use per-user retention from when both read
            both_read_time = max(message.read_by_sender_at, message.read_by_receiver_at)

            # Check sender's deletion time
            if not message.deleted_for_sender:
                # Skip deletion if sender has saved this message
                if message.saved_by_sender:
                    print(f"    Sender has saved this message - skipping deletion for sender")
                else:
                    # Use the later of: both_read_time OR settings_updated_at (if settings were changed after reading)
                    sender_start_time = both_read_time
                    if sender.settings_updated_at and sender.settings_updated_at > both_read_time:
                        sender_start_time = sender.settings_updated_at
                        print(f"    Sender changed settings at {sender.settings_updated_at}, using as start time")

                    sender_deletion_time = sender_start_time + timedelta(hours=sender_retention_hours)
                    time_until_sender_delete = (sender_deletion_time - now).total_seconds()
                    print(f"    Sender deletion in {time_until_sender_delete:.1f}s (start time: {sender_start_time})")
                    if now >= sender_deletion_time:
                        print(f"    -> Deleting for SENDER {sender.username}")
                        message.deleted_for_sender = True
                        modified = True
                        soft_deleted_count += 1
                        # Notify sender that message is deleted on their side
                        emit_message_deleted(message.senderID, message.msgID, message.receiverID)

            # Check receiver's deletion time
            if not message.deleted_for_receiver:
                # Skip deletion if receiver has saved this message
                if message.saved_by_receiver:
                    print(f"    Receiver has saved this message - skipping deletion for receiver")
                else:
                    # Use the later of: both_read_time OR settings_updated_at (if settings were changed after reading)
                    receiver_start_time = both_read_time
                    if receiver.settings_updated_at and receiver.settings_updated_at > both_read_time:
                        receiver_start_time = receiver.settings_updated_at
                        print(f"    Receiver changed settings at {receiver.settings_updated_at}, using as start time")

                    receiver_deletion_time = receiver_start_time + timedelta(hours=receiver_retention_hours)
                    time_until_receiver_delete = (receiver_deletion_time - now).total_seconds()
                    print(f"    Receiver deletion in {time_until_receiver_delete:.1f}s (start time: {receiver_start_time})")
                    if now >= receiver_deletion_time:
                        print(f"    -> Deleting for RECEIVER {receiver.username}")
                        message.deleted_for_receiver = True
                        modified = True
                        soft_deleted_count += 1
                        # Notify receiver that message is deleted on their side
                        emit_message_deleted(message.receiverID, message.msgID, message.senderID)
        else:
            # Not read by both: Apply 24-hour fallback for both users
            fallback_deletion_time = message.timeStamp + timedelta(hours=24)
            time_until_fallback = (fallback_deletion_time - now).total_seconds()
            print(f"    -> Using 24-hour fallback (expires in {time_until_fallback:.1f}s)")

            if now >= fallback_deletion_time:
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
