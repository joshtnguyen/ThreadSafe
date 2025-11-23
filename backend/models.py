from __future__ import annotations

from datetime import datetime, timedelta

from .database import db


# ============================================================================
# 1. USER Table (Base Entity)
# ============================================================================
class User(db.Model):
    """User account with authentication and profile information."""

    __tablename__ = "user"

    userID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(255), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password = db.Column(db.String(255), nullable=False)  # Stores hashed password
    display_name = db.Column(db.String(255), nullable=True)  # User's full name
    prof_pic_url = db.Column(db.Text)
    settings = db.Column(db.JSON)  # MySQL: JSON, SQLite: TEXT with JSON serialization
    settings_updated_at = db.Column(db.DateTime, nullable=True, index=True)  # Track when settings last changed
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    public_keys = db.relationship(
        "PublicKey", back_populates="user", cascade="all, delete-orphan"
    )
    sessions = db.relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )
    contacts = db.relationship(
        "Contact",
        foreign_keys="Contact.userID",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    contact_of = db.relationship(
        "Contact",
        foreign_keys="Contact.contact_userID",
        back_populates="contact_user",
        cascade="all, delete-orphan",
    )
    key_verifications = db.relationship(
        "KeyVerification",
        foreign_keys="KeyVerification.userID",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    key_verifications_as_contact = db.relationship(
        "KeyVerification",
        foreign_keys="KeyVerification.contact_userID",
        back_populates="contact_user",
        cascade="all, delete-orphan",
    )
    sent_messages = db.relationship(
        "Message",
        foreign_keys="Message.senderID",
        back_populates="sender",
    )
    received_messages = db.relationship(
        "Message",
        foreign_keys="Message.receiverID",
        back_populates="receiver",
    )
    group_memberships = db.relationship(
        "GroupMember", back_populates="user", cascade="all, delete-orphan"
    )
    created_groups = db.relationship(
        "GroupChat", foreign_keys="GroupChat.created_by", back_populates="creator"
    )
    backups = db.relationship(
        "Backup", back_populates="user", cascade="all, delete-orphan"
    )

    def to_dict(self) -> dict[str, object]:
        """Serialize user data for API responses (excludes password)."""
        return {
            "id": self.userID,
            "username": self.username,
            "email": self.email,
            "displayName": self.display_name or self.username,  # Full name or fallback to username
            "profilePicUrl": self.prof_pic_url,
            "settings": self.settings,
            "isActive": self.is_active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# 2. PUBLIC_KEY Table (Depends on USER)
# ============================================================================
class PublicKey(db.Model):
    """Stores user's public keys for end-to-end encryption."""

    __tablename__ = "public_key"

    keyID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    publicKey = db.Column(db.Text, nullable=False)
    algorithm = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Encrypted private key backup (encrypted with password-derived key)
    encrypted_private_key = db.Column(db.Text, nullable=True)
    private_key_salt = db.Column(db.String(64), nullable=True)  # Hex-encoded salt for PBKDF2
    private_key_iv = db.Column(db.String(64), nullable=True)  # Hex-encoded IV for AES

    # Relationships
    user = db.relationship("User", back_populates="public_keys")

    def to_dict(self) -> dict[str, object]:
        return {
            "keyID": self.keyID,
            "userID": self.userID,
            "publicKey": self.publicKey,
            "algorithm": self.algorithm,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# 3. USER_SESSION Table (Depends on USER)
# ============================================================================
class UserSession(db.Model):
    """Tracks active user sessions with device information."""

    __tablename__ = "user_session"

    sessionID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    token_hash = db.Column(db.String(255), nullable=False, index=True)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    device_info = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    user = db.relationship("User", back_populates="sessions")

    def is_expired(self) -> bool:
        """Check if session has expired."""
        return datetime.utcnow() > self.expires_at

    def to_dict(self) -> dict[str, object]:
        return {
            "sessionID": self.sessionID,
            "userID": self.userID,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
            "deviceInfo": self.device_info,
            "isExpired": self.is_expired(),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# 4. GROUP_CHAT Table (Depends on USER for creator)
# ============================================================================
class GroupChat(db.Model):
    """Group chat container with metadata."""

    __tablename__ = "group_chat"

    groupChatID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    groupName = db.Column(db.String(255), nullable=False)
    created_by = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    creator = db.relationship("User", foreign_keys=[created_by], back_populates="created_groups")
    members = db.relationship(
        "GroupMember", back_populates="group", cascade="all, delete-orphan"
    )
    messages = db.relationship(
        "Message", back_populates="group", cascade="all, delete-orphan"
    )

    def to_dict(self, include_members: bool = False) -> dict[str, object]:
        result = {
            "groupChatID": self.groupChatID,
            "groupName": self.groupName,
            "createdBy": self.created_by,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_members:
            result["members"] = [member.to_dict() for member in self.members]
        return result


# ============================================================================
# 5. CONTACT Table (Self-referential on USER)
# ============================================================================
class Contact(db.Model):
    """User contacts/friends with status tracking."""

    __tablename__ = "contact"
    __table_args__ = (db.PrimaryKeyConstraint("userID", "contact_userID"),)

    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    contact_userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    contactStatus = db.Column(
        db.String(20), default="Pending", index=True
    )  # 'Pending', 'Accepted', or 'Blocked'
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    user = db.relationship("User", foreign_keys=[userID], back_populates="contacts")
    contact_user = db.relationship(
        "User", foreign_keys=[contact_userID], back_populates="contact_of"
    )

    def to_dict(self) -> dict[str, object]:
        return {
            "userID": self.userID,
            "contactUserID": self.contact_userID,
            "contactStatus": self.contactStatus,
            "addedAt": self.added_at.isoformat() if self.added_at else None,
            "contactInfo": self.contact_user.to_dict() if self.contact_user else None,
        }


# ============================================================================
# 6. KEY_VERIFICATION Table (Self-referential on USER)
# ============================================================================
class KeyVerification(db.Model):
    """Tracks verification status between users' encryption keys."""

    __tablename__ = "key_verification"
    __table_args__ = (db.PrimaryKeyConstraint("userID", "contact_userID"),)

    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    contact_userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    is_verified = db.Column(db.Boolean, default=False)
    safety_number = db.Column(db.String(255))
    verified_at = db.Column(db.DateTime)

    # Relationships
    user = db.relationship(
        "User", foreign_keys=[userID], back_populates="key_verifications"
    )
    contact_user = db.relationship(
        "User",
        foreign_keys=[contact_userID],
        back_populates="key_verifications_as_contact",
    )

    def to_dict(self) -> dict[str, object]:
        return {
            "userID": self.userID,
            "contactUserID": self.contact_userID,
            "isVerified": self.is_verified,
            "safetyNumber": self.safety_number,
            "verifiedAt": self.verified_at.isoformat() if self.verified_at else None,
        }


# ============================================================================
# 7. GROUP_MEMBER Table (Depends on USER and GROUP_CHAT)
# ============================================================================
class GroupMember(db.Model):
    """Group membership with role-based permissions."""

    __tablename__ = "group_member"
    __table_args__ = (db.PrimaryKeyConstraint("groupChatID", "userID"),)

    groupChatID = db.Column(
        db.Integer,
        db.ForeignKey("group_chat.groupChatID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    role = db.Column(
        db.String(20), nullable=False, index=True
    )  # 'Owner', 'Admin', 'Member'
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    group = db.relationship("GroupChat", back_populates="members")
    user = db.relationship("User", back_populates="group_memberships")

    def to_dict(self) -> dict[str, object]:
        return {
            "groupChatID": self.groupChatID,
            "userID": self.userID,
            "role": self.role,
            "joinedAt": self.joined_at.isoformat() if self.joined_at else None,
            "user": self.user.to_dict() if self.user else None,
        }


# ============================================================================
# 8. MESSAGE Table (Depends on USER and GROUP_CHAT)
# ============================================================================
class Message(db.Model):
    """Encrypted message with E2EE fields (iv, hmac, expiry)."""

    __tablename__ = "message"

    msgID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    senderID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    receiverID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    groupChatID = db.Column(
        db.Integer,
        db.ForeignKey("group_chat.groupChatID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    # Recipient's encrypted copy
    encryptedContent = db.Column(db.Text, nullable=False)
    iv = db.Column(db.String(255), nullable=False)  # Initialization Vector
    hmac = db.Column(db.String(255), nullable=False)  # HMAC for integrity (auth tag for GCM)
    encrypted_aes_key = db.Column(db.Text, nullable=True)  # Encrypted AES key (for hybrid encryption)
    ephemeral_public_key = db.Column(db.Text, nullable=True)  # Ephemeral public key (for ECIES)

    # Sender's encrypted copy (so they can read their own messages)
    sender_encrypted_content = db.Column(db.Text, nullable=True)
    sender_iv = db.Column(db.String(255), nullable=True)
    sender_hmac = db.Column(db.String(255), nullable=True)
    sender_encrypted_aes_key = db.Column(db.Text, nullable=True)
    sender_ephemeral_public_key = db.Column(db.Text, nullable=True)

    status = db.Column(db.String(20), default="Sent")  # 'Sent', 'Delivered', 'Read'
    msg_Type = db.Column(db.String(20), nullable=False)  # 'text', 'image'
    timeStamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    expiryTime = db.Column(db.DateTime, nullable=False, index=True)

    # Read tracking and per-user save feature
    read_by_sender_at = db.Column(db.DateTime, nullable=True, index=True)
    read_by_receiver_at = db.Column(db.DateTime, nullable=True, index=True)
    saved_by_sender = db.Column(db.Boolean, default=False, nullable=False, index=True)
    saved_by_receiver = db.Column(db.Boolean, default=False, nullable=False, index=True)

    # Per-user soft delete (each user controls when message disappears for them)
    deleted_for_sender = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_for_receiver = db.Column(db.Boolean, default=False, nullable=False, index=True)

    # Edit and unsend features
    edited_at = db.Column(db.DateTime, nullable=True)  # When message was edited
    is_unsent = db.Column(db.Boolean, default=False, nullable=False)  # Whether message was unsent
    unsent_at = db.Column(db.DateTime, nullable=True)  # When message was unsent

    # Reply feature - reference to parent message
    reply_to_id = db.Column(
        db.Integer,
        db.ForeignKey("message.msgID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    sender = db.relationship("User", foreign_keys=[senderID], back_populates="sent_messages")
    receiver = db.relationship(
        "User", foreign_keys=[receiverID], back_populates="received_messages"
    )
    group = db.relationship("GroupChat", back_populates="messages")
    reply_to = db.relationship("Message", remote_side=[msgID], foreign_keys=[reply_to_id])

    def is_expired(self) -> bool:
        """Check if message has expired."""
        return datetime.utcnow() > self.expiryTime

    def _get_reply_preview(self, current_user_id: int | None = None) -> dict[str, object] | None:
        """Get a preview of the replied-to message."""
        if not self.reply_to:
            return None

        reply_msg = self.reply_to
        is_reply_sender = reply_msg.senderID == current_user_id if current_user_id else False

        return {
            "id": reply_msg.msgID,
            "senderID": reply_msg.senderID,
            "senderUsername": reply_msg.sender.username if reply_msg.sender else None,
            "isUnsent": reply_msg.is_unsent,
            # Return appropriate encrypted content based on who's requesting
            "encryptedContent": reply_msg.sender_encrypted_content if is_reply_sender and reply_msg.sender_encrypted_content else reply_msg.encryptedContent,
            "iv": reply_msg.sender_iv if is_reply_sender and reply_msg.sender_iv else reply_msg.iv,
            "hmac": reply_msg.sender_hmac if is_reply_sender and reply_msg.sender_hmac else reply_msg.hmac,
        }

    def to_dict(self, current_user_id: int | None = None) -> dict[str, object]:
        """Serialize message for API response."""
        # Return appropriate encrypted version based on who's requesting
        is_sender = self.senderID == current_user_id if current_user_id else False

        # Shared saved state: if either participant saved the message, it is considered saved for both
        saved_by_current_user = self.saved_by_sender or self.saved_by_receiver

        result = {
            "id": self.msgID,
            "senderID": self.senderID,
            "receiverID": self.receiverID,
            "groupChatID": self.groupChatID,
            "status": self.status,
            "msgType": self.msg_Type,
            "timestamp": self.timeStamp.isoformat() if self.timeStamp else None,
            "sentAt": self.timeStamp.isoformat() if self.timeStamp else None,  # Backward compatibility
            "expiryTime": self.expiryTime.isoformat() if self.expiryTime else None,
            "isExpired": self.is_expired(),
            "sender": self.sender.to_dict() if self.sender else None,
            "receiver": self.receiver.to_dict() if self.receiver else None,
            "isOwn": is_sender,
            "saved": saved_by_current_user,  # Per-user saved status
            "readBySenderAt": self.read_by_sender_at.isoformat() if self.read_by_sender_at else None,
            "readByReceiverAt": self.read_by_receiver_at.isoformat() if self.read_by_receiver_at else None,
            # Edit and unsend fields
            "editedAt": self.edited_at.isoformat() if self.edited_at else None,
            "isUnsent": self.is_unsent,
            "unsentAt": self.unsent_at.isoformat() if self.unsent_at else None,
            # Reply fields
            "replyToId": self.reply_to_id,
            "replyTo": self._get_reply_preview(current_user_id) if self.reply_to_id else None,
        }

        # If user is the sender, return sender's encrypted copy
        if is_sender and self.sender_encrypted_content:
            result.update({
                "encryptedContent": self.sender_encrypted_content,
                "content": self.sender_encrypted_content,
                "iv": self.sender_iv,
                "hmac": self.sender_hmac,
                "encrypted_aes_key": self.sender_encrypted_aes_key,
                "ephemeral_public_key": self.sender_ephemeral_public_key,
            })
        else:
            # Return recipient's encrypted copy
            result.update({
                "encryptedContent": self.encryptedContent,
                "content": self.encryptedContent,
                "iv": self.iv,
                "hmac": self.hmac,
                "encrypted_aes_key": self.encrypted_aes_key,
                "ephemeral_public_key": self.ephemeral_public_key,
            })

        return result

    @staticmethod
    def default_expiry_time(is_group: bool = False) -> datetime:
        """Calculate default expiry time: 3 days for 1-to-1, 24 hours for groups."""
        hours = 24 if is_group else 72
        return datetime.utcnow() + timedelta(hours=hours)


# ============================================================================
# 9. BACKUP Table (Depends on USER)
# ============================================================================
class Backup(db.Model):
    """Encrypted backup storage for user data."""

    __tablename__ = "backup"

    backupID = db.Column(db.Integer, primary_key=True, autoincrement=True)
    userID = db.Column(
        db.Integer,
        db.ForeignKey("user.userID", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    encrypted_data = db.Column(db.Text, nullable=False)  # LONGTEXT equivalent
    iv = db.Column(db.String(255), nullable=False)
    hmac = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Composite index
    __table_args__ = (db.Index("idx_user_created", "userID", "created_at"),)

    # Relationships
    user = db.relationship("User", back_populates="backups")

    def to_dict(self) -> dict[str, object]:
        return {
            "backupID": self.backupID,
            "userID": self.userID,
            "encryptedData": self.encrypted_data,
            "iv": self.iv,
            "hmac": self.hmac,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# Export all models
# ============================================================================
__all__ = [
    "User",
    "PublicKey",
    "UserSession",
    "GroupChat",
    "Contact",
    "KeyVerification",
    "GroupMember",
    "Message",
    "Backup",
]
