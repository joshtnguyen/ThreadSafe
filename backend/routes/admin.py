"""Admin and maintenance endpoints."""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..utils.cleanup_manager import cleanup_expired_messages

admin_bp = Blueprint("admin", __name__)


@admin_bp.post("/cleanup-messages")
def trigger_cleanup():
    """
    Manually trigger message cleanup based on hybrid deletion logic.

    This endpoint can be called by a cron job or manually for maintenance.
    In production, this should be protected with authentication.
    """
    result = cleanup_expired_messages()
    return jsonify({
        "status": "ok",
        "message": f"Cleanup completed. Deleted {result['deleted_count']} messages.",
        "details": result
    }), 200
