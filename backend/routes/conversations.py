from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import and_, func, or_

from ..database import db
from ..models import Contact, Message, User, PublicKey
from ..websocket_helper import emit_new_message
from ..encryption.message_crypto import encrypt_message_for_user

conversations_bp = Blueprint("conversations", __name__)

DEFAULT_MESSAGE_RETENTION_HOURS = 24  # 24 hours default
MIN_MESSAGE_RETENTION_HOURS = 15 / 3600  # 15 seconds
MAX_MESSAGE_RETENTION_HOURS = 72  # 72 hours (3 days)


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _message_expiry_for_user(user: User | None) -> datetime:
    """
    Calculate an expiry timestamp for messages.

    With hybrid deletion, this is set to 24 hours (the fallback time).
    Actual per-user deletion is handled by the cleanup manager based on
    read status and individual retention settings.
    """
    # Always use 24 hours - the fallback time for unread messages
    # The cleanup manager handles per-user deletion based on their settings
    return datetime.utcnow() + timedelta(hours=24)


@conversations_bp.get("")
@jwt_required()
def list_conversations():
    """Return conversations (unique contacts with messages) for the authenticated user."""
    current_user_id = _current_user_id()
    cutoff = datetime.utcnow()

    # Get all users the current user has exchanged messages with (excluding soft-deleted)
    sent_to = db.session.query(Message.receiverID).filter(
        Message.senderID == current_user_id,
        Message.receiverID.isnot(None),
        Message.deleted_for_sender == False
    ).distinct()

    received_from = db.session.query(Message.senderID).filter(
        Message.receiverID == current_user_id,
        Message.deleted_for_receiver == False
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

        # Get last non-expired, non-deleted message between these two users
        last_message = (
            Message.query.filter(
                or_(
                    and_(
                        Message.senderID == current_user_id,
                        Message.receiverID == contact_id,
                        Message.deleted_for_sender == False
                    ),
                    and_(
                        Message.senderID == contact_id,
                        Message.receiverID == current_user_id,
                        Message.deleted_for_receiver == False
                    ),
                ),
                Message.expiryTime > cutoff,
            )
            .order_by(Message.timeStamp.desc())
            .first()
        )

        conversations.append({
            "id": contact_id,  # Using contact's userID as conversation ID
            "name": contact_user.username,
            "profilePicUrl": contact_user.prof_pic_url,
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

    # Get last non-deleted message if exists
    cutoff = datetime.utcnow()
    last_message = (
        Message.query.filter(
            or_(
                and_(
                    Message.senderID == current_user_id,
                    Message.receiverID == target_user.userID,
                    Message.deleted_for_sender == False
                ),
                and_(
                    Message.senderID == target_user.userID,
                    Message.receiverID == current_user_id,
                    Message.deleted_for_receiver == False
                ),
            ),
            Message.expiryTime > cutoff,
        )
        .order_by(Message.timeStamp.desc())
        .first()
    )

    conversation = {
        "id": target_user.userID,
        "name": target_user.username,
        "profilePicUrl": target_user.prof_pic_url,
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
        return jsonify({"message": "Contact not found."}), 404

    # Get last message
    cutoff = datetime.utcnow()
    last_message = (
        Message.query.filter(
            or_(
                and_(Message.senderID == current_user_id, Message.receiverID == conversation_id),
                and_(Message.senderID == conversation_id, Message.receiverID == current_user_id),
            ),
            Message.expiryTime > cutoff,
        )
        .order_by(Message.timeStamp.desc())
        .first()
    )

    conversation = {
        "id": contact_user.userID,
        "name": contact_user.username,
        "profilePicUrl": contact_user.prof_pic_url,
        "participants": [contact_user.to_dict()],
        "lastMessage": last_message.to_dict(current_user_id) if last_message else None,
        "updatedAt": last_message.timeStamp.isoformat() if last_message else None,
    }

    return jsonify({"conversation": conversation}), 200


@conversations_bp.delete("/<int:conversation_id>")
@jwt_required()
def delete_conversation(conversation_id: int):
    """
    Delete a conversation by deleting all messages between current user and the other user.

    This permanently removes all messages (both sent and received) in the conversation.
    conversation_id is the other user's ID.
    """
    current_user_id = _current_user_id()

    # Verify the other user exists
    contact_user = User.query.get(conversation_id)
    if not contact_user:
        return jsonify({"message": "User not found."}), 404

    # Find all messages between these two users
    messages = Message.query.filter(
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == conversation_id),
            and_(Message.senderID == conversation_id, Message.receiverID == current_user_id),
        )
    ).all()

    # Delete all messages
    for message in messages:
        db.session.delete(message)

    db.session.commit()

    return jsonify({
        "message": "Conversation deleted successfully.",
        "deletedCount": len(messages),
    }), 200


@conversations_bp.get("/<int:conversation_id>/messages")
@jwt_required()
def get_messages(conversation_id: int):
    """Return messages in a conversation (conversation_id is the other user's ID)."""
    current_user_id = _current_user_id()

    # Verify the other user exists
    contact_user = User.query.get(conversation_id)
    if not contact_user:
        return jsonify({"message": "User not found."}), 404

    # Get all non-expired, non-deleted messages between these two users
    # Filter out messages soft-deleted for the current user

    # Debug: Check ALL messages first
    all_messages_debug = Message.query.filter(
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == conversation_id),
            and_(Message.senderID == conversation_id, Message.receiverID == current_user_id),
        )
    ).all()

    print(f"\n=== DEBUG get_messages for user {current_user_id} with {conversation_id} ===")
    for msg in all_messages_debug:
        print(f"  Message {msg.msgID}: sender={msg.senderID}, receiver={msg.receiverID}")
        print(f"    deleted_for_sender={msg.deleted_for_sender}, deleted_for_receiver={msg.deleted_for_receiver}")
        print(f"    expiryTime={msg.expiryTime}, now={datetime.utcnow()}, expired={msg.expiryTime <= datetime.utcnow()}")

    messages = (
        Message.query.filter(
            or_(
                # Messages sent by current user (not deleted for sender)
                and_(
                    Message.senderID == current_user_id,
                    Message.receiverID == conversation_id,
                    Message.deleted_for_sender == False
                ),
                # Messages received by current user (not deleted for receiver)
                and_(
                    Message.senderID == conversation_id,
                    Message.receiverID == current_user_id,
                    Message.deleted_for_receiver == False
                ),
            ),
            Message.expiryTime > datetime.utcnow(),
        )
        .order_by(Message.timeStamp.asc())
        .all()
    )

    print(f"  Filtered messages count: {len(messages)}")
    print(f"=== END DEBUG ===\n")

    # If no messages exist, return empty list (not an error - they can view old chats)
    if not messages:
        return jsonify({"messages": []}), 200

    # Mark unread messages as delivered/read only if they're still contacts
    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=conversation_id
    ).first()

    if contact:  # Only mark as read if still friends
        unread = [
            msg for msg in messages
            if msg.senderID == conversation_id and msg.status != "Read"
        ]
        if unread:
            from ..websocket_helper import emit_message_status_update
            for msg in unread:
                msg.status = "Read"
                msg.read_by_receiver_at = datetime.utcnow()
                # Notify sender via WebSocket
                emit_message_status_update(msg.senderID, {
                    "messageId": msg.msgID,
                    "status": "Read",
                    "conversationId": current_user_id,
                })
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

    sender = User.query.get(current_user_id)
    if not sender:
        return jsonify({"message": "User not found."}), 404

    # Check if sender's contact to receiver is accepted
    contact = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=conversation_id
    ).first()

    if not contact or contact.contactStatus != "Accepted":
        return jsonify({"message": "You must be friends to send messages."}), 403

    # Check if receiver has blocked sender
    receiver_contact = Contact.query.filter_by(
        userID=conversation_id,
        contact_userID=current_user_id,
        contactStatus="Blocked"
    ).first()

    if receiver_contact:
        return jsonify({"message": "You must be friends to send messages."}), 403

    payload = request.get_json(silent=True) or {}

    # Check if client sent pre-encrypted message
    is_encrypted = payload.get("encrypted", False)

    if is_encrypted:
        # Client-side encryption - use pre-encrypted data directly
        encrypted_content = payload.get("encryptedContent", "")
        iv = payload.get("iv", "")
        recipient_encrypted_key = payload.get("recipientEncryptedKey", "")
        recipient_ephemeral_key = payload.get("recipientEphemeralKey", "")
        sender_encrypted_key = payload.get("senderEncryptedKey", "")
        sender_ephemeral_key = payload.get("senderEphemeralKey", "")

        if not all([encrypted_content, iv, recipient_encrypted_key, recipient_ephemeral_key,
                    sender_encrypted_key, sender_ephemeral_key]):
            return jsonify({"message": "Missing encryption fields."}), 400

        # Store pre-encrypted message
        message = Message(
            senderID=current_user_id,
            receiverID=conversation_id,
            # Recipient's encrypted copy
            encryptedContent=encrypted_content,
            iv=iv,
            hmac="",  # Not used with client-side encryption
            encrypted_aes_key=recipient_encrypted_key,
            ephemeral_public_key=recipient_ephemeral_key,
            # Sender's encrypted copy
            sender_encrypted_content=encrypted_content,
            sender_iv=iv,
            sender_hmac="",
            sender_encrypted_aes_key=sender_encrypted_key,
            sender_ephemeral_public_key=sender_ephemeral_key,
            status="Sent",
            msg_Type="text",
            expiryTime=_message_expiry_for_user(sender),
            read_by_sender_at=datetime.utcnow(),  # Sender reads immediately when sending
        )
    else:
        # Server-side encryption (legacy support)
        content = (payload.get("content") or "").strip()

        if not content:
            return jsonify({"message": "Message content is required."}), 400

        if len(content) > 2000:
            return jsonify({"message": "Message must not exceed 2000 characters."}), 400

        # Fetch recipient's public key for encryption
        recipient_public_key = PublicKey.query.filter_by(userID=conversation_id).first()
        if not recipient_public_key:
            return jsonify({"message": "Recipient's encryption key not found. They may need to re-register."}), 404

        # Fetch sender's public key for double encryption (so they can read their own message)
        sender_public_key = PublicKey.query.filter_by(userID=current_user_id).first()
        if not sender_public_key:
            return jsonify({"message": "Your encryption key not found. Please re-login."}), 404

        # Encrypt the message twice: once for recipient, once for sender
        try:
            # Encrypt for recipient
            recipient_encrypted = encrypt_message_for_user(content, recipient_public_key.publicKey)

            # Encrypt for sender (so they can read their own message)
            sender_encrypted = encrypt_message_for_user(content, sender_public_key.publicKey)
        except Exception as e:
            return jsonify({"message": f"Encryption failed: {str(e)}"}), 500

        # Store both encrypted versions in database
        message = Message(
            senderID=current_user_id,
            receiverID=conversation_id,
            # Recipient's encrypted copy
            encryptedContent=recipient_encrypted['encrypted_content'],
            iv=recipient_encrypted['iv'],
            hmac=recipient_encrypted['auth_tag'],
            encrypted_aes_key=recipient_encrypted['encrypted_aes_key'],
            ephemeral_public_key=recipient_encrypted['ephemeral_public_key'],
            # Sender's encrypted copy
            sender_encrypted_content=sender_encrypted['encrypted_content'],
            sender_iv=sender_encrypted['iv'],
            sender_hmac=sender_encrypted['auth_tag'],
            sender_encrypted_aes_key=sender_encrypted['encrypted_aes_key'],
            sender_ephemeral_public_key=sender_encrypted['ephemeral_public_key'],
            status="Sent",
            msg_Type="text",
            expiryTime=_message_expiry_for_user(sender),
            read_by_sender_at=datetime.utcnow(),  # Sender reads immediately when sending
        )

    db.session.add(message)
    db.session.commit()

    # Emit real-time message to receiver via WebSocket
    emit_new_message(conversation_id, message.to_dict(conversation_id))

    # Return message to sender
    return jsonify({"message": message.to_dict(current_user_id)}), 201


@conversations_bp.patch("/<int:conversation_id>/messages/<int:message_id>/status")
@jwt_required()
def update_message_status(conversation_id: int, message_id: int):
    """Update message status to 'Delivered' or 'Read'."""
    current_user_id = _current_user_id()
    payload = request.get_json(silent=True) or {}
    new_status = payload.get("status", "").strip()

    if new_status not in ["Delivered", "Read"]:
        return jsonify({"message": "Status must be 'Delivered' or 'Read'."}), 400

    # Get the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404

    # Only the receiver can update status
    if message.receiverID != current_user_id:
        return jsonify({"message": "Only the receiver can update message status."}), 403

    # Update status (only allow progression: Sent -> Delivered -> Read)
    if message.status == "Sent" and new_status == "Delivered":
        message.status = "Delivered"
    elif message.status in ["Sent", "Delivered"] and new_status == "Read":
        message.status = "Read"
        # Track when receiver read the message
        message.read_by_receiver_at = datetime.utcnow()
    else:
        # Status already at or past requested status
        return jsonify({"message": message.to_dict(current_user_id)}), 200

    db.session.commit()

    # Notify sender via WebSocket
    from ..websocket_helper import emit_message_status_update
    emit_message_status_update(message.senderID, {
        "messageId": message_id,
        "status": message.status,
        "conversationId": conversation_id,
    })

    return jsonify({"message": message.to_dict(current_user_id)}), 200


@conversations_bp.patch("/<int:conversation_id>/messages/<int:message_id>/save")
@jwt_required()
def toggle_save_message(conversation_id: int, message_id: int):
    """
    Toggle save status for a message (per-user).

    Saved messages are exempt from auto-deletion and kept forever for the user who saved them.
    Each user can independently save messages they want to preserve.
    """
    current_user_id = _current_user_id()
    payload = request.get_json(silent=True) or {}
    saved = payload.get("saved", False)

    # Get the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404

    # Only sender or receiver can save a message
    if message.senderID != current_user_id and message.receiverID != current_user_id:
        return jsonify({"message": "You can only save your own messages."}), 403

    # Update per-user saved status
    is_sender = message.senderID == current_user_id
    if is_sender:
        message.saved_by_sender = bool(saved)
    else:
        message.saved_by_receiver = bool(saved)

    db.session.commit()

    # Get the current user's saved status for the response
    current_user_saved = message.saved_by_sender if is_sender else message.saved_by_receiver

    return jsonify({
        "message": message.to_dict(current_user_id),
        "saved": current_user_saved,
    }), 200
