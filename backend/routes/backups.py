"""Backup management routes for saved messages."""
from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import Message, User

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
    """
    current_user_id = _current_user_id()

    # Query for messages saved by current user (either as sender or receiver)
    saved_messages = Message.query.filter(
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

    return jsonify({
        "backups": [msg.to_dict(current_user_id) for msg in saved_messages],
        "count": len(saved_messages),
    }), 200


@backups_bp.delete("/<int:message_id>")
@jwt_required()
def delete_backup(message_id: int):
    """
    Remove a message from backups (un-star) and reset auto-delete timer.

    - Removes the saved status for both users
    - Resets expiryTime to max of both users' retention settings
    - Message will auto-delete when the new expiry time passes
    """
    current_user_id = _current_user_id()

    # Get the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404

    # Verify user has access to this message
    if message.senderID != current_user_id and message.receiverID != current_user_id:
        return jsonify({"message": "You can only delete your own backups."}), 403

    # Check if message is actually saved (shared state)
    is_saved = message.saved_by_sender or message.saved_by_receiver
    if not is_saved:
        return jsonify({"message": "Message is not in your backups."}), 400

    # Get both users to check their retention settings
    sender = User.query.get(message.senderID)
    receiver = User.query.get(message.receiverID)

    # Use the max of both users' retention hours
    sender_hours = _get_user_retention_hours(sender)
    receiver_hours = _get_user_retention_hours(receiver)
    max_hours = max(sender_hours, receiver_hours)

    # Un-star for both users
    message.saved_by_sender = False
    message.saved_by_receiver = False

    # Reset expiry time based on max retention setting
    message.expiryTime = datetime.utcnow() + timedelta(hours=max_hours)

    db.session.commit()

    return jsonify({
        "message": "Message removed from backups. It will auto-delete based on retention settings.",
        "messageId": message_id,
        "expiresIn": f"{max_hours} hours",
    }), 200


__all__ = ["backups_bp"]
