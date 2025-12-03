"""Group chat management routes."""
from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import or_, and_

from ..database import db
from ..models import GroupChat, GroupMember, Message, User, GroupMessageStatus, Contact
from .conversations import check_message_rate_limit
from ..websocket_helper import (
    emit_group_created,
    emit_group_message,
    emit_group_member_added,
    emit_group_member_removed,
    emit_group_deleted,
    emit_group_message_edited,
    emit_group_message_unsent,
    emit_group_message_read,
    emit_group_key_rotated,
    emit_group_message_saved,
)

groups_bp = Blueprint("groups", __name__)

MAX_GROUP_MEMBERS = 32
DEFAULT_RETENTION_HOURS = 72


def _current_user_id() -> int:
    """Get current user ID from JWT token."""
    user_id = get_jwt_identity()
    return int(user_id)


def _get_user_retention_hours(user: User) -> float:
    """Get user's message retention hours from settings, or default."""
    if user and user.settings and "messageRetentionHours" in user.settings:
        return float(user.settings["messageRetentionHours"])
    return DEFAULT_RETENTION_HOURS


def _is_group_member(group_id: int, user_id: int) -> bool:
    """Check if user is a member of the group."""
    return GroupMember.query.filter_by(groupChatID=group_id, userID=user_id).first() is not None


def _get_member_role(group_id: int, user_id: int) -> str | None:
    """Get the role of a user in a group."""
    member = GroupMember.query.filter_by(groupChatID=group_id, userID=user_id).first()
    return member.role if member else None


def _is_owner(group_id: int, user_id: int) -> bool:
    """Check if user is the owner of the group."""
    return _get_member_role(group_id, user_id) == "Owner"


# ============================================================================
# GROUP CRUD ENDPOINTS
# ============================================================================

@groups_bp.post("")
@jwt_required()
def create_group():
    """
    Create a new group chat.

    Request body:
    - groupName: str (required)
    - profilePicUrl: str (optional)
    - memberIds: list[int] (required, list of user IDs to add)
    - encryptedKeys: dict (optional, {userId: encryptedKey} for each member)
    """
    current_user_id = _current_user_id()
    payload = request.get_json(silent=True) or {}

    group_name = payload.get("groupName", "").strip()
    if not group_name:
        return jsonify({"message": "Group name is required."}), 400

    member_ids = payload.get("memberIds", [])
    if not isinstance(member_ids, list):
        return jsonify({"message": "memberIds must be a list."}), 400

    # Include creator in member count
    total_members = len(set(member_ids)) + 1
    if total_members > MAX_GROUP_MEMBERS:
        return jsonify({"message": f"Maximum {MAX_GROUP_MEMBERS} members allowed."}), 400

    # Verify all members exist and are friends with creator
    for member_id in member_ids:
        if member_id == current_user_id:
            continue
        user = User.query.get(member_id)
        if not user:
            return jsonify({"message": f"User {member_id} not found."}), 404

        # Check if they are friends (both directions accepted)
        friendship = Contact.query.filter(
            or_(
                and_(Contact.userID == current_user_id, Contact.contact_userID == member_id),
                and_(Contact.userID == member_id, Contact.contact_userID == current_user_id),
            ),
            Contact.contactStatus == "Accepted"
        ).first()
        if not friendship:
            return jsonify({"message": f"User {member_id} is not your friend."}), 400

    # Create the group
    group = GroupChat(
        groupName=group_name,
        profile_pic_url=payload.get("profilePicUrl"),
        created_by=current_user_id,
    )
    db.session.add(group)
    db.session.flush()  # Get the group ID

    # Add creator as Owner
    encrypted_keys = payload.get("encryptedKeys", {})

    # Debug logging
    print(f"[DEBUG] create_group: encrypted_keys keys = {list(encrypted_keys.keys())}")
    print(f"[DEBUG] create_group: current_user_id = {current_user_id}, member_ids = {member_ids}")

    owner_key = encrypted_keys.get(str(current_user_id))
    print(f"[DEBUG] create_group: owner key present = {owner_key is not None}")

    owner_member = GroupMember(
        groupChatID=group.groupChatID,
        userID=current_user_id,
        role="Owner",
        encrypted_group_key=owner_key,
    )
    db.session.add(owner_member)

    # Add other members
    for member_id in member_ids:
        if member_id == current_user_id:
            continue
        member_key = encrypted_keys.get(str(member_id))
        print(f"[DEBUG] create_group: member {member_id} key present = {member_key is not None}")
        member = GroupMember(
            groupChatID=group.groupChatID,
            userID=member_id,
            role="Member",
            encrypted_group_key=member_key,
        )
        db.session.add(member)

    db.session.commit()

    # Notify all members about the new group
    group_data = group.to_dict(include_members=True)
    for member_id in member_ids:
        if member_id != current_user_id:
            # Include the member's encrypted group key in the notification
            member_data = {
                **group_data,
                "encryptedGroupKey": encrypted_keys.get(str(member_id)),
            }
            emit_group_created(member_id, member_data)

    return jsonify({
        "message": "Group created successfully.",
        "group": group_data,
    }), 201


@groups_bp.get("")
@jwt_required()
def list_groups():
    """List all groups the current user is a member of."""
    current_user_id = _current_user_id()

    # Get all group memberships for this user
    memberships = GroupMember.query.filter_by(userID=current_user_id).all()

    groups = []
    for membership in memberships:
        group = membership.group
        if not group:
            continue

        # Get last non-deleted, non-unsent message for this group
        # Need to iterate to find one that isn't deleted for this user
        messages = (
            Message.query.filter(
                Message.groupChatID == group.groupChatID,
                Message.expiryTime > datetime.utcnow(),
                Message.is_unsent == False,
            )
            .order_by(Message.timeStamp.desc())
            .limit(20)  # Check up to 20 recent messages
            .all()
        )

        last_message = None
        for msg in messages:
            status = GroupMessageStatus.query.filter_by(
                msgID=msg.msgID,
                userID=current_user_id
            ).first()
            if not status or not status.deleted_for_user:
                last_message = msg
                break

        groups.append({
            **group.to_dict(include_members=True),
            "lastMessage": last_message.to_dict(current_user_id) if last_message else None,
            "updatedAt": last_message.timeStamp.isoformat() if last_message else group.created_at.isoformat(),
            "myRole": membership.role,
            "encryptedGroupKey": membership.encrypted_group_key,
        })

    # Sort by last activity
    groups.sort(key=lambda g: g["updatedAt"], reverse=True)

    return jsonify({"groups": groups}), 200


@groups_bp.get("/<int:group_id>")
@jwt_required()
def get_group(group_id: int):
    """Get group details including members."""
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    membership = GroupMember.query.filter_by(
        groupChatID=group_id,
        userID=current_user_id
    ).first()

    return jsonify({
        "group": group.to_dict(include_members=True),
        "myRole": membership.role if membership else None,
        "encryptedGroupKey": membership.encrypted_group_key if membership else None,
    }), 200


@groups_bp.patch("/<int:group_id>")
@jwt_required()
def update_group(group_id: int):
    """
    Update group details (Owner only).

    Request body:
    - groupName: str (optional)
    - profilePicUrl: str (optional)
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_owner(group_id, current_user_id):
        return jsonify({"message": "Only the owner can update the group."}), 403

    payload = request.get_json(silent=True) or {}

    if "groupName" in payload:
        name = payload["groupName"].strip()
        if name:
            group.groupName = name

    if "profilePicUrl" in payload:
        group.profile_pic_url = payload["profilePicUrl"]

    db.session.commit()

    # Notify all members about the group update
    from backend.websocket_helper import emit_group_updated
    update_data = {
        "groupChatID": group_id,
        "groupName": group.groupName,
        "profilePicUrl": group.profile_pic_url,
    }
    for member in group.members:
        if member.userID != current_user_id:
            emit_group_updated(member.userID, update_data)

    return jsonify({
        "message": "Group updated successfully.",
        "group": group.to_dict(include_members=True),
    }), 200


@groups_bp.delete("/<int:group_id>")
@jwt_required()
def delete_group(group_id: int):
    """
    Delete a group (Owner only). Deletes for all members.

    Before deletion, unstars any saved messages and notifies all members to remove them from backups.
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_owner(group_id, current_user_id):
        return jsonify({"message": "Only the owner can delete the group."}), 403

    # Get all member IDs before deleting
    member_ids = [m.userID for m in group.members]

    # Get all messages in this group
    messages = Message.query.filter_by(groupChatID=group_id).all()
    message_ids = [m.msgID for m in messages]

    # Before deleting, unstar any saved messages and notify all members
    if message_ids:
        # Get all saved message statuses
        saved_statuses = GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID.in_(message_ids),
            GroupMessageStatus.saved_by_user == True
        ).all()

        # Unstar all saved messages
        for status in saved_statuses:
            status.saved_by_user = False

        db.session.commit()

        # Emit WebSocket events to all members for each saved message that was unstarred
        # This will unstar the message in chat and remove it from their backup folders
        saved_message_ids = set(s.msgID for s in saved_statuses)
        for message_id in saved_message_ids:
            for member_id in member_ids:
                emit_group_message_saved(member_id, {
                    "groupChatID": group_id,
                    "messageId": message_id,
                    "saved": False,
                    "savedBy": current_user_id,  # Owner initiated the deletion
                })

    # Delete GroupMessageStatus records (to avoid FK constraint)
    if message_ids:
        GroupMessageStatus.query.filter(GroupMessageStatus.msgID.in_(message_ids)).delete(synchronize_session=False)

    # Delete the group (cascade will delete members and messages)
    db.session.delete(group)
    db.session.commit()

    # Notify all members about group deletion
    for member_id in member_ids:
        if member_id != current_user_id:
            emit_group_deleted(member_id, {"groupChatID": group_id})

    return jsonify({"message": "Group deleted successfully."}), 200


# ============================================================================
# MEMBERSHIP ENDPOINTS
# ============================================================================

@groups_bp.post("/<int:group_id>/members")
@jwt_required()
def add_members(group_id: int):
    """
    Add members to a group (Owner only).

    Request body:
    - memberIds: list[int]
    - encryptedKeys: dict (optional, {userId: encryptedKey})
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_owner(group_id, current_user_id):
        return jsonify({"message": "Only the owner can add members."}), 403

    payload = request.get_json(silent=True) or {}
    member_ids = payload.get("memberIds", [])
    encrypted_keys = payload.get("encryptedKeys", {})

    if not isinstance(member_ids, list) or not member_ids:
        return jsonify({"message": "memberIds must be a non-empty list."}), 400

    # Check member limit
    current_count = len(group.members)
    if current_count + len(member_ids) > MAX_GROUP_MEMBERS:
        return jsonify({"message": f"Maximum {MAX_GROUP_MEMBERS} members allowed."}), 400

    added_members = []
    for member_id in member_ids:
        # Check if already a member
        if _is_group_member(group_id, member_id):
            continue

        # Check if user exists
        user = User.query.get(member_id)
        if not user:
            continue

        # Add member
        member = GroupMember(
            groupChatID=group_id,
            userID=member_id,
            role="Member",
            encrypted_group_key=encrypted_keys.get(str(member_id)),
        )
        db.session.add(member)
        added_members.append(member_id)

    db.session.commit()

    # Notify new members about the group
    group_data = group.to_dict(include_members=True)
    for member_id in added_members:
        # Include the member's encrypted group key in the notification
        member_data = {
            **group_data,
            "encryptedGroupKey": encrypted_keys.get(str(member_id)),
        }
        emit_group_created(member_id, member_data)

    # Notify existing members about new additions
    for existing_member in group.members:
        if existing_member.userID not in added_members and existing_member.userID != current_user_id:
            for new_member_id in added_members:
                new_user = User.query.get(new_member_id)
                if new_user:
                    emit_group_member_added(existing_member.userID, {
                        "groupChatID": group_id,
                        "member": new_user.to_dict(),
                    })

    return jsonify({
        "message": f"Added {len(added_members)} member(s).",
        "addedMembers": added_members,
    }), 200


@groups_bp.delete("/<int:group_id>/members/<int:member_id>")
@jwt_required()
def remove_member(group_id: int, member_id: int):
    """
    Remove a member from a group.
    - Owner can remove anyone
    - Members can only remove themselves (leave)

    Before removal, unstars any saved messages for that member and notifies them to remove from backups.
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    # Check permissions
    is_self = member_id == current_user_id
    is_owner_user = _is_owner(group_id, current_user_id)

    if not is_self and not is_owner_user:
        return jsonify({"message": "Only the owner can remove other members."}), 403

    # Can't remove the owner unless they're leaving
    if _is_owner(group_id, member_id) and not is_self:
        return jsonify({"message": "Cannot remove the owner."}), 400

    # If owner is leaving, they must transfer ownership first
    if is_self and is_owner_user:
        return jsonify({"message": "Transfer ownership before leaving the group."}), 400

    # Remove the member
    membership = GroupMember.query.filter_by(
        groupChatID=group_id,
        userID=member_id
    ).first()

    if not membership:
        return jsonify({"message": "Member not found."}), 404

    # Get all message IDs for this group
    group_message_ids = [m.msgID for m in Message.query.filter_by(groupChatID=group_id).all()]

    # Before deleting, unstar any saved messages and notify the member
    if group_message_ids:
        # Get all saved message statuses for this member
        saved_statuses = GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID.in_(group_message_ids),
            GroupMessageStatus.userID == member_id,
            GroupMessageStatus.saved_by_user == True
        ).all()

        # Unstar all saved messages for this member
        for status in saved_statuses:
            status.saved_by_user = False

        db.session.commit()

        # Emit WebSocket events to the member for each saved message that was unstarred
        # This will unstar the message in chat and remove it from their backup folder
        saved_message_ids = [s.msgID for s in saved_statuses]
        for message_id in saved_message_ids:
            emit_group_message_saved(member_id, {
                "groupChatID": group_id,
                "messageId": message_id,
                "saved": False,
                "savedBy": current_user_id,  # Who initiated the removal
            })

    # Delete all GroupMessageStatus records for this member in this group
    if group_message_ids:
        GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID.in_(group_message_ids),
            GroupMessageStatus.userID == member_id
        ).delete(synchronize_session=False)

    db.session.delete(membership)
    db.session.commit()

    # Notify remaining members
    for remaining in group.members:
        if remaining.userID != current_user_id:
            emit_group_member_removed(remaining.userID, {
                "groupChatID": group_id,
                "removedUserId": member_id,
            })

    # Notify the removed member
    if not is_self:
        emit_group_member_removed(member_id, {
            "groupChatID": group_id,
            "removedUserId": member_id,
        })

    return jsonify({"message": "Member removed successfully."}), 200


@groups_bp.patch("/<int:group_id>/members/<int:member_id>/role")
@jwt_required()
def update_member_role(group_id: int, member_id: int):
    """
    Transfer ownership to another member (Owner only).

    Request body:
    - role: "Owner" (to transfer ownership)
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_owner(group_id, current_user_id):
        return jsonify({"message": "Only the owner can transfer ownership."}), 403

    if member_id == current_user_id:
        return jsonify({"message": "You are already the owner."}), 400

    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")

    if new_role != "Owner":
        return jsonify({"message": "Can only transfer ownership (role: 'Owner')."}), 400

    # Get both memberships
    current_owner = GroupMember.query.filter_by(
        groupChatID=group_id,
        userID=current_user_id
    ).first()
    new_owner = GroupMember.query.filter_by(
        groupChatID=group_id,
        userID=member_id
    ).first()

    if not new_owner:
        return jsonify({"message": "Member not found."}), 404

    # Transfer ownership
    current_owner.role = "Member"
    new_owner.role = "Owner"
    group.created_by = member_id

    db.session.commit()

    return jsonify({
        "message": "Ownership transferred successfully.",
        "newOwnerId": member_id,
    }), 200


# ============================================================================
# GROUP KEY MANAGEMENT
# ============================================================================

@groups_bp.post("/<int:group_id>/keys")
@jwt_required()
def store_group_keys(group_id: int):
    """
    Store encrypted group keys for members.

    Request body:
    - encryptedKeys: dict ({userId: encryptedKey})
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    payload = request.get_json(silent=True) or {}
    encrypted_keys = payload.get("encryptedKeys", {})

    if not isinstance(encrypted_keys, dict):
        return jsonify({"message": "encryptedKeys must be an object."}), 400

    # Update keys for each member
    for user_id_str, encrypted_key in encrypted_keys.items():
        try:
            user_id = int(user_id_str)
        except ValueError:
            continue

        membership = GroupMember.query.filter_by(
            groupChatID=group_id,
            userID=user_id
        ).first()

        if membership:
            membership.encrypted_group_key = encrypted_key

    db.session.commit()

    return jsonify({"message": "Group keys stored successfully."}), 200


@groups_bp.get("/<int:group_id>/keys")
@jwt_required()
def get_group_key(group_id: int):
    """Get the current user's encrypted group key."""
    current_user_id = _current_user_id()

    membership = GroupMember.query.filter_by(
        groupChatID=group_id,
        userID=current_user_id
    ).first()

    if not membership:
        return jsonify({"message": "You are not a member of this group."}), 403

    # Debug logging
    print(f"[DEBUG] get_group_key: group_id={group_id}, user_id={current_user_id}, has_key={membership.encrypted_group_key is not None}")

    return jsonify({
        "encryptedGroupKey": membership.encrypted_group_key,
    }), 200


@groups_bp.post("/<int:group_id>/keys/rotate")
@jwt_required()
def rotate_group_key(group_id: int):
    """
    Rotate the group key (after member removal).

    Request body:
    - encryptedKeys: dict ({userId: newEncryptedKey})
    """
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    payload = request.get_json(silent=True) or {}
    encrypted_keys = payload.get("encryptedKeys", {})

    if not isinstance(encrypted_keys, dict):
        return jsonify({"message": "encryptedKeys must be an object."}), 400

    # Update keys for each member
    for user_id_str, encrypted_key in encrypted_keys.items():
        try:
            user_id = int(user_id_str)
        except ValueError:
            continue

        membership = GroupMember.query.filter_by(
            groupChatID=group_id,
            userID=user_id
        ).first()

        if membership:
            membership.encrypted_group_key = encrypted_key

    db.session.commit()

    # Notify all members about the key rotation
    for member in group.members:
        if member.userID != current_user_id:
            emit_group_key_rotated(member.userID, {
                "groupChatID": group_id,
                "encryptedGroupKey": member.encrypted_group_key,
            })

    return jsonify({"message": "Group key rotated successfully."}), 200


# ============================================================================
# GROUP MESSAGING ENDPOINTS
# ============================================================================

@groups_bp.get("/<int:group_id>/messages")
@jwt_required()
def get_group_messages(group_id: int):
    """Get messages in a group."""
    current_user_id = _current_user_id()

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    # Get non-expired messages
    cutoff = datetime.utcnow()
    messages = Message.query.filter(
        Message.groupChatID == group_id,
        Message.expiryTime > cutoff,
    ).order_by(Message.timeStamp.asc()).all()

    # Filter out messages deleted for this user
    result = []
    for msg in messages:
        status = GroupMessageStatus.query.filter_by(
            msgID=msg.msgID,
            userID=current_user_id
        ).first()

        if status and status.deleted_for_user:
            continue

        msg_dict = msg.to_dict(current_user_id)

        # Add group-specific read status
        read_statuses = GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID == msg.msgID,
            GroupMessageStatus.read_at.isnot(None)
        ).all()
        # Exclude sender from readBy count
        read_by_ids = [s.userID for s in read_statuses if s.userID != msg.senderID]
        read_count = len(read_by_ids)
        total_members = len(group.members)

        # Add readBy array for frontend
        msg_dict["readBy"] = read_by_ids

        # Determine read status text
        if msg.senderID == current_user_id:
            if read_count == 0:
                msg_dict["groupReadStatus"] = "Delivered"
                msg_dict["groupReadStatusColor"] = "gray"
            elif read_count >= total_members - 1:  # Everyone except sender
                msg_dict["groupReadStatus"] = "Read"
                msg_dict["groupReadStatusColor"] = "blue"
            else:
                msg_dict["groupReadStatus"] = "Read"
                msg_dict["groupReadStatusColor"] = "gray"

        # Symmetric saving: if ANY member saved, it's saved for all
        any_saved = GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID == msg.msgID,
            GroupMessageStatus.saved_by_user == True
        ).first() is not None
        msg_dict["saved"] = any_saved

        result.append(msg_dict)

    return jsonify({"messages": result}), 200


@groups_bp.post("/<int:group_id>/messages")
@jwt_required()
def send_group_message(group_id: int):
    """
    Send a message to a group.

    Request body:
    - encryptedContent: str (encrypted with group key)
    - iv: str
    - hmac: str (auth tag)
    - msgType: str (default: "text")
    - replyToId: int (optional)
    """
    current_user_id = _current_user_id()

    # Check message rate limit
    allowed, error_response, warning = check_message_rate_limit(current_user_id)
    if not allowed:
        return jsonify(error_response), 429

    group = GroupChat.query.get(group_id)
    if not group:
        return jsonify({"message": "Group not found."}), 404

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    payload = request.get_json(silent=True) or {}

    encrypted_content = payload.get("encryptedContent")
    iv = payload.get("iv")
    hmac_tag = payload.get("hmac")

    if not all([encrypted_content, iv, hmac_tag]):
        return jsonify({"message": "encryptedContent, iv, and hmac are required."}), 400

    # Create the message
    message = Message(
        senderID=current_user_id,
        receiverID=None,  # Group message
        groupChatID=group_id,
        encryptedContent=encrypted_content,
        iv=iv,
        hmac=hmac_tag,
        # For groups, sender copy is the same (single encryption with group key)
        sender_encrypted_content=encrypted_content,
        sender_iv=iv,
        sender_hmac=hmac_tag,
        msg_Type=payload.get("msgType", "text"),
        status="Sent",
        expiryTime=Message.default_expiry_time(is_group=True),
        reply_to_id=payload.get("replyToId"),
    )
    db.session.add(message)
    db.session.flush()

    # Mark as read by sender
    sender_status = GroupMessageStatus(
        msgID=message.msgID,
        userID=current_user_id,
        read_at=datetime.utcnow(),
    )
    db.session.add(sender_status)

    db.session.commit()

    # Emit to all other members (pass None so isOwn=False for recipients)
    message_data_for_others = message.to_dict(None)
    message_data_for_others["readBy"] = []  # No one has read yet
    for member in group.members:
        if member.userID != current_user_id:
            emit_group_message(member.userID, {
                "groupChatID": group_id,
                "message": message_data_for_others,
            })

    # Return sender's version with isOwn=True, including rate limit warning if present
    message_data_for_sender = message.to_dict(current_user_id)
    message_data_for_sender["readBy"] = []  # No one has read yet
    response_data = {
        "message": "Message sent successfully.",
        "data": message_data_for_sender,
    }
    if warning:
        response_data["warning"] = warning

    return jsonify(response_data), 201


@groups_bp.patch("/<int:group_id>/messages/<int:message_id>/read")
@jwt_required()
def mark_message_read(group_id: int, message_id: int):
    """Mark a group message as read."""
    current_user_id = _current_user_id()

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    message = Message.query.get(message_id)
    if not message or message.groupChatID != group_id:
        return jsonify({"message": "Message not found."}), 404

    # Get or create status
    status = GroupMessageStatus.query.filter_by(
        msgID=message_id,
        userID=current_user_id
    ).first()

    if not status:
        status = GroupMessageStatus(
            msgID=message_id,
            userID=current_user_id,
        )
        db.session.add(status)

    if not status.read_at:
        status.read_at = datetime.utcnow()

        # Check if all members have read (excluding sender)
        group = GroupChat.query.get(group_id)
        total_other_members = len(group.members) - 1  # Exclude sender
        read_count = GroupMessageStatus.query.filter(
            GroupMessageStatus.msgID == message_id,
            GroupMessageStatus.read_at.isnot(None)
        ).count() + 1  # +1 for current read

        all_read = read_count >= total_other_members

        # Update message expiry if all have read
        if all_read:
            # Get max retention hours from all members
            max_hours = DEFAULT_RETENTION_HOURS
            for member in group.members:
                user = member.user
                hours = _get_user_retention_hours(user)
                max_hours = max(max_hours, hours)
            message.expiryTime = datetime.utcnow() + timedelta(hours=max_hours)
            message.status = "Read"
        elif read_count == 1:
            # First read - start 24h timer
            message.status = "Delivered"

        db.session.commit()

        # Notify sender about read status
        emit_group_message_read(message.senderID, {
            "groupChatID": group_id,
            "messageId": message_id,
            "readBy": current_user_id,
            "allRead": all_read,
        })

    return jsonify({"message": "Marked as read."}), 200


@groups_bp.patch("/<int:group_id>/messages/<int:message_id>/edit")
@jwt_required()
def edit_group_message(group_id: int, message_id: int):
    """
    Edit a group message (sender only).

    Request body:
    - encryptedContent: str
    - iv: str
    - hmac: str
    """
    current_user_id = _current_user_id()

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    message = Message.query.get(message_id)
    if not message or message.groupChatID != group_id:
        return jsonify({"message": "Message not found."}), 404

    if message.senderID != current_user_id:
        return jsonify({"message": "You can only edit your own messages."}), 403

    if message.is_unsent:
        return jsonify({"message": "Cannot edit an unsent message."}), 400

    payload = request.get_json(silent=True) or {}

    encrypted_content = payload.get("encryptedContent")
    iv = payload.get("iv")
    hmac_tag = payload.get("hmac")

    if not all([encrypted_content, iv, hmac_tag]):
        return jsonify({"message": "encryptedContent, iv, and hmac are required."}), 400

    # Update the message
    message.encryptedContent = encrypted_content
    message.iv = iv
    message.hmac = hmac_tag
    message.sender_encrypted_content = encrypted_content
    message.sender_iv = iv
    message.sender_hmac = hmac_tag
    message.edited_at = datetime.utcnow()

    db.session.commit()

    # Notify all members
    group = GroupChat.query.get(group_id)
    for member in group.members:
        if member.userID != current_user_id:
            emit_group_message_edited(member.userID, {
                "groupChatID": group_id,
                "messageId": message_id,
                "encryptedContent": encrypted_content,
                "iv": iv,
                "hmac": hmac_tag,
                "editedAt": message.edited_at.isoformat(),
            })

    return jsonify({
        "message": "Message edited successfully.",
        "messageId": message_id,
        "editedAt": message.edited_at.isoformat(),
    }), 200


@groups_bp.patch("/<int:group_id>/messages/<int:message_id>/unsend")
@jwt_required()
def unsend_group_message(group_id: int, message_id: int):
    """Unsend a group message (sender only)."""
    current_user_id = _current_user_id()

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    message = Message.query.get(message_id)
    if not message or message.groupChatID != group_id:
        return jsonify({"message": "Message not found."}), 404

    if message.senderID != current_user_id:
        return jsonify({"message": "You can only unsend your own messages."}), 403

    if message.is_unsent:
        return jsonify({"message": "Message already unsent."}), 400

    # Mark as unsent
    message.is_unsent = True
    message.unsent_at = datetime.utcnow()
    message.encryptedContent = ""
    message.sender_encrypted_content = ""
    message.expiryTime = datetime.utcnow() + timedelta(hours=2)  # 2 hour expiry for placeholder

    db.session.commit()

    # Notify all members
    group = GroupChat.query.get(group_id)
    sender = User.query.get(current_user_id)
    for member in group.members:
        if member.userID != current_user_id:
            emit_group_message_unsent(member.userID, {
                "groupChatID": group_id,
                "messageId": message_id,
                "senderUsername": sender.username if sender else "Unknown",
                "unsentAt": message.unsent_at.isoformat(),
            })

    # Find the new last message for preview (not unsent, not deleted for user)
    messages = (
        Message.query.filter(
            Message.groupChatID == group_id,
            Message.expiryTime > datetime.utcnow(),
            Message.is_unsent == False,
        )
        .order_by(Message.timeStamp.desc())
        .limit(20)
        .all()
    )

    new_last_message = None
    for msg in messages:
        msg_status = GroupMessageStatus.query.filter_by(
            msgID=msg.msgID,
            userID=current_user_id
        ).first()
        if not msg_status or not msg_status.deleted_for_user:
            new_last_message = msg
            break

    return jsonify({
        "message": "Message unsent successfully.",
        "messageId": message_id,
        "newLastMessage": new_last_message.to_dict(current_user_id) if new_last_message else None,
    }), 200


@groups_bp.delete("/<int:group_id>/messages/<int:message_id>")
@jwt_required()
def delete_group_message(group_id: int, message_id: int):
    """Delete a group message for self only."""
    current_user_id = _current_user_id()

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    message = Message.query.get(message_id)
    if not message or message.groupChatID != group_id:
        return jsonify({"message": "Message not found."}), 404

    # Get or create status
    status = GroupMessageStatus.query.filter_by(
        msgID=message_id,
        userID=current_user_id
    ).first()

    if not status:
        status = GroupMessageStatus(
            msgID=message_id,
            userID=current_user_id,
        )
        db.session.add(status)

    status.deleted_for_user = True
    db.session.commit()

    # Find the new last message for this group (for preview update)
    messages = (
        Message.query.filter(
            Message.groupChatID == group_id,
            Message.expiryTime > datetime.utcnow(),
            Message.is_unsent == False,
        )
        .order_by(Message.timeStamp.desc())
        .limit(20)
        .all()
    )

    new_last_message = None
    for msg in messages:
        msg_status = GroupMessageStatus.query.filter_by(
            msgID=msg.msgID,
            userID=current_user_id
        ).first()
        if not msg_status or not msg_status.deleted_for_user:
            new_last_message = msg
            break

    return jsonify({
        "message": "Message deleted.",
        "newLastMessage": new_last_message.to_dict(current_user_id) if new_last_message else None
    }), 200


@groups_bp.patch("/<int:group_id>/messages/<int:message_id>/save")
@jwt_required()
def save_group_message(group_id: int, message_id: int):
    """
    Star/save a group message for backup.

    Saved messages are exempt from auto-deletion and kept forever.
    When unsaving, the deletion timer is reset to start from the current time.

    Request body:
    - saved: bool
    """
    current_user_id = _current_user_id()

    if not _is_group_member(group_id, current_user_id):
        return jsonify({"message": "You are not a member of this group."}), 403

    message = Message.query.get(message_id)
    if not message or message.groupChatID != group_id:
        return jsonify({"message": "Message not found."}), 404

    payload = request.get_json(silent=True) or {}
    saved = payload.get("saved", False)

    # Get or create status
    status = GroupMessageStatus.query.filter_by(
        msgID=message_id,
        userID=current_user_id
    ).first()

    if not status:
        status = GroupMessageStatus(
            msgID=message_id,
            userID=current_user_id,
        )
        db.session.add(status)

    status.saved_by_user = bool(saved)

    # When unsaving, set timer_reset_at to restart the deletion timer from now
    # When saving, clear timer_reset_at so it doesn't interfere
    if not saved:
        status.timer_reset_at = datetime.utcnow()
    else:
        status.timer_reset_at = None

    db.session.commit()

    # Notify all group members about the save status change
    group = GroupChat.query.get(group_id)
    if group:
        for member in group.members:
            emit_group_message_saved(member.userID, {
                "groupChatID": group_id,
                "messageId": message_id,
                "saved": bool(saved),
                "savedBy": current_user_id,
            })

    return jsonify({
        "message": "Message save status updated.",
        "saved": status.saved_by_user,
    }), 200


__all__ = ["groups_bp"]
