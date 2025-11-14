"""
Key Management Routes
Handles public key storage, retrieval, and verification for E2EE.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import PublicKey, User

keys_bp = Blueprint("keys", __name__)


def _safe_identity() -> int:
    """Load the current user id from the JWT."""
    return int(get_jwt_identity())


@keys_bp.post("/register")
@jwt_required()
def register_public_key():
    """
    Store user's ECC public key in the database.
    Called during account creation or key rotation.

    Request body:
    {
        "publicKey": "base64-encoded public key",
        "algorithm": "ECC-SECP256R1"
    }

    Returns:
        201: Public key registered successfully
        400: Invalid request
        409: Public key already exists for this user
    """
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}

    public_key_str = payload.get("publicKey", "").strip()
    algorithm = payload.get("algorithm", "ECC-SECP256R1").strip()

    if not public_key_str:
        return jsonify({"message": "Public key is required."}), 400

    # Check if user already has a public key
    existing_key = PublicKey.query.filter_by(userID=current_user_id).first()
    if existing_key:
        return jsonify({"message": "Public key already registered. Use key rotation endpoint to update."}), 409

    # Store the public key
    new_key = PublicKey(
        userID=current_user_id,
        publicKey=public_key_str,
        algorithm=algorithm
    )

    db.session.add(new_key)
    db.session.commit()

    return jsonify({
        "message": "Public key registered successfully.",
        "key": new_key.to_dict()
    }), 201


@keys_bp.get("/public/<int:user_id>")
@jwt_required()
def get_public_key(user_id: int):
    """
    Retrieve a user's public key for encryption.
    Only accessible by authenticated users.

    Args:
        user_id: The user ID whose public key to retrieve

    Returns:
        200: Public key data
        404: User or key not found
    """
    current_user_id = _safe_identity()

    # Verify the target user exists
    target_user = User.query.get(user_id)
    if not target_user:
        return jsonify({"message": "User not found."}), 404

    # Get the user's public key
    public_key = PublicKey.query.filter_by(userID=user_id).first()
    if not public_key:
        return jsonify({"message": "Public key not found for this user."}), 404

    return jsonify({
        "user": {
            "id": target_user.userID,
            "username": target_user.username
        },
        "key": public_key.to_dict()
    }), 200


@keys_bp.get("/my-key")
@jwt_required()
def get_my_public_key():
    """
    Retrieve the current user's own public key.

    Returns:
        200: Public key data
        404: Key not found
    """
    current_user_id = _safe_identity()

    public_key = PublicKey.query.filter_by(userID=current_user_id).first()
    if not public_key:
        return jsonify({"message": "You have not registered a public key yet."}), 404

    return jsonify({"key": public_key.to_dict()}), 200


@keys_bp.delete("/my-key")
@jwt_required()
def delete_my_public_key():
    """
    Delete the current user's public key.
    Useful for key rotation or account cleanup.

    Returns:
        200: Key deleted successfully
        404: Key not found
    """
    current_user_id = _safe_identity()

    public_key = PublicKey.query.filter_by(userID=current_user_id).first()
    if not public_key:
        return jsonify({"message": "No public key found to delete."}), 404

    db.session.delete(public_key)
    db.session.commit()

    return jsonify({"message": "Public key deleted successfully."}), 200


@keys_bp.put("/rotate")
@jwt_required()
def rotate_public_key():
    """
    Rotate (update) the user's public key.
    Deletes old key and stores new one.

    Request body:
    {
        "publicKey": "base64-encoded new public key",
        "algorithm": "ECC-SECP256R1"
    }

    Returns:
        200: Key rotated successfully
        400: Invalid request
        404: No existing key to rotate
    """
    current_user_id = _safe_identity()
    payload = request.get_json(silent=True) or {}

    new_public_key_str = payload.get("publicKey", "").strip()
    algorithm = payload.get("algorithm", "ECC-SECP256R1").strip()

    if not new_public_key_str:
        return jsonify({"message": "New public key is required."}), 400

    # Find existing key
    existing_key = PublicKey.query.filter_by(userID=current_user_id).first()
    if not existing_key:
        return jsonify({"message": "No existing key found. Use /register endpoint instead."}), 404

    # Update the key
    existing_key.publicKey = new_public_key_str
    existing_key.algorithm = algorithm

    db.session.commit()

    return jsonify({
        "message": "Public key rotated successfully.",
        "key": existing_key.to_dict()
    }), 200


__all__ = ["keys_bp"]
