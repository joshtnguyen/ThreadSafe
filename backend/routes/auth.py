from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from ..database import db
from ..models import User

auth_bp = Blueprint("auth", __name__)


def _normalise_username(username: str) -> str:
    return username.strip().lower()


@auth_bp.post("/register")
def register():
    """Register a new user."""
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    email = payload.get("email", "").strip()
    password = payload.get("password", "")

    if not username or not password or not email:
        return jsonify({"message": "Username, email, and password are required."}), 400

    # Email is case-insensitive, username is case-SENSITIVE
    normalised_email = email.lower()

    # Check for existing username (case-insensitive to prevent confusing duplicates like 'Alice' and 'alice')
    if User.query.filter(func.lower(User.username) == username.lower()).first():
        return jsonify({"message": "Username already exists (case-insensitive check)."}), 409

    if User.query.filter(func.lower(User.email) == normalised_email).first():
        return jsonify({"message": "Email already exists."}), 409

    # Store username with exact case as provided
    user = User(
        username=username,  # Preserve exact case
        email=normalised_email,
        password=generate_password_hash(password, method="pbkdf2:sha256"),
    )

    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.userID))

    return (
        jsonify(
            {
                "accessToken": token,
                "user": user.to_dict(),
            }
        ),
        201,
    )


@auth_bp.post("/login")
def login():
    """Authenticate a user and issue a JWT access token (accepts username or email)."""
    payload = request.get_json(silent=True) or {}
    identifier = payload.get("username", "").strip()
    password = payload.get("password", "")

    if not identifier or not password:
        return jsonify({"message": "Username/email and password are required."}), 400

    # Try to find user by exact username first (case-SENSITIVE), then by email (case-insensitive)
    user = User.query.filter_by(username=identifier).first()
    if not user:
        user = User.query.filter(func.lower(User.email) == identifier.lower()).first()

    if not user or not check_password_hash(user.password, password):
        return jsonify({"message": "Invalid credentials."}), 401

    token = create_access_token(identity=str(user.userID))

    return jsonify({"accessToken": token, "user": user.to_dict()}), 200


@auth_bp.get("/me")
@jwt_required()
def me():
    """Return the authenticated user's profile."""
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found."}), 404
    return jsonify({"user": user.to_dict()}), 200
