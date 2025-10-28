from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
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

    normalised = _normalise_username(username)
    normalised_email = email.lower()

    if User.query.filter_by(username=normalised).first():
        return jsonify({"message": "Username already exists."}), 409

    if User.query.filter_by(email=normalised_email).first():
        return jsonify({"message": "Email already exists."}), 409

    user = User(
        username=normalised,
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
    """Authenticate a user and issue a JWT access token."""
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")

    if not username or not password:
        return jsonify({"message": "Username and password are required."}), 400

    normalised = _normalise_username(username)
    user = User.query.filter_by(username=normalised).first()
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
