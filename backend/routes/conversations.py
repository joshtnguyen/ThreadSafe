from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import and_, func, or_

from ..database import db
from ..models import Contact, Message, User

conversations_bp = Blueprint("conversations", __name__)


def _current_user_id() -> int:
    return int(get_jwt_identity())


@conversations_bp.get("")
@jwt_required()
def list_conversations():
    """Return conversations (unique contacts with messages) for the authenticated user."""
    current_user_id = _current_user_id()

    # Get all users the current user has exchanged messages with
    sent_to = db.session.query(Message.receiverID).filter(
        Message.senderID == current_user_id,
        Message.receiverID.isnot(None)
    ).distinct()

    received_from = db.session.query(Message.senderID).filter(
        Message.receiverID == current_user_id
    ).distinct()

    # Combine both sets
    contact_ids = set()
    for row in sent_to:
        if row[0]:
            contact_ids.add(row[0])
    for row in received_from:
        if row[0]:
            contact_ids.add(row[0])

    conversations = []
    for contact_id in contact_ids:
        contact_user = User.query.get(contact_id)
        if not contact_user:
            continue

        # Get last message between these two users
        last_message = Message.query.filter(
            or_(
                and_(Message.senderID == current_user_id, Message.receiverID == contact_id),
                and_(Message.senderID == contact_id, Message.receiverID == current_user_id)
            )
        ).order_by(Message.timeStamp.desc()).first()

        conversations.append({
            "id": contact_id,  # Using contact's userID as conversation ID
            "name": contact_user.username,
            "participants": [contact_user.to_dict()],
            "lastMessage": last_message.to_dict(current_user_id) if last_message else None,
            "updatedAt": last_message.timeStamp.isoformat() if last_message else None,
        })

    # Sort by last message timestamp
    conversations.sort(
        key=lambda c: c["updatedAt"] if c["updatedAt"] else "",
        reverse=True
    )

    return jsonify({"conversations": conversations}), 200


@conversations_bp.post("")
@jwt_required()
def create_conversation():
    """Create/open a direct conversation with another user by username or email."""
    current_user_id = _current_user_id()
    payload = request.get_json(silent=True) or {}
    identifier = (payload.get("username") or "").strip()

    if not identifier:
        return jsonify({"message": "Username or email is required."}), 400

    current_user = User.query.get(current_user_id)
    if not current_user:
        return jsonify({"message": "User not found."}), 404

    # Try to find user by exact username (case-SENSITIVE), then by email (case-insensitive)
    target_user = User.query.filter_by(username=identifier).first()
    if not target_user:
        target_user = User.query.filter(func.lower(User.email) == identifier.lower()).first()

    if not target_user:
        return jsonify({"message": "User not found."}), 404

    if target_user.userID == current_user_id:
        return jsonify({"message": "Cannot start a conversation with yourself."}), 400

    # Check if they are accepted friends (mutual)
    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=target_user.userID
    ).first()

    if not contact or contact.contactStatus != "Accepted":
        return (
            jsonify({"message": "You must be friends to start a conversation."}),
            403,
        )

    # Get last message if exists
    last_message = Message.query.filter(
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == target_user.userID),
            and_(Message.senderID == target_user.userID, Message.receiverID == current_user_id)
        )
    ).order_by(Message.timeStamp.desc()).first()

    conversation = {
        "id": target_user.userID,
        "name": target_user.username,
        "participants": [target_user.to_dict()],
        "lastMessage": last_message.to_dict(current_user_id) if last_message else None,
        "updatedAt": last_message.timeStamp.isoformat() if last_message else datetime.utcnow().isoformat(),
    }

    return jsonify({"conversation": conversation}), 201


@conversations_bp.get("/<int:conversation_id>")
@jwt_required()
def get_conversation(conversation_id: int):
    """Return a single conversation summary (conversation_id is the other user's ID)."""
    current_user_id = _current_user_id()

    # conversation_id is actually the other user's userID
    contact_user = User.query.get(conversation_id)
    if not contact_user:
        return jsonify({"message": "User not found."}), 404

    # Verify they are contacts
    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=conversation_id
    ).first()

    if not contact:
        return jsonify({"message": "Not a contact."}), 404

    # Get last message
    last_message = Message.query.filter(
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == conversation_id),
            and_(Message.senderID == conversation_id, Message.receiverID == current_user_id)
        )
    ).order_by(Message.timeStamp.desc()).first()

    conversation = {
        "id": contact_user.userID,
        "name": contact_user.username,
        "participants": [contact_user.to_dict()],
        "lastMessage": last_message.to_dict(current_user_id) if last_message else None,
        "updatedAt": last_message.timeStamp.isoformat() if last_message else None,
    }

    return jsonify({"conversation": conversation}), 200


@conversations_bp.get("/<int:conversation_id>/messages")
@jwt_required()
def get_messages(conversation_id: int):
    """Return messages in a conversation (conversation_id is the other user's ID)."""
    current_user_id = _current_user_id()

    # Verify the other user exists and is a contact
    contact_user = User.query.get(conversation_id)
    if not contact_user:
        return jsonify({"message": "User not found."}), 404

    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=conversation_id
    ).first()

    if not contact:
        return jsonify({"message": "Not a contact."}), 404

    # Get all messages between these two users
    messages = Message.query.filter(
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == conversation_id),
            and_(Message.senderID == conversation_id, Message.receiverID == current_user_id)
        )
    ).order_by(Message.timeStamp.asc()).all()

    # Mark unread messages as delivered/read
    unread = [
        msg for msg in messages
        if msg.senderID == conversation_id and msg.status == "Sent"
    ]
    if unread:
        for msg in unread:
            msg.status = "Read"
        db.session.commit()

    return jsonify({"messages": [msg.to_dict(current_user_id) for msg in messages]}), 200


@conversations_bp.post("/<int:conversation_id>/messages")
@jwt_required()
def create_message(conversation_id: int):
    """Add a new message to a conversation (conversation_id is the receiver's user ID)."""
    current_user_id = _current_user_id()

    # Verify the receiver exists and is a contact
    receiver = User.query.get(conversation_id)
    if not receiver:
        return jsonify({"message": "User not found."}), 404

    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=conversation_id
    ).first()

    if not contact or contact.contactStatus != "Accepted":
        return jsonify({"message": "You must be friends to send messages."}), 403

    payload = request.get_json(silent=True) or {}
    content = (payload.get("content") or "").strip()

    if not content:
        return jsonify({"message": "Message content is required."}), 400

    # For now, store plaintext content (encryption can be added later)
    # Using placeholder values for encryption fields
    message = Message(
        senderID=current_user_id,
        receiverID=conversation_id,
        encryptedContent=content,  # TODO: Encrypt this
        iv="placeholder_iv",  # TODO: Generate real IV
        hmac="placeholder_hmac",  # TODO: Generate real HMAC
        status="Sent",
        msg_Type="text",
        expiryTime=Message.default_expiry_time(is_group=False),
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({"message": message.to_dict(current_user_id)}), 201
