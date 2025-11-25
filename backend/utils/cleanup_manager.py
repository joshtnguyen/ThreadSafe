"""Message cleanup manager with sender-driven deletion logic."""
from __future__ import annotations

from datetime import datetime, timedelta
from sqlalchemy import or_

from ..database import db
from ..models import Message, User, GroupChat, GroupMember, GroupMessageStatus
from ..websocket_helper import emit_message_deleted, emit_group_message_deleted


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

    # Smart query: Only check 1-1 messages that could actually expire
    # Skip messages that are:
    # 1. Already deleted for both parties (nothing to do)
    # 2. Group messages (handled by cleanup_expired_group_messages)
    # Note: We check per-user saved status later in the loop
    messages_to_check = Message.query.filter(
        Message.groupChatID.is_(None),  # Only 1-1 messages
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
            # If timer_reset_at is set (message was unsaved), use that as the start time
            if message.timer_reset_at:
                sender_start_time = message.timer_reset_at
                print(f"    Timer was reset at {message.timer_reset_at}, using as start time")
            else:
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


def cleanup_expired_group_messages() -> dict:
    """
    Delete expired group messages based on sender-driven deletion logic.

    Group Message Deletion Rules:
    1. If ANY member saves the message → Never delete
    2. All members read → Use sender's retention from when all read
    3. Not all read → Mark deleted at (sent_time + 24 hours)
    4. Actually delete when all members have deleted_for_user=True

    Returns:
        dict: Statistics about deleted/soft-deleted group messages
    """
    now = datetime.utcnow()
    hard_deleted_count = 0
    soft_deleted_count = 0
    messages_modified = 0

    # Get all group messages that haven't been fully deleted
    group_messages = Message.query.filter(
        Message.groupChatID.isnot(None),
        Message.is_unsent == False
    ).all()

    print(f"Checking {len(group_messages)} group messages for cleanup")

    for message in group_messages:
        group = message.group
        if not group:
            continue

        members = GroupMember.query.filter_by(groupChatID=group.groupChatID).all()
        member_ids = [m.userID for m in members]

        if not member_ids:
            continue

        # Get or create status for each member
        statuses = {}
        for member_id in member_ids:
            status = GroupMessageStatus.query.filter_by(
                msgID=message.msgID,
                userID=member_id
            ).first()
            if not status:
                status = GroupMessageStatus(
                    msgID=message.msgID,
                    userID=member_id
                )
                db.session.add(status)
            statuses[member_id] = status

        # Check if any member has saved the message
        is_saved = any(s.saved_by_user for s in statuses.values())
        if is_saved:
            print(f"  Group message {message.msgID}: Saved by a member - skipping deletion")
            continue

        # Check if all members already have it deleted
        all_deleted = all(s.deleted_for_user for s in statuses.values())
        if all_deleted:
            # Delete all GroupMessageStatus records first (to avoid FK constraint)
            for status in statuses.values():
                db.session.delete(status)
            # Hard delete the message
            db.session.delete(message)
            hard_deleted_count += 1
            messages_modified += 1
            continue

        # Get sender for retention settings (sender-driven deletion)
        sender = User.query.get(message.senderID)
        sender_retention_hours = 24  # Default
        if sender and sender.settings:
            sender_retention_hours = sender.settings.get('messageRetentionHours', 24)

        # Check if all members have read the message
        all_read = all(s.read_at is not None for s in statuses.values())

        if all_read:
            # Use sender's retention from when all read
            # For each member, use timer_reset_at if set (message was unsaved), otherwise use read_at
            effective_read_times = []
            for status in statuses.values():
                if status.timer_reset_at:
                    effective_read_times.append(status.timer_reset_at)
                else:
                    effective_read_times.append(status.read_at)

            latest_read = max(effective_read_times)
            deletion_time = latest_read + timedelta(hours=sender_retention_hours)
            print(f"  Group message {message.msgID}: All read, sender retention={sender_retention_hours}h, deletes at {deletion_time}")

            if now >= deletion_time:
                # Soft delete for all members
                for member_id, status in statuses.items():
                    if not status.deleted_for_user:
                        status.deleted_for_user = True
                        soft_deleted_count += 1
                        emit_group_message_deleted(member_id, {
                            "groupChatID": group.groupChatID,
                            "messageId": message.msgID,
                        })
                messages_modified += 1
        else:
            # Not all read: 24-hour fallback
            fallback_time = message.timeStamp + timedelta(hours=24)
            print(f"  Group message {message.msgID}: Not all read, fallback deletes at {fallback_time}")

            if now >= fallback_time:
                # Soft delete for all members
                for member_id, status in statuses.items():
                    if not status.deleted_for_user:
                        status.deleted_for_user = True
                        soft_deleted_count += 1
                        emit_group_message_deleted(member_id, {
                            "groupChatID": group.groupChatID,
                            "messageId": message.msgID,
                        })
                messages_modified += 1

    if messages_modified > 0:
        db.session.commit()

    return {
        "hard_deleted_count": hard_deleted_count,
        "soft_deleted_count": soft_deleted_count,
        "messages_modified": messages_modified,
        "timestamp": now.isoformat(),
        "checked_count": len(group_messages),
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
