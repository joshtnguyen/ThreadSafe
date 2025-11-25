from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import and_, or_

from ..database import db
from ..models import Contact, Message, User
from ..websocket_helper import (
    emit_friend_request,
    emit_friend_request_accepted,
    emit_friend_deleted,
    emit_friend_request_rejected,
    emit_user_blocked,
    emit_user_unblocked,
)

friends_bp = Blueprint("friends", __name__)


def _safe_identity() -> int:
    """Load the current user id from the JWT."""
    return int(get_jwt_identity())


@friends_bp.get("")
@jwt_required()
def list_friends():
    """Return the authenticated user's confirmed friends (Accepted status only)."""
    current_user_id = _safe_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"message": "User not found."}), 404

    # Get accepted contacts only
    friends = [
        contact.contact_user.to_dict()
        for contact in sorted(
            user.contacts,
            key=lambda entry: entry.contact_user.username.lower()
        )
        if contact.contactStatus == "Accepted"
    ]

    return (
        jsonify({"friends": friends}),
        200,
    )


@friends_bp.get("/requests")
@jwt_required()
def list_friend_requests():
    """Return pending friend requests (incoming and outgoing)."""
    current_user_id = _safe_identity()

    # Incoming requests: where I am the contact_userID and status is Pending
    incoming = Contact.query.filter_by(
        contact_userID=current_user_id,
        contactStatus="Pending"
    ).all()

    # Outgoing requests: where I am the userID and status is Pending
    outgoing = Contact.query.filter_by(
        userID=current_user_id,
        contactStatus="Pending"
    ).all()

    return jsonify({
        "incoming": [
            {
                "requestId": req.userID,  # The ID of the requester
                "user": req.user.to_dict(),
                "addedAt": req.added_at.isoformat() if req.added_at else None,
            }
            for req in incoming
        ],
        "outgoing": [
            {
                "requestId": req.contact_userID,
                "user": req.contact_user.to_dict(),
                "addedAt": req.added_at.isoformat() if req.added_at else None,
            }
            for req in outgoing
        ],
    }), 200


@friends_bp.get("/blocked")
@jwt_required()
def list_blocked_users():
    """Return users the current user has blocked."""
    current_user_id = _safe_identity()
    blocked_contacts = Contact.query.filter_by(
        userID=current_user_id,
        contactStatus="Blocked"
    ).all()

    blocked_users = [
        entry.contact_user.to_dict()
        for entry in blocked_contacts
        if entry.contact_user is not None
    ]

    blocked_users.sort(key=lambda entry: entry["username"].lower())

    return jsonify({"blocked": blocked_users}), 200


@friends_bp.get("/search")
@jwt_required()
def search_user():
    """Search for an exact username and return current relationship state."""
    current_user_id = _safe_identity()
    username = (request.args.get("username") or "").strip()

    if not username:
        return jsonify({"message": "Username is required."}), 400

    target_user = User.query.filter_by(username=username).first()
    if not target_user:
        return jsonify({"message": "User not found."}), 404

    if target_user.userID == current_user_id:
        return jsonify({
            "user": target_user.to_dict(),
            "relationshipStatus": "self",
            "requestId": None,
        }), 200

    outgoing = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=target_user.userID
    ).first()
    incoming = Contact.query.filter_by(
        userID=target_user.userID,
        contact_userID=current_user_id
    ).first()

    status = "none"
    request_id = None

    # Check if current user blocked target
    if outgoing and outgoing.contactStatus == "Blocked":
        status = "blocked"
    # Check if target blocked current user
    elif incoming and incoming.contactStatus == "Blocked":
        status = "blocked_by"
    elif (
        (outgoing and outgoing.contactStatus == "Accepted") or
        (incoming and incoming.contactStatus == "Accepted")
    ):
        status = "friends"
    elif outgoing and outgoing.contactStatus == "Pending":
        status = "pending_outgoing"
        request_id = target_user.userID
    elif incoming and incoming.contactStatus == "Pending":
        status = "pending_incoming"
        request_id = incoming.userID

    return jsonify({
        "user": target_user.to_dict(),
        "relationshipStatus": status,
        "requestId": request_id,
    }), 200


@friends_bp.post("")
@jwt_required()
def add_friend():
    """Send a friend request by username (creates pending request)."""
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}
    identifier = (payload.get("username") or "").strip()

    if not identifier:
        return jsonify({"message": "Username is required."}), 400

    current_user = User.query.get(current_user_id)
    if not current_user:
        return jsonify({"message": "User not found."}), 404

    # Find user by exact username (case-SENSITIVE) only
    target_user = User.query.filter_by(username=identifier).first()

    if not target_user:
        return jsonify({"message": "User not found."}), 404
    if target_user.userID == current_user.userID:
        return jsonify({"message": "You cannot add yourself."}), 400

    # Check if already friends or request exists
    existing_sent = Contact.query.filter_by(
        userID=current_user.userID, contact_userID=target_user.userID
    ).first()

    existing_received = Contact.query.filter_by(
        userID=target_user.userID, contact_userID=current_user.userID
    ).first()

    # Check if already friends (either direction)
    if (existing_sent and existing_sent.contactStatus == "Accepted") or \
       (existing_received and existing_received.contactStatus == "Accepted"):
        return jsonify({"message": "User already exists in Friend's List", "status": "accepted"}), 200

    # Check if target has blocked current user
    if existing_received and existing_received.contactStatus == "Blocked":
        return jsonify({"message": "Cannot send friend request to this user."}), 403

    # If they sent us a request, accept it automatically (mutual interest)
    if existing_received and existing_received.contactStatus == "Pending":
        # Accept their request
        existing_received.contactStatus = "Accepted"
        # Create our side as accepted
        if not existing_sent:
            new_contact = Contact(
                userID=current_user.userID,
                contact_userID=target_user.userID,
                contactStatus="Accepted"
            )
            db.session.add(new_contact)
        else:
            existing_sent.contactStatus = "Accepted"

        db.session.commit()
        return jsonify({
            "friend": target_user.to_dict(),
            "status": "accepted",
            "message": "Friend request accepted (mutual)."
        }), 201

    # If we already sent a request
    if existing_sent:
        if existing_sent.contactStatus == "Pending":
            return jsonify({"message": "Friend request already sent.", "status": "pending"}), 200
        elif existing_sent.contactStatus == "Blocked":
            return jsonify({"message": "Cannot send request."}), 403

    # Create new pending friend request (one-way)
    new_request = Contact(
        userID=current_user.userID,
        contact_userID=target_user.userID,
        contactStatus="Pending"
    )
    db.session.add(new_request)
    db.session.commit()

    # Emit real-time friend request notification
    emit_friend_request(target_user.userID, {
        'requestId': current_user.userID,
        'user': current_user.to_dict(),
        'addedAt': new_request.added_at.isoformat() if new_request.added_at else None
    })

    return jsonify({
        "friend": target_user.to_dict(),
        "status": "pending",
        "message": "Friend request sent."
    }), 201


@friends_bp.post("/block")
@jwt_required()
def block_user():
    """Block a user by username."""
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    if not username:
        return jsonify({"message": "Username is required."}), 400

    target_user = User.query.filter_by(username=username).first()

    if not target_user:
        return jsonify({"message": "User not found."}), 404
    if target_user.userID == current_user_id:
        return jsonify({"message": "You cannot block yourself."}), 400

    # Delete all 1-1 messages between the two users (including saved ones)
    # This deletes messages in both directions (current_user -> target and target -> current_user)
    deleted_message_count = Message.query.filter(
        Message.groupChatID.is_(None),  # Only 1-1 messages, not group messages
        or_(
            and_(Message.senderID == current_user_id, Message.receiverID == target_user.userID),
            and_(Message.senderID == target_user.userID, Message.receiverID == current_user_id)
        )
    ).delete(synchronize_session=False)

    print(f"Deleted {deleted_message_count} messages between users {current_user_id} and {target_user.userID}")

    # Remove friendship from both sides
    # Find incoming contact (target -> current_user)
    incoming = Contact.query.filter_by(
        userID=target_user.userID,
        contact_userID=current_user_id
    ).first()
    if incoming:
        db.session.delete(incoming)
        print(f"Removed incoming friendship from {target_user.userID} to {current_user_id}")

    # Set blocker's side to "Blocked" (or create if doesn't exist)
    outgoing = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=target_user.userID
    ).first()
    if not outgoing:
        outgoing = Contact(
            userID=current_user_id,
            contact_userID=target_user.userID,
        )
        db.session.add(outgoing)
    outgoing.contactStatus = "Blocked"
    print(f"Set outgoing contact status to Blocked for {current_user_id} -> {target_user.userID}")

    db.session.commit()

    blocker = User.query.get(current_user_id)
    if blocker:
        # Notify target user they were blocked (this also implies friendship removal)
        emit_user_blocked(target_user.userID, blocker.to_dict())

    return jsonify({
        "message": f"Blocked {target_user.username}. All messages deleted and friendship removed.",
        "user": target_user.to_dict(),
        "deletedMessages": deleted_message_count,
    }), 200


@friends_bp.post("/unblock")
@jwt_required()
def unblock_user():
    """Unblock a previously blocked user by username."""
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    if not username:
        return jsonify({"message": "Username is required."}), 400

    target_user = User.query.filter_by(username=username).first()
    if not target_user:
        return jsonify({"message": "User not found."}), 404
    if target_user.userID == current_user_id:
        return jsonify({"message": "You cannot unblock yourself."}), 400

    # Find the blocker's contact
    outgoing = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=target_user.userID,
        contactStatus="Blocked"
    ).first()

    if not outgoing:
        return jsonify({"message": "User is not blocked."}), 404

    # Simply remove the block status
    # Since blocking now deletes the friendship, unblocking should NOT restore it
    # Users can re-add each other as friends if they want
    db.session.delete(outgoing)

    db.session.commit()

    unblocker = User.query.get(current_user_id)
    if unblocker:
        emit_user_unblocked(target_user.userID, unblocker.to_dict())

    return jsonify({
        "message": f"Unblocked {target_user.username}. You can re-add them as a friend if you wish.",
        "user": target_user.to_dict(),
    }), 200


@friends_bp.post("/requests/<int:requester_id>/accept")
@jwt_required()
def accept_friend_request(requester_id: int):
    """Accept a friend request."""
    current_user_id = _safe_identity()

    if requester_id == current_user_id:
        return jsonify({"message": "Invalid request."}), 400

    # Find the pending request from requester to current user
    request_record = Contact.query.filter_by(
        userID=requester_id,
        contact_userID=current_user_id,
        contactStatus="Pending"
    ).first()

    if not request_record:
        return jsonify({"message": "Friend request not found."}), 404

    # Update request to Accepted
    request_record.contactStatus = "Accepted"

    # Create reverse connection (also Accepted)
    reverse = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=requester_id
    ).first()

    if reverse:
        reverse.contactStatus = "Accepted"
    else:
        reverse = Contact(
            userID=current_user_id,
            contact_userID=requester_id,
            contactStatus="Accepted"
        )
        db.session.add(reverse)

    db.session.commit()

    requester = User.query.get(requester_id)
    current_user = User.query.get(current_user_id)

    # Emit real-time notification to requester (the person who sent the original request)
    # Send the acceptor's data so the requester knows who accepted
    if current_user:
        emit_friend_request_accepted(requester_id, current_user.to_dict())

    return jsonify({
        "friend": requester.to_dict() if requester else None,
        "message": "Friend request accepted."
    }), 200


@friends_bp.delete("/requests/<int:requester_id>/reject")
@jwt_required()
def reject_friend_request(requester_id: int):
    """Reject/cancel a friend request."""
    current_user_id = _safe_identity()

    if requester_id == current_user_id:
        return jsonify({"message": "Invalid request."}), 400

    # Find the pending request
    request_record = Contact.query.filter_by(
        userID=requester_id,
        contact_userID=current_user_id,
        contactStatus="Pending"
    ).first()

    if not request_record:
        return jsonify({"message": "Friend request not found."}), 404

    db.session.delete(request_record)
    db.session.commit()

    # Emit real-time notification to requester (the person who sent the original request)
    current_user = User.query.get(current_user_id)
    if current_user:
        emit_friend_request_rejected(requester_id, current_user.to_dict())

    return jsonify({"message": "Friend request rejected."}), 200


@friends_bp.delete("/requests/<int:recipient_id>/cancel")
@jwt_required()
def cancel_friend_request(recipient_id: int):
    """Cancel an outgoing friend request."""
    current_user_id = _safe_identity()

    if recipient_id == current_user_id:
        return jsonify({"message": "Invalid request."}), 400

    # Find the pending request that the current user sent
    request_record = Contact.query.filter_by(
        userID=current_user_id,
        contact_userID=recipient_id,
        contactStatus="Pending"
    ).first()

    if not request_record:
        return jsonify({"message": "Friend request not found."}), 404

    db.session.delete(request_record)
    db.session.commit()

    # Emit real-time notification to recipient (the person who would have received the request)
    from backend.websocket_helper import emit_friend_request_cancelled
    current_user = User.query.get(current_user_id)
    if current_user:
        emit_friend_request_cancelled(recipient_id, current_user.to_dict())

    return jsonify({"message": "Friend request cancelled."}), 200


@friends_bp.delete("/<int:friend_id>")
@jwt_required()
def delete_friend(friend_id: int):
    """Remove a friend (deletes mutual connection, but messages remain)."""
    current_user_id = _safe_identity()

    current_user = User.query.get(current_user_id)
    friend_user = User.query.get(friend_id)

    if not current_user or not friend_user:
        return jsonify({"message": "User not found."}), 404

    if friend_id == current_user_id:
        return jsonify({"message": "You cannot delete yourself."}), 400

    # Delete both sides of the friendship
    contact1 = Contact.query.filter_by(
        userID=current_user_id, contact_userID=friend_id
    ).first()
    contact2 = Contact.query.filter_by(
        userID=friend_id, contact_userID=current_user_id
    ).first()

    if not contact1 and not contact2:
        return jsonify({"message": "Contact not found."}), 404

    if contact1:
        db.session.delete(contact1)
    if contact2:
        db.session.delete(contact2)

    db.session.commit()

    # Emit real-time notification to the deleted friend
    emit_friend_deleted(friend_id, current_user.to_dict())

    return jsonify({"message": "Friend removed successfully."}), 200
