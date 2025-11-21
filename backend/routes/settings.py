from __future__ import annotations

import base64
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..database import db
from ..models import User

settings_bp = Blueprint("settings", __name__)

DEFAULT_SETTINGS = {
    "messageRetentionHours": 72,
    "theme": "dark",
}


def _current_user() -> User | None:
    user_id = get_jwt_identity()
    if not user_id:
        return None
    return User.query.get(int(user_id))


def _with_defaults(settings: dict | None) -> dict:
    data = dict(DEFAULT_SETTINGS)
    if isinstance(settings, dict):
        data.update(settings)
    return data


def _validate_settings(payload: dict) -> tuple[dict, list[str]]:
    updates: dict[str, object] = {}
    errors: list[str] = []

    if "messageRetentionHours" in payload:
        try:
            hours = float(payload["messageRetentionHours"])
        except (TypeError, ValueError):
            errors.append("messageRetentionHours must be a number.")
        else:
            min_hours = 15 / 3600  # 15 seconds in hours (0.004167)
            max_hours = 72  # 72 hours (3 days)
            if not min_hours <= hours <= max_hours:
                errors.append(f"messageRetentionHours must be between {min_hours:.6f} and {max_hours} hours.")
            else:
                updates["messageRetentionHours"] = hours

    if "theme" in payload:
        theme = (payload.get("theme") or "").lower()
        if theme not in {"light", "dark"}:
            errors.append("theme must be 'light' or 'dark'.")
        else:
            updates["theme"] = theme

    return updates, errors


@settings_bp.get("")
@jwt_required()
def get_settings():
    user = _current_user()
    if not user:
        return jsonify({"message": "User not found."}), 404

    return jsonify({"settings": _with_defaults(user.settings)}), 200


@settings_bp.put("")
@jwt_required()
def update_settings():
    user = _current_user()
    if not user:
        return jsonify({"message": "User not found."}), 404

    payload = request.get_json(silent=True) or {}
    updates, errors = _validate_settings(payload)
    if errors:
        return jsonify({"message": "; ".join(errors)}), 400
    if not updates:
        return jsonify({"settings": _with_defaults(user.settings)}), 200

    user_settings = user.settings.copy() if isinstance(user.settings, dict) else {}
    user_settings.update(updates)
    user.settings = user_settings
    user.settings_updated_at = datetime.utcnow()  # Track when settings were changed
    db.session.commit()

    return jsonify({"settings": _with_defaults(user.settings)}), 200


@settings_bp.post("/profile-picture")
@jwt_required()
def upload_profile_picture():
    """Upload or update user profile picture (base64 encoded)."""
    user = _current_user()
    if not user:
        return jsonify({"message": "User not found."}), 404

    payload = request.get_json(silent=True) or {}
    image_data = payload.get("imageData")

    if not image_data:
        return jsonify({"message": "No image data provided."}), 400

    # Validate base64 format: data:image/[type];base64,[data]
    if not image_data.startswith("data:image/"):
        return jsonify({"message": "Invalid image format. Must be a data URL."}), 400

    # Extract mime type and validate
    try:
        header, encoded = image_data.split(",", 1)
        mime_type = header.split(":")[1].split(";")[0]

        # Supported formats
        allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
        if mime_type not in allowed_types:
            return jsonify({"message": f"Unsupported image type. Allowed: {', '.join(allowed_types)}"}), 400

        # Decode to check validity and size
        decoded = base64.b64decode(encoded)
        size_kb = len(decoded) / 1024

        # Limit size to 500KB
        if size_kb > 500:
            return jsonify({"message": f"Image too large ({size_kb:.1f}KB). Maximum size is 500KB."}), 400

    except Exception as e:
        return jsonify({"message": f"Invalid image data: {str(e)}"}), 400

    # Save to database
    user.prof_pic_url = image_data
    db.session.commit()

    return jsonify({
        "message": "Profile picture updated successfully.",
        "user": user.to_dict()
    }), 200


@settings_bp.delete("/profile-picture")
@jwt_required()
def delete_profile_picture():
    """Remove user profile picture."""
    user = _current_user()
    if not user:
        return jsonify({"message": "User not found."}), 404

    user.prof_pic_url = None
    db.session.commit()

    return jsonify({
        "message": "Profile picture removed.",
        "user": user.to_dict()
    }), 200


__all__ = ["settings_bp"]
