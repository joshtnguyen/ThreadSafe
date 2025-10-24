from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import Friendship, User

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

    friends = [
        friendship.friend.to_dict() for friendship in sorted(
            user.friendships, key=lambda entry: entry.friend.display_name.lower()
        )
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
    if target_user.id == current_user.id:
        return jsonify({"message": "You cannot add yourself."}), 400

    existing = Friendship.query.filter_by(
        user_id=current_user.id, friend_id=target_user.id
    ).first()
    if existing:
        return jsonify({"friend": target_user.to_dict(), "status": "already_friends"}), 200

    db.session.add_all(
        [
            Friendship(user_id=current_user.id, friend_id=target_user.id),
            Friendship(user_id=target_user.id, friend_id=current_user.id),
        ]
    )
    db.session.commit()

    return jsonify({"friend": target_user.to_dict()}), 201
