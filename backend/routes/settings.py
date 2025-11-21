from __future__ import annotations

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


__all__ = ["settings_bp"]
