"""Backup management routes for saved messages."""
from __future__ import annotations

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import Message
from ..websocket_helper import emit_message_deleted

backups_bp = Blueprint("backups", __name__)


def _current_user_id() -> int:
    """Get current user ID from JWT token."""
    user_id = get_jwt_identity()
    return int(user_id)


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
    Remove a message from backups (un-star) and immediately delete for current user.

    This implements Option 2: Un-star = Immediate Delete
    - Removes the saved status for the current user
    - Immediately marks the message as deleted for the current user
    - The other user's saved/deleted status is unaffected
    """
    current_user_id = _current_user_id()

    # Get the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404

    # Verify user has access to this message
    if message.senderID != current_user_id and message.receiverID != current_user_id:
        return jsonify({"message": "You can only delete your own backups."}), 403

    # Determine if user is sender or receiver
    is_sender = message.senderID == current_user_id

    # Check if message is actually saved (shared state)
    is_saved = message.saved_by_sender or message.saved_by_receiver
    if not is_saved:
        return jsonify({"message": "Message is not in your backups."}), 400

    # Un-star for both and immediately delete for this user
    message.saved_by_sender = False
    message.saved_by_receiver = False
    if is_sender:
        message.deleted_for_sender = True
    else:
        message.deleted_for_receiver = True

    # Emit WebSocket event to notify user that message is deleted
    other_user_id = message.receiverID if is_sender else message.senderID
    emit_message_deleted(current_user_id, message.msgID, other_user_id)

    # If both users have deleted, hard delete the message from database
    if message.deleted_for_sender and message.deleted_for_receiver:
        db.session.delete(message)

    db.session.commit()

    return jsonify({
        "message": "Message removed from backups and deleted.",
        "messageId": message_id,
    }), 200


__all__ = ["backups_bp"]
