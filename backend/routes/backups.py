"""Backup management routes for saved messages."""
from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import Message, User, GroupMessageStatus, GroupChat, GroupMember
from ..websocket_helper import emit_message_saved, emit_group_message_saved

backups_bp = Blueprint("backups", __name__)

DEFAULT_RETENTION_HOURS = 72


def _current_user_id() -> int:
    """Get current user ID from JWT token."""
    user_id = get_jwt_identity()
    return int(user_id)


def _get_user_retention_hours(user: User) -> float:
    """Get user's message retention hours from settings, or default."""
    if user and user.settings and "messageRetentionHours" in user.settings:
        return float(user.settings["messageRetentionHours"])
    return DEFAULT_RETENTION_HOURS


@backups_bp.get("")
@jwt_required()
def get_backups():
    """
    Get all saved messages for the current user, ordered by timestamp (newest first).

    Returns messages where the current user has starred/saved them.
    Includes both 1-1 messages and group messages.
    """
    current_user_id = _current_user_id()

    # Query for 1-1 messages saved by current user (either as sender or receiver)
    saved_dm_messages = Message.query.filter(
        Message.groupChatID.is_(None),  # Only 1-1 messages
        db.or_(
            db.and_(
                Message.senderID == current_user_id,
                Message.saved_by_sender == True,
                Message.deleted_for_sender == False,
            ),
            db.and_(
                Message.receiverID == current_user_id,
                Message.saved_by_receiver == True,
                Message.deleted_for_receiver == False,
            ),
        )
    ).order_by(Message.timeStamp.desc()).all()

    # Query for group messages saved by current user
    saved_group_messages = (
        db.session.query(Message)
        .join(GroupMessageStatus, GroupMessageStatus.msgID == Message.msgID)
        .filter(
            Message.groupChatID.isnot(None),  # Only group messages
            GroupMessageStatus.userID == current_user_id,
            GroupMessageStatus.saved_by_user == True,
            GroupMessageStatus.deleted_for_user == False,
        )
        .order_by(Message.timeStamp.desc())
        .all()
    )

    # Combine and sort by timestamp
    all_backups = []

    for msg in saved_dm_messages:
        msg_dict = msg.to_dict(current_user_id)
        msg_dict["isGroupMessage"] = False
        all_backups.append(msg_dict)

    for msg in saved_group_messages:
        msg_dict = msg.to_dict(current_user_id)
        msg_dict["isGroupMessage"] = True
        # Add group info
        group = GroupChat.query.get(msg.groupChatID)
        if group:
            msg_dict["groupName"] = group.groupName
            msg_dict["groupId"] = group.groupChatID
        all_backups.append(msg_dict)

    # Sort combined list by timestamp (newest first)
    all_backups.sort(key=lambda x: x.get("sentAt", ""), reverse=True)

    return jsonify({
        "backups": all_backups,
        "count": len(all_backups),
    }), 200


@backups_bp.delete("/<int:message_id>")
@jwt_required()
def delete_backup(message_id: int):
    """
    Remove a message from backups (un-star) and reset auto-delete timer.

    For 1-1 messages:
    - Removes the saved status for both users (symmetric)
    - Resets expiryTime to max of both users' retention settings

    For group messages:
    - Removes saved status only for current user
    - If no one else has it saved, resets expiry time
    """
    current_user_id = _current_user_id()

    # Get the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404

    # Handle group messages differently
    if message.groupChatID is not None:
        # Group message - check GroupMessageStatus
        status = GroupMessageStatus.query.filter_by(
            msgID=message_id,
            userID=current_user_id
        ).first()

        if not status or not status.saved_by_user:
            return jsonify({"message": "Message is not in your backups."}), 400

        # Un-save for ALL group members (symmetric behavior like 1-1 messages)
        # Get all statuses for this message
        all_statuses = GroupMessageStatus.query.filter_by(msgID=message_id).all()
        for member_status in all_statuses:
            member_status.saved_by_user = False
            # Set timer_reset_at to trigger sender-driven deletion timer restart
            member_status.timer_reset_at = datetime.utcnow()

        db.session.commit()

        # Emit WebSocket event to notify all group members about the unstar
        group = GroupChat.query.get(message.groupChatID)
        if group:
            for member in group.members:
                emit_group_message_saved(member.userID, {
                    "groupChatID": message.groupChatID,
                    "messageId": message_id,
                    "saved": False,
                    "savedBy": current_user_id,
                })

        return jsonify({
            "message": "Message removed from backups for all members.",
            "messageId": message_id,
        }), 200

    # Handle 1-1 messages (existing behavior)
    # Verify user has access to this message
    if message.senderID != current_user_id and message.receiverID != current_user_id:
        return jsonify({"message": "You can only delete your own backups."}), 403

    # Check if message is actually saved (shared state)
    is_saved = message.saved_by_sender or message.saved_by_receiver
    if not is_saved:
        return jsonify({"message": "Message is not in your backups."}), 400

    # Un-star for both users (symmetric behavior)
    message.saved_by_sender = False
    message.saved_by_receiver = False

    # Set timer_reset_at to trigger sender-driven deletion timer restart
    # The scheduler will use this timestamp to calculate expiry based on sender's retention setting
    message.timer_reset_at = datetime.utcnow()

    db.session.commit()

    # Emit WebSocket events to notify both users about the unstar
    is_sender = message.senderID == current_user_id
    other_user_id = message.receiverID if is_sender else message.senderID
    other_conversation_id = current_user_id  # For the other participant, the conversation is with the current user

    # Determine conversation_id for current user (it's the other user's ID)
    conversation_id = other_user_id

    emit_message_saved(other_user_id, message.msgID, other_conversation_id, False)
    emit_message_saved(current_user_id, message.msgID, conversation_id, False)

    return jsonify({
        "message": "Message removed from backups. It will auto-delete based on retention settings.",
        "messageId": message_id,
    }), 200


__all__ = ["backups_bp"]
