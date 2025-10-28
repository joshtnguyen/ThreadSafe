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
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [addFriendUsername, setAddFriendUsername] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [friendMenuOpen, setFriendMenuOpen] = useState(null);

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
        const [conversationResponse, friendResponse, requestsResponse] = await Promise.all([
          api.conversations(token),
          api.friends(token),
          api.friendRequests(token),
        ]);
        if (!isMounted) {
          return;
        }
        setConversations(conversationResponse.conversations ?? []);
        const orderedFriends = (friendResponse.friends ?? []).sort((a, b) =>
          a.username.localeCompare(b.username),
        );
        setFriends(orderedFriends);
        setFriendRequests({
          incoming: requestsResponse.incoming ?? [],
          outgoing: requestsResponse.outgoing ?? [],
        });
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

  useEffect(() => {
    const handleClickOutside = () => {
      if (friendMenuOpen !== null) {
        setFriendMenuOpen(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [friendMenuOpen]);

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
      const status = response.status;

      if (status === "accepted") {
        // Automatically accepted (mutual request) - add to friends list
        setFriends((previous) => {
          const exists = previous.some((entry) => entry.id === friend.id);
          if (exists) return previous;
          return [...previous, friend].sort((a, b) => a.username.localeCompare(b.username));
        });
        setFeedback(`✓ ${response.message || "Now friends!"}`);
      } else if (status === "pending") {
        // Request sent - add to outgoing requests
        setFriendRequests((prev) => ({
          ...prev,
          outgoing: [...prev.outgoing, { requestId: friend.id, user: friend }],
        }));
        setFeedback(`✓ ${response.message || "Friend request sent."}`);
      }
      setAddFriendUsername("");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleAcceptRequest = async (requesterId) => {
    setFeedback("");
    try {
      const response = await api.acceptFriendRequest(token, requesterId);
      const newFriend = response.friend;
      // Remove from incoming requests
      setFriendRequests((prev) => ({
        ...prev,
        incoming: prev.incoming.filter((req) => req.requestId !== requesterId),
      }));
      // Add to friends list
      setFriends((previous) => {
        const exists = previous.some((entry) => entry.id === newFriend.id);
        if (exists) return previous;
        return [...previous, newFriend].sort((a, b) => a.username.localeCompare(b.username));
      });
      setFeedback(`✓ ${response.message || "Friend request accepted!"}`);
    } catch (error) {
      setFeedback(error.message);
    }
  };

  const handleRejectRequest = async (requesterId) => {
    setFeedback("");
    try {
      await api.rejectFriendRequest(token, requesterId);
      // Remove from incoming requests
      setFriendRequests((prev) => ({
        ...prev,
        incoming: prev.incoming.filter((req) => req.requestId !== requesterId),
      }));
      setFeedback("✓ Friend request rejected.");
    } catch (error) {
      setFeedback(error.message);
    }
  };

  const handleDeleteFriend = async (friendId) => {
    setFeedback("");
    try {
      await api.deleteFriend(token, friendId);
      setFriends((previous) => previous.filter((friend) => friend.id !== friendId));
      setFriendMenuOpen(null);
      // If we had a conversation with this friend selected, clear it
      if (selectedId === friendId) {
        setSelectedId(null);
        setMessages([]);
      }
      setFeedback("✓ Friend removed. Chat history preserved.");
    } catch (error) {
      setFeedback(error.message);
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
            {friendRequests.incoming.length > 0 && (
              <div className="nav-section" style={{ marginBottom: "16px" }}>
                <p className="nav-title">
                  Friend Requests ({friendRequests.incoming.length})
                </p>
                <div className="nav-list">
                  {friendRequests.incoming.map((request) => (
                    <div
                      key={request.requestId}
                      style={{
                        padding: "8px 12px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      <div style={{ marginBottom: "8px", fontWeight: "500" }}>
                        {request.user.username}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => handleAcceptRequest(request.requestId)}
                          style={{
                            flex: 1,
                            padding: "6px 12px",
                            backgroundColor: "#4CAF50",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectRequest(request.requestId)}
                          style={{
                            flex: 1,
                            padding: "6px 12px",
                            backgroundColor: "#f44336",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="nav-section">
              <p className="nav-title">Friends</p>
              <div className="nav-list">
                {friends.length ? (
                  friends.map((friend) => (
                    <div key={friend.id} style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="nav-item"
                        onClick={() => startConversationWith(friend.username)}
                        disabled={isOpeningChat}
                        style={{ paddingRight: "40px" }}
                      >
                        <span className="nav-avatar">
                          {friend.username.charAt(0).toUpperCase()}
                        </span>
                        <span className="nav-label">
                          {friend.username}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFriendMenuOpen(friendMenuOpen === friend.id ? null : friend.id);
                        }}
                        style={{
                          position: "absolute",
                          right: "8px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "18px",
                          padding: "4px 8px",
                          color: "#666",
                        }}
                      >
                        ⋮
                      </button>
                      {friendMenuOpen === friend.id && (
                        <div
                          style={{
                            position: "absolute",
                            right: "8px",
                            top: "100%",
                            backgroundColor: "white",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                            zIndex: 1000,
                            minWidth: "120px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove ${friend.username} from friends?`)) {
                                handleDeleteFriend(friend.id);
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              border: "none",
                              background: "transparent",
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#d32f2f",
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = "#f5f5f5"}
                            onMouseLeave={(e) => e.target.style.backgroundColor = "transparent"}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="nav-empty">No friends yet</p>
                )}
              </div>
            </div>
            {friendRequests.outgoing.length > 0 && (
              <div className="nav-section" style={{ marginTop: "8px" }}>
                <p className="nav-title" style={{ fontSize: "12px", color: "#666" }}>
                  Pending ({friendRequests.outgoing.length})
                </p>
                <div className="nav-list">
                  {friendRequests.outgoing.map((request) => (
                    <div
                      key={request.requestId}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        color: "#999",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>{request.user.username}</span>
                      <span style={{ fontSize: "11px" }}>⏳ Pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </nav>
          <form className="sidebar-start-chat" onSubmit={handleAddFriend}>
            <label className="field ghost">
              <span className="field-label">Add friend</span>
              <input
                name="addFriend"
                placeholder="Username (case-sensitive) or email"
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
                      {message.isOwn ? "You" : message.sender.username}
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
