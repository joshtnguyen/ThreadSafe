from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from ..database import db
from ..models import User, PublicKey
from ..encryption.ecc_handler import generate_key_pair, serialize_public_key

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

    # Validate password length
    if len(password) < 8:
        return jsonify({"message": "Password must be at least 8 characters long."}), 400
    if len(password) > 15:
        return jsonify({"message": "Password must not exceed 15 characters."}), 400

    # Validate username format
    import re
    # Must be 3-15 characters, start with letter, allow letters/numbers/_-. after first char
    username_pattern = r'^[a-zA-Z][a-zA-Z0-9._-]{2,14}$'

    if not re.match(username_pattern, username):
        if len(username) < 3:
            return jsonify({"message": "Username must be at least 3 characters long."}), 400
        elif len(username) > 15:
            return jsonify({"message": "Username must not exceed 15 characters."}), 400
        elif not username[0].isalpha():
            return jsonify({"message": "Username must start with a letter, not a number or special character."}), 400
        else:
            return jsonify({"message": "Username can only contain letters, numbers, underscore (_), hyphen (-), and period (.)."}), 400

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
    db.session.flush()  # Flush to get user.userID before commit

    # Generate ECC key pair for end-to-end encryption
    try:
        private_key, public_key = generate_key_pair()
        public_key_str = serialize_public_key(public_key)

        # Store public key in database
        user_public_key = PublicKey(
            userID=user.userID,
            publicKey=public_key_str,
            algorithm="ECC-SECP256R1"
        )
        db.session.add(user_public_key)

        # Note: Private key is NOT stored on server - it will be generated
        # and stored on client-side in production. For now, we generate it
        # here but don't store it (client will need to generate their own)

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to generate encryption keys: {str(e)}"}), 500

    db.session.commit()

    token = create_access_token(identity=str(user.userID))

    return (
        jsonify(
            {
                "accessToken": token,
                "user": user.to_dict(),
                "publicKey": public_key_str,  # Return public key to client
                "message": "Account created. Note: In production, generate key pair on client-side."
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
