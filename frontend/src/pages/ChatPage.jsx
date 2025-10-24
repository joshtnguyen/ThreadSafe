import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

const formatTime = (value) => {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function ChatPage() {
  const { user, token, logout } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [addFriendUsername, setAddFriendUsername] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);

  const messageEndRef = useRef(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId],
  );

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setFeedback("");
        setIsLoading(true);
        const [conversationResponse, friendResponse] = await Promise.all([
          api.conversations(token),
          api.friends(token),
        ]);
        if (!isMounted) {
          return;
        }
        setConversations(conversationResponse.conversations ?? []);
        const orderedFriends = (friendResponse.friends ?? []).sort((a, b) =>
          (a.displayName || a.username).localeCompare(b.displayName || b.username),
        );
        setFriends(orderedFriends);
        if (conversationResponse.conversations?.length) {
          setSelectedId(conversationResponse.conversations[0].id);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setFeedback(error.message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let isMounted = true;
    async function loadMessages() {
      try {
        const response = await api.messages(token, selectedId);
        if (isMounted) {
          setMessages(response.messages ?? []);
        }
      } catch (error) {
        if (isMounted) {
          setFeedback(error.message);
        }
      }
    }
    loadMessages();
    return () => {
      isMounted = false;
    };
  }, [selectedId, token]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!messageDraft.trim() || !selectedId) {
      return;
    }
    setIsSending(true);
    setFeedback("");
    try {
      const response = await api.sendMessage(token, selectedId, messageDraft.trim());
      const newMessage = response.message;
      setMessages((previous) => [...previous, newMessage]);
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === selectedId
            ? {
                ...conversation,
                lastMessage: newMessage,
                updatedAt: newMessage.sentAt,
              }
            : conversation,
        ),
      );
      setMessageDraft("");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsSending(false);
    }
  };

  const startConversationWith = async (username) => {
    const target = typeof username === "string" ? username.trim() : "";
    if (!target) {
      return;
    }
    setIsOpeningChat(true);
    setFeedback("");
    try {
      const response = await api.createConversation(token, {
        username: target,
      });
      const conversation = response.conversation;
      setConversations((previous) => {
        const remaining = previous.filter((item) => item.id !== conversation.id);
        return [conversation, ...remaining];
      });
      setSelectedId(conversation.id);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsOpeningChat(false);
    }
  };

  const handleAddFriend = async (event) => {
    event.preventDefault();
    if (!addFriendUsername.trim()) {
      return;
    }
    setIsAddingFriend(true);
    setFeedback("");
    try {
      const response = await api.addFriend(token, addFriendUsername.trim());
      const friend = response.friend;
      setFriends((previous) => {
        const exists = previous.some((entry) => entry.id === friend.id);
        if (exists) {
          return previous;
        }
        return [...previous, friend].sort((a, b) =>
          (a.displayName || a.username).localeCompare(b.displayName || b.username),
        );
      });
      setAddFriendUsername("");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsAddingFriend(false);
    }
  };

  return (
    <main className="chat-shell">
      <div className="chat-layout">
        <aside className="sidebar">
          <div className="sidebar-profile">
            <div className="avatar">{user.displayName?.charAt(0).toUpperCase()}</div>
            <div>
              <h2>{user.displayName || user.username}</h2>
              <p>@{user.username}</p>
            </div>
          </div>
          <nav className="sidebar-nav">
            <div className="nav-section">
              <p className="nav-title">Friends</p>
              <div className="nav-list">
                {friends.length ? (
                  friends.map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      className="nav-item"
                      onClick={() => startConversationWith(friend.username)}
                      disabled={isOpeningChat}
                    >
                      <span className="nav-avatar">
                        {(friend.displayName || friend.username)
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                      <span className="nav-label">
                        {friend.displayName || friend.username}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="nav-empty">No friends yet</p>
                )}
              </div>
            </div>
          </nav>
          <form className="sidebar-start-chat" onSubmit={handleAddFriend}>
            <label className="field ghost">
              <span className="field-label">Add friend by username</span>
              <input
                name="addFriend"
                placeholder="Enter username"
                value={addFriendUsername}
                onChange={(event) => setAddFriendUsername(event.target.value)}
              />
            </label>
            <button
              className="ghost-button"
              type="submit"
              disabled={isAddingFriend}
            >
              {isAddingFriend ? "Adding..." : "Add friend"}
            </button>
          </form>
          <button className="sidebar-logout" type="button" onClick={logout}>
            Log out
          </button>
        </aside>

        <section className="conversation-list">
          <header className="panel-header">
            <h1>Chats</h1>
          </header>
          <div className="conversation-items">
            {isLoading ? (
              <p className="placeholder">Loading conversations...</p>
            ) : conversations.length === 0 ? (
              <p className="placeholder">
                Start a chat from the sidebar to begin messaging.
              </p>
            ) : (
              conversations.map((conversation) => {
                const preview = conversation.lastMessage?.content ?? "No messages yet.";
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`conversation-item ${
                      conversation.id === selectedId ? "active" : ""
                    }`}
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <div className="conversation-avatar">
                      {conversation.name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="conversation-copy">
                      <span className="conversation-name">{conversation.name}</span>
                      <span className="conversation-preview">{preview}</span>
                    </div>
                    <span className="conversation-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="chat-panel">
          <header className="panel-header conversation">
            <h1>{selectedConversation?.name || "Select a conversation"}</h1>
          </header>
          <div className="message-list">
            {selectedConversation ? (
              messages.length ? (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message-bubble ${message.isOwn ? "own" : "their"}`}
                  >
                    <span className="bubble-meta">
                      {message.isOwn ? "You" : message.sender.displayName}
                    </span>
                    <p className="bubble-text">{message.content}</p>
                    <time className="bubble-time">{formatTime(message.sentAt)}</time>
                  </article>
                ))
              ) : (
                <p className="placeholder">No messages yet. Say hello!</p>
              )
            ) : (
              <p className="placeholder">Pick a conversation to start chatting.</p>
            )}
            <span ref={messageEndRef} />
          </div>
          <form className="composer" onSubmit={handleSendMessage}>
            <input
              className="composer-input"
              placeholder="Your message"
              value={messageDraft}
              disabled={!selectedConversation}
              onChange={(event) => setMessageDraft(event.target.value)}
            />
            <button
              className="composer-send"
              type="submit"
              disabled={!selectedConversation || isSending || !messageDraft.trim()}
            >
              {isSending ? "…" : "➤"}
            </button>
          </form>
          {feedback ? <p className="form-error banner">{feedback}</p> : null}
        </section>
      </div>
    </main>
  );
}
