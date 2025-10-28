from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import Contact, User

friends_bp = Blueprint("friends", __name__)


def _safe_identity() -> int:
    """Load the current user id from the JWT."""
    return int(get_jwt_identity())


@friends_bp.get("")
@jwt_required()
def list_friends():
    """Return the authenticated user's confirmed friends."""
    current_user_id = _safe_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"message": "User not found."}), 404

    # Get active contacts only
    friends = [
        contact.contact_user.to_dict()
        for contact in sorted(
            user.contacts,
            key=lambda entry: entry.contact_user.username.lower()
        )
        if contact.contactStatus == "Active"
    ]

    return (
        jsonify({"friends": friends}),
        200,
    )


@friends_bp.post("")
@jwt_required()
def add_friend():
    """Add another user as a friend (creates a mutual connection)."""
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip().lower()

    if not username:
        return jsonify({"message": "username is required."}), 400

    current_user = User.query.get(current_user_id)
    target_user = User.query.filter_by(username=username).first()

    if not current_user or not target_user:
        return jsonify({"message": "User not found."}), 404
    if target_user.userID == current_user.userID:
        return jsonify({"message": "You cannot add yourself."}), 400

    existing = Contact.query.filter_by(
        userID=current_user.userID, contact_userID=target_user.userID
    ).first()
    if existing:
        return jsonify({"friend": target_user.to_dict(), "status": "already_friends"}), 200

    db.session.add_all(
        [
            Contact(userID=current_user.userID, contact_userID=target_user.userID, contactStatus="Active"),
            Contact(userID=target_user.userID, contact_userID=current_user.userID, contactStatus="Active"),
        ]
    )
    db.session.commit()

    return jsonify({"friend": target_user.to_dict()}), 201
