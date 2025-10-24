from __future__ import annotations

from datetime import datetime

from .database import db


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class User(TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)

    conversations = db.relationship(
        "ConversationParticipant",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    friendships = db.relationship(
        "Friendship",
        foreign_keys="Friendship.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "username": self.username,
            "displayName": self.display_name,
        }


class Conversation(TimestampMixin, db.Model):
    __tablename__ = "conversations"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=True)

    participants = db.relationship(
        "ConversationParticipant",
        back_populates="conversation",
        cascade="all, delete-orphan",
        lazy="joined",
    )
    messages = db.relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.sent_at",
    )

    def participant_users(self) -> list["User"]:
        return [participant.user for participant in self.participants]

    def to_summary(self, current_user_id: int) -> dict[str, object]:
        others = [
            participant.user.to_dict()
            for participant in self.participants
            if participant.user_id != current_user_id
        ]
        last_message = self.messages[-1] if self.messages else None

        if self.title:
            name = self.title
        elif others:
            name = ", ".join(user["displayName"] for user in others)
        else:
            name = "Conversation"

        return {
            "id": self.id,
            "name": name,
            "participants": others,
            "lastMessage": last_message.to_dict(current_user_id)
            if last_message
            else None,
            "updatedAt": self.updated_at.isoformat(),
        }


class ConversationParticipant(TimestampMixin, db.Model):
    __tablename__ = "conversation_participants"
    __table_args__ = (
        db.UniqueConstraint("conversation_id", "user_id", name="uq_conversation_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("conversations.id"), nullable=False
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    conversation = db.relationship("Conversation", back_populates="participants")
    user = db.relationship("User", back_populates="conversations")


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("conversations.id"), nullable=False, index=True
    )
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    content = db.Column(db.Text, nullable=False)
    sent_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    read_at = db.Column(db.DateTime, nullable=True)

    conversation = db.relationship("Conversation", back_populates="messages")
    sender = db.relationship("User")

    def to_dict(self, current_user_id: int) -> dict[str, object]:
        return {
            "id": self.id,
            "content": self.content,
            "sentAt": self.sent_at.isoformat(),
            "sender": self.sender.to_dict(),
            "isOwn": self.sender_id == current_user_id,
            "isRead": self.read_at is not None,
        }


class Friendship(db.Model):
    __tablename__ = "friendships"
    __table_args__ = (
        db.UniqueConstraint("user_id", "friend_id", name="uq_friendship_pair"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    friend_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship("User", foreign_keys=[user_id], back_populates="friendships")
    friend = db.relationship("User", foreign_keys=[friend_id])


__all__ = ["User", "Conversation", "ConversationParticipant", "Message", "Friendship"]
