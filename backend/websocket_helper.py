"""
Helper module to emit events to the relay server over HTTP.
"""
from __future__ import annotations

import os
import requests

RELAY_SERVER_URL = os.environ.get("RELAY_API_URL", "http://localhost:5001")
RELAY_API_TOKEN = os.environ.get("RELAY_API_TOKEN", "dev-relay-token")


def _post(path: str, payload: dict):
    try:
        response = requests.post(
            f"{RELAY_SERVER_URL}{path}",
            json=payload,
            headers={"X-Relay-Token": RELAY_API_TOKEN},
            timeout=2,
        )
        response.raise_for_status()
    except Exception as exc:
        print(f"WARNING: Relay call to {path} failed: {exc}")


def emit_new_message(receiver_id: int, message: dict):
    """Emit a new message event to the relay server."""
    _post("/relay/message", {"receiverId": receiver_id, "message": message})


def emit_friend_request(recipient_id: int, request_data: dict):
    """Emit a friend request notification."""
    _post("/relay/friend-request", {"recipientId": recipient_id, "request": request_data})


def emit_friend_request_accepted(requester_id: int, friend_data: dict):
    """Emit a friend request accepted notification."""
    _post("/relay/friend-accepted", {"requesterId": requester_id, "friend": friend_data})


def emit_friend_deleted(friend_id: int, deleter_data: dict):
    """Emit a friend deletion notification."""
    _post("/relay/friend-deleted", {"friendId": friend_id, "deleter": deleter_data})


def emit_friend_request_rejected(requester_id: int, rejector_data: dict):
    """Emit a friend request rejection notification."""
    _post("/relay/friend-rejected", {"requesterId": requester_id, "rejector": rejector_data})


def emit_user_blocked(blocked_user_id: int, blocker_data: dict):
    """Emit a notification that blocked_user_id was blocked by blocker_data."""
    _post("/relay/user-blocked", {"blockedUserId": blocked_user_id, "blocker": blocker_data})


def emit_user_unblocked(unblocked_user_id: int, unblocker_data: dict):
    """Emit a notification that unblocked_user_id was unblocked."""
    _post("/relay/user-unblocked", {"unblockedUserId": unblocked_user_id, "unblocker": unblocker_data})
