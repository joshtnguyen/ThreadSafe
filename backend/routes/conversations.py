from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import (
    Conversation,
    ConversationParticipant,
    Friendship,
    Message,
    User,
)

conversations_bp = Blueprint("conversations", __name__)


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _find_or_create_direct_conversation(
    current_user: User, target_user: User
) -> Conversation:
    """Return an existing direct conversation between two users or create one."""
    for participant in current_user.conversations:
        conversation = participant.conversation
        participant_ids = {p.user_id for p in conversation.participants}
        if participant_ids == {current_user.id, target_user.id}:
            return conversation

    conversation = Conversation()
    db.session.add(conversation)
    db.session.flush()  # Populate conversation.id

    db.session.add_all(
        [
            ConversationParticipant(conversation_id=conversation.id, user_id=current_user.id),
            ConversationParticipant(conversation_id=conversation.id, user_id=target_user.id),
        ]
    )
    return conversation


def _conversation_or_404(conversation_id: int, current_user_id: int) -> Conversation:
    conversation = Conversation.query.get(conversation_id)
    if not conversation:
        return None

    if current_user_id not in {p.user_id for p in conversation.participants}:
        return None

    return conversation


@conversations_bp.get("")
@jwt_required()
def list_conversations():
    """Return conversations for the authenticated user."""
    current_user_id = _current_user_id()
    conversations = (
        Conversation.query.join(ConversationParticipant)
        .filter(ConversationParticipant.user_id == current_user_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )

    return (
        jsonify(
            {
                "conversations": [
                    conversation.to_summary(current_user_id)
                    for conversation in conversations
                ]
            }
        ),
        200,
    )


@conversations_bp.post("")
@jwt_required()
def create_conversation():
    """Create a direct conversation with another user by username."""
    current_user_id = _current_user_id()
    payload = request.get_json(silent=True) or {}
    target_username_raw = (payload.get("username") or "").strip()
    target_username = target_username_raw.lower()

    if not target_username:
        return jsonify({"message": "username is required."}), 400

    current_user = User.query.get(current_user_id)
    if not current_user:
        return jsonify({"message": "User not found."}), 404
    target_user = User.query.filter_by(username=target_username).first()

    if not target_user:
        return jsonify({"message": "User not found."}), 404
    if target_user.id == current_user_id:
        return jsonify({"message": "Cannot start a conversation with yourself."}), 400
    if not Friendship.query.filter_by(
        user_id=current_user_id, friend_id=target_user.id
    ).first():
        return (
            jsonify({"message": "Add this user as a friend before starting a chat."}),
            403,
        )

    conversation = _find_or_create_direct_conversation(current_user, target_user)
    conversation.updated_at = datetime.utcnow()
    db.session.commit()

    return (
        jsonify({"conversation": conversation.to_summary(current_user_id)}),
        201,
    )


@conversations_bp.get("/<int:conversation_id>")
@jwt_required()
def get_conversation(conversation_id: int):
    """Return a single conversation summary."""
    current_user_id = _current_user_id()
    conversation = _conversation_or_404(conversation_id, current_user_id)
    if not conversation:
        return jsonify({"message": "Conversation not found."}), 404
    return jsonify({"conversation": conversation.to_summary(current_user_id)}), 200


@conversations_bp.get("/<int:conversation_id>/messages")
@jwt_required()
def get_messages(conversation_id: int):
    """Return messages within a conversation."""
    current_user_id = _current_user_id()
    conversation = _conversation_or_404(conversation_id, current_user_id)

    if not conversation:
        return jsonify({"message": "Conversation not found."}), 404

    messages = [
        message.to_dict(current_user_id) for message in conversation.messages
    ]

    # Mark unread messages addressed to the current user as read.
    unread = [
        message
        for message in conversation.messages
        if message.sender_id != current_user_id and message.read_at is None
    ]
    if unread:
        now = datetime.utcnow()
        for message in unread:
            message.read_at = now
        db.session.commit()

    return jsonify({"messages": messages}), 200


@conversations_bp.post("/<int:conversation_id>/messages")
@jwt_required()
def create_message(conversation_id: int):
    """Add a new message to a conversation."""
    current_user_id = _current_user_id()
    conversation = _conversation_or_404(conversation_id, current_user_id)
    if not conversation:
        return jsonify({"message": "Conversation not found."}), 404

    payload = request.get_json(silent=True) or {}
    content = (payload.get("content") or "").strip()

    if not content:
        return jsonify({"message": "Message content is required."}), 400

    message = Message(
        conversation_id=conversation.id,
        sender_id=current_user_id,
        content=content,
    )
    db.session.add(message)
    conversation.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({"message": message.to_dict(current_user_id)}), 201
