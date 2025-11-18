import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext.jsx";
import { useWebSocket } from "../context/WebSocketContext.jsx";
import { api } from "../lib/api.js";
import { decryptMessageComplete, importPrivateKey } from "../lib/crypto.js";
import { getPrivateKey } from "../lib/keyStorage.js";

const parseTimestamp = (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(`${value}Z`);
  }
  return new Date(value);
};

const formatTime = (value) => {
  const date = parseTimestamp(value);
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const getTimestampMs = (value) => {
  const date = parseTimestamp(value);
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

// Utility component for truncated username display with tooltip
const TruncatedUsername = ({ username, className = "" }) => (
  <span className={`truncate-text ${className}`} title={username}>
    {username}
  </span>
);

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const { onMessageReceived, onFriendRequest, onFriendRequestAccepted, onFriendDeleted, onFriendRequestRejected } = useWebSocket();

  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [friendMenuOpen, setFriendMenuOpen] = useState(null);
  const [privateKey, setPrivateKey] = useState(null);
  const [decryptedMessages, setDecryptedMessages] = useState({});
  const [isFriendDropdownOpen, setIsFriendDropdownOpen] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResult, setFriendSearchResult] = useState(null);
  const [friendSearchError, setFriendSearchError] = useState("");
  const [isSearchingFriend, setIsSearchingFriend] = useState(false);
  const [blockingUsername, setBlockingUsername] = useState("");
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [unblockingUsername, setUnblockingUsername] = useState("");

  const messageEndRef = useRef(null);
  const friendDropdownRef = useRef(null);
  const friendIconRef = useRef(null);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId],
  );

  // Load private key on mount
  useEffect(() => {
    async function loadPrivateKey() {
      try {
        const privateKeyPem = getPrivateKey(user.id);
        if (privateKeyPem) {
          const key = await importPrivateKey(privateKeyPem);
          setPrivateKey(key);
        } else {
          setToast({
            message: "No encryption keys found. You may need to re-register to decrypt messages.",
            tone: "error",
          });
        }
      } catch (error) {
        console.error("Failed to load private key:", error);
        setToast({
          message: "Failed to load encryption keys. Messages may not decrypt properly.",
          tone: "error",
        });
      }
    }
    loadPrivateKey();
  }, [user.id]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setToast(null);
        setIsLoading(true);
        const [conversationResponse, friendResponse, requestsResponse, blockedResponse] = await Promise.all([
          api.conversations(token),
          api.friends(token),
          api.friendRequests(token),
          api.blockedFriends(token),
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
        const blocked = (blockedResponse.blocked ?? []).sort((a, b) =>
          a.username.localeCompare(b.username),
        );
        setBlockedUsers(blocked);
        if (conversationResponse.conversations?.length) {
          setSelectedId(conversationResponse.conversations[0].id);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setToast({ message: error.message, tone: "error" });
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
          setToast({ message: error.message, tone: "error" });
        }
      }
    }
    loadMessages();
    return () => {
      isMounted = false;
    };
  }, [selectedId, token]);

  // Decrypt messages when they load or private key becomes available
  useEffect(() => {
    if (!privateKey || messages.length === 0) {
      return;
    }

    async function decryptMessages() {
      const newDecryptions = {};

      for (const message of messages) {
        // Skip if missing encryption data
        if (!message.encrypted_aes_key || !message.ephemeral_public_key) {
          continue;
        }

        try {
          const plaintext = await decryptMessageComplete(message, privateKey);
          newDecryptions[message.id] = plaintext;
        } catch (error) {
          console.error(`Failed to decrypt message ${message.id}:`, error);
          newDecryptions[message.id] = "[Decryption failed]";
        }
      }

      // Update all decrypted messages at once
      if (Object.keys(newDecryptions).length > 0) {
        setDecryptedMessages((prev) => ({
          ...prev,
          ...newDecryptions,
        }));
      }
    }

    decryptMessages();
  }, [messages, privateKey]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (friendMenuOpen !== null) {
        setFriendMenuOpen(null);
      }
      if (
        isFriendDropdownOpen &&
        friendDropdownRef.current &&
        !friendDropdownRef.current.contains(event.target) &&
        !friendIconRef.current?.contains(event.target)
      ) {
        setIsFriendDropdownOpen(false);
        setFriendSearchError("");
      }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [friendMenuOpen, isFriendDropdownOpen]);

  // Listen for real-time incoming messages
  useEffect(() => {
    const unsubscribe = onMessageReceived(async (message) => {
      // Decrypt the incoming message immediately if we have a private key
      if (privateKey && message.encrypted_aes_key && message.ephemeral_public_key) {
        try {
          const plaintext = await decryptMessageComplete(message, privateKey);
          // Store decrypted content
          setDecryptedMessages((prev) => ({
            ...prev,
            [message.id]: plaintext,
          }));
        } catch (error) {
          console.error(`Failed to decrypt incoming message ${message.id}:`, error);
          setDecryptedMessages((prev) => ({
            ...prev,
            [message.id]: "[Decryption failed]",
          }));
        }
      }

      // Only add message if it's for the currently selected conversation
      if (message.sender?.id === selectedId || message.receiver?.id === selectedId) {
        setMessages((prev) => [...prev, message]);
      }

      // Update conversation last message and re-sort to move to top
      setConversations((prev) => {
        // Find if conversation already exists
        const otherUserId = message.isOwn ? message.receiverID : message.senderID;
        const existingConv = prev.find((conv) => conv.id === otherUserId);

        let updated;
        if (existingConv) {
          // Update existing conversation
          updated = prev.map((conv) =>
            conv.id === otherUserId
              ? {
                  ...conv,
                  lastMessage: message,
                  updatedAt: message.sentAt,
                }
              : conv
          );
        } else {
          // Create new conversation (first message from this contact)
          const newConversation = {
            id: otherUserId,
            name: message.sender?.username || "Unknown",
            participants: [message.sender],
            lastMessage: message,
            updatedAt: message.sentAt,
          };
          updated = [newConversation, ...prev];
        }

        // Sort by updatedAt descending (newest first)
        return updated.sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt));
      });
    });
    return unsubscribe;
  }, [onMessageReceived, selectedId, privateKey]);

  // Listen for real-time friend requests
  useEffect(() => {
    const unsubscribe = onFriendRequest((request) => {
      setFriendRequests((prev) => ({
        ...prev,
        incoming: [...prev.incoming, request],
      }));
      setToast({ message: `New friend request from ${request.user.username}`, tone: "info" });
    });
    return unsubscribe;
  }, [onFriendRequest]);

  // Listen for friend request acceptance
  useEffect(() => {
    const unsubscribe = onFriendRequestAccepted((friendData) => {
      console.log("Friend request accepted event received:", friendData);

      // Remove from outgoing requests
      setFriendRequests((prev) => {
        const newOutgoing = prev.outgoing.filter((req) => req.user.id !== friendData.id);
        console.log(`Removing from outgoing: ${prev.outgoing.length} -> ${newOutgoing.length}`);
        return {
          ...prev,
          outgoing: newOutgoing,
        };
      });

      // Add to friends list
      setFriends((prev) => {
        const exists = prev.some((f) => f.id === friendData.id);
        if (exists) {
          console.log(`Friend ${friendData.username} already in friends list`);
          return prev;
        }
        console.log(`Adding ${friendData.username} to friends list`);
        return [...prev, friendData].sort((a, b) => a.username.localeCompare(b.username));
      });

      // Update search results if showing this user
      setFriendSearchResult((prev) => {
        if (!prev || prev.user.id !== friendData.id) return prev;
        return { ...prev, relationshipStatus: "friends" };
      });

      setToast({ message: `${friendData.username} accepted your friend request!`, tone: "success" });
    });
    return unsubscribe;
  }, [onFriendRequestAccepted]);

  // Listen for friend deletions
  useEffect(() => {
    const unsubscribe = onFriendDeleted((deleterData) => {
      // Remove the deleter from friends list
      setFriends((prev) => prev.filter((f) => f.id !== deleterData.id));

      // Keep their conversation in the list - chat history preserved
      // Don't clear selectedId - user can still view the chat

      setToast({ message: `${deleterData.username} removed you as a friend. Chat history preserved.`, tone: "info" });
    });
    return unsubscribe;
  }, [onFriendDeleted]);

  // Listen for friend request rejections
  useEffect(() => {
    const unsubscribe = onFriendRequestRejected((rejectorData) => {
      console.log("Friend request rejection event received:", rejectorData);

      // Remove from outgoing requests
      setFriendRequests((prev) => {
        const newOutgoing = prev.outgoing.filter((req) => req.user.id !== rejectorData.id);
        console.log(`Removing from outgoing after rejection: ${prev.outgoing.length} -> ${newOutgoing.length}`);
        return {
          ...prev,
          outgoing: newOutgoing,
        };
      });

      // Update search results if showing this user
      setFriendSearchResult((prev) => {
        if (!prev || prev.user.id !== rejectorData.id) return prev;
        return { ...prev, relationshipStatus: "none" };
      });

      setToast({ message: `${rejectorData.username} declined your friend request.`, tone: "info" });
    });
    return unsubscribe;
  }, [onFriendRequestRejected]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!messageDraft.trim() || !selectedId) {
      return;
    }
    setIsSending(true);
    setToast(null);
    try {
      const response = await api.sendMessage(token, selectedId, messageDraft.trim());
      const newMessage = response.message;

      setMessages((previous) => [...previous, newMessage]);
      setConversations((previous) => {
        const updated = previous.map((conversation) =>
          conversation.id === selectedId
            ? {
                ...conversation,
                lastMessage: newMessage,
                updatedAt: newMessage.sentAt,
              }
            : conversation,
        );
        // Sort by updatedAt descending (newest first)
        return updated.sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt));
      });
      setMessageDraft("");
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
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
    setToast(null);
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
      setIsFriendDropdownOpen(false);
      setFriendMenuOpen(null);
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    } finally {
      setIsOpeningChat(false);
    }
  };

  const handleAddFriend = async (username) => {
    const target = typeof username === "string" ? username.trim() : "";
    if (!target) {
      setToast({ message: "Enter a username to add.", tone: "error" });
      return;
    }
    setIsAddingFriend(true);
    setToast(null);
    try {
      const response = await api.addFriend(token, target);
      const friend = response.friend;
      const status = response.status;

      if (status === "accepted") {
        // Automatically accepted (mutual request) or already friends
        if (friend) {
          // Only add to friends list if friend object exists (new friendship)
          setFriends((previous) => {
            const exists = previous.some((entry) => entry.id === friend.id);
            if (exists) return previous;
            return [...previous, friend].sort((a, b) => a.username.localeCompare(b.username));
          });
        }
        setToast({ message: ` ${response.message || "Now friends!"}`, tone: "success" });
      } else if (status === "pending") {
        // Request sent - add to outgoing requests
        if (friend) {
          setFriendRequests((prev) => ({
            ...prev,
            outgoing: [...prev.outgoing, { requestId: friend.id, user: friend }],
          }));
        }
        setToast({ message: ` ${response.message || "Friend request sent."}`, tone: "success" });
      }
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.username !== target) {
          return previous;
        }
        return {
          ...previous,
          relationshipStatus: status === "accepted" ? "friends" : "pending_outgoing",
        };
      });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleFriendSearch = async (event) => {
    event.preventDefault();
    const query = friendSearchQuery.trim();
    if (!query) {
      setFriendSearchError("Enter a username to search.");
      setFriendSearchResult(null);
      return;
    }
    setIsSearchingFriend(true);
    setFriendSearchError("");
    try {
      const response = await api.searchUser(token, query);
      setFriendSearchResult(response);
    } catch (error) {
      if (error.message === "User not found.") {
        setFriendSearchResult(null);
        setFriendSearchError("No user found.");
      } else {
        setFriendSearchError(error.message);
      }
    } finally {
      setIsSearchingFriend(false);
    }
  };

  const handleAcceptRequest = async (requesterId) => {
    setToast(null);
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
      setToast({ message: ` ${response.message || "Friend request accepted!"}`, tone: "success" });
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== newFriend.id) {
          return previous;
        }
        return { ...previous, relationshipStatus: "friends" };
      });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    }
  };

  const handleRejectRequest = async (requesterId) => {
    setToast(null);
    try {
      await api.rejectFriendRequest(token, requesterId);
      // Remove from incoming requests
      setFriendRequests((prev) => ({
        ...prev,
        incoming: prev.incoming.filter((req) => req.requestId !== requesterId),
      }));
      setToast({ message: "✓ Friend request rejected.", tone: "info" });
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== requesterId) {
          return previous;
        }
        return { ...previous, relationshipStatus: "none" };
      });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    }
  };

  const handleDeleteFriend = async (friendId) => {
    setToast(null);
    try {
      await api.deleteFriend(token, friendId);
      setFriends((previous) => previous.filter((friend) => friend.id !== friendId));
      setFriendMenuOpen(null);
      // If we had a conversation with this friend selected, clear it
      if (selectedId === friendId) {
        setSelectedId(null);
        setMessages([]);
      }
      setToast({ message: "✓ Friend removed. Chat history preserved.", tone: "info" });
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== friendId) {
          return previous;
        }
        return { ...previous, relationshipStatus: "none" };
      });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    }
  };

  const handleBlockUser = async (username) => {
    const target = typeof username === "string" ? username.trim() : "";
    if (!target) {
      return;
    }
    const blockedFriend = friends.find((friend) => friend.username === target);
    setBlockingUsername(target);
    setToast(null);
    try {
      const response = await api.blockUser(token, target);
      const blockedUser = response.user;
      setFriends((previous) => previous.filter((friend) => friend.username !== target));
      setFriendRequests((prev) => ({
        incoming: prev.incoming.filter((req) => req.user.username !== target),
        outgoing: prev.outgoing.filter((req) => req.user.username !== target),
      }));
      setBlockedUsers((prev) => {
        const exists = prev.some((entry) => entry.id === blockedUser.id);
        if (exists) return prev;
        return [...prev, blockedUser].sort((a, b) => a.username.localeCompare(b.username));
      });
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.username !== target) {
          return previous;
        }
        return { ...previous, relationshipStatus: "blocked", user: blockedUser };
      });
      if (blockedFriend && selectedId === blockedFriend.id) {
        setSelectedId(null);
        setMessages([]);
      }
      setToast({ message: `✓ Blocked ${target}.`, tone: "info" });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    } finally {
      setBlockingUsername("");
    }
  };

  const handleUnblockUser = async (username) => {
    const target = typeof username === "string" ? username.trim() : "";
    if (!target) {
      return;
    }
    setUnblockingUsername(target);
    setToast(null);
    try {
      const response = await api.unblockUser(token, target);
      const unblockedUser = response.user;
      setBlockedUsers((prev) => prev.filter((entry) => entry.username !== target));
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.username !== target) {
          return previous;
        }
        return { ...previous, relationshipStatus: "none", user: unblockedUser };
      });
      setToast({ message: `✓ Unblocked ${target}.`, tone: "success" });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    } finally {
      setUnblockingUsername("");
    }
  };

  const toggleFriendDropdown = () => {
    setIsFriendDropdownOpen((previous) => {
      const next = !previous;
      if (!next) {
        setFriendSearchError("");
      }
      return next;
    });
  };

  const relationshipLabels = {
    friends: "You're friends",
    pending_outgoing: "Request sent",
    pending_incoming: "Sent you a request",
    blocked: "Blocked",
    none: "Not connected",
    self: "This is you",
  };

  const renderFriendSearchActions = () => {
    if (!friendSearchResult) {
      return null;
    }
    const username = friendSearchResult.user.username;
    const userId = friendSearchResult.user.id;
    const status = friendSearchResult.relationshipStatus;

    if (status === "self") {
      return null;
    }

    if (status === "friends") {
      return (
        <>
          <button
            type="button"
            className="ghost-button inline"
            onClick={() => startConversationWith(username)}
            disabled={isOpeningChat}
          >
            {isOpeningChat ? "Opening..." : "Message"}
          </button>
          <button
            type="button"
            className="ghost-button inline danger"
            onClick={() => handleBlockUser(username)}
            disabled={blockingUsername === username}
          >
            {blockingUsername === username ? "Blocking..." : "Block"}
          </button>
        </>
      );
    }

    if (status === "pending_incoming") {
      return (
        <>
          <button
            type="button"
            className="ghost-button inline"
            onClick={() => handleAcceptRequest(userId)}
          >
            Accept
          </button>
          <button
            type="button"
            className="ghost-button inline danger"
            onClick={() => handleRejectRequest(userId)}
          >
            Decline
          </button>
        </>
      );
    }

    if (status === "pending_outgoing") {
      return (
        <>
          <span className="search-card-pill">Request sent</span>
          <button
            type="button"
            className="ghost-button inline danger"
            onClick={() => handleBlockUser(username)}
            disabled={blockingUsername === username}
          >
            {blockingUsername === username ? "Blocking..." : "Block"}
          </button>
        </>
      );
    }

    if (status === "blocked") {
      return (
        <>
          <span className="search-card-pill muted">Blocked</span>
          <button
            type="button"
            className="ghost-button inline"
            onClick={() => handleUnblockUser(username)}
            disabled={unblockingUsername === username}
          >
            {unblockingUsername === username ? "Unblocking..." : "Unblock"}
          </button>
        </>
      );
    }

    return (
      <>
        <button
          type="button"
          className="ghost-button inline"
          onClick={() => handleAddFriend(username)}
          disabled={isAddingFriend}
        >
          {isAddingFriend ? "Sending..." : "Add Friend"}
        </button>
        <button
          type="button"
          className="ghost-button inline danger"
          onClick={() => handleBlockUser(username)}
          disabled={blockingUsername === username}
        >
          {blockingUsername === username ? "Blocking..." : "Block"}
        </button>
      </>
    );
  };

  return (
    <main className="chat-shell">
      {toast && (
        <div className={`toast ${toast.tone}`}>
          {toast.message}
        </div>
      )}
      <div className="chat-layout">
        <aside className="sidebar sidebar-rail">
          <div className="sidebar-profile">
            <div className="avatar">{user.displayName?.charAt(0).toUpperCase()}</div>
            <div className="sidebar-profile-copy" style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={user.displayName || user.username}>
                {user.displayName || user.username}
              </h2>
              <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`@${user.username}`}>
                @{user.username}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`sidebar-icon ${isFriendDropdownOpen ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleFriendDropdown();
            }}
            ref={friendIconRef}
          >
            <span aria-hidden>👥</span>
            <span>Friends</span>
            {friendRequests.incoming.length > 0 && (
              <span className="sidebar-icon-badge">{friendRequests.incoming.length}</span>
            )}
          </button>
          <div className="sidebar-spacer" />
          <button
            type="button"
            className="sidebar-icon"
            title="Settings"
          >
            <span aria-hidden>⚙️</span>
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="sidebar-mini-logout"
            onClick={logout}
            title="Log out"
          >
            <span className="logout-icon" aria-hidden>
              ⎋
            </span>
            <span>Log out</span>
          </button>
          {isFriendDropdownOpen && (
            <div className="friend-dropdown" ref={friendDropdownRef}>
              <div className="friend-dropdown-scroll">
                <div className="friend-dropdown-header">
                  <h2>Connections</h2>
                  <p>Search, add, or manage friends.</p>
                </div>
                <form className="friend-search-form" onSubmit={handleFriendSearch}>
                  <label className="field ghost">
                    <span className="field-label">Search by username</span>
                    <input
                      name="friendSearch"
                      placeholder="Enter username"
                      value={friendSearchQuery}
                      onChange={(event) => setFriendSearchQuery(event.target.value)}
                    />
                  </label>
                  <button className="ghost-button" type="submit" disabled={isSearchingFriend}>
                    {isSearchingFriend ? "Searching..." : "Search"}
                  </button>
                </form>
                {friendSearchError && (
                  <p className="friend-search-feedback">{friendSearchError}</p>
                )}
                {friendSearchResult && (
                  <div className="friend-search-card">
                    <div className="search-card-avatar">
                      {friendSearchResult.user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="search-card-info">
                      <p className="search-card-name">
                        {friendSearchResult.user.displayName || friendSearchResult.user.username}
                      </p>
                      <p className="search-card-username">@{friendSearchResult.user.username}</p>
                      <span className="search-card-status">
                        {relationshipLabels[friendSearchResult.relationshipStatus]}
                      </span>
                    </div>
                    <div className="search-card-actions">{renderFriendSearchActions()}</div>
                  </div>
                )}
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
                  {blockedUsers.length > 0 && (
                    <div className="nav-section">
                      <p className="nav-title" style={{ paddingTop: "16px" }}>
                        Blocked ({blockedUsers.length})
                      </p>
                      <div className="blocked-list">
                        {blockedUsers.map((blocked) => (
                          <div className="blocked-entry" key={blocked.id ?? blocked.username}>
                            <div className="blocked-entry-info">
                              <span className="blocked-entry-avatar">
                                {blocked.username?.charAt(0).toUpperCase()}
                              </span>
                              <div>
                                <div className="blocked-entry-name">
                                  {blocked.displayName || blocked.username}
                                </div>
                                <div className="blocked-entry-username">@{blocked.username}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="ghost-button inline"
                              onClick={() => handleUnblockUser(blocked.username)}
                              disabled={unblockingUsername === blocked.username}
                            >
                              {unblockingUsername === blocked.username ? "Unblocking..." : "Unblock"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </nav>
              </div>
            </div>
          )}
        </aside>
        <div className="chat-columns">
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
                  // Show decrypted preview if available, otherwise encrypted preview
                const lastMsg = conversation.lastMessage;
                const preview = lastMsg
                  ? (decryptedMessages[lastMsg.id] || lastMsg.content || "Encrypted message")
                  : "No messages yet.";
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
                        <span className="conversation-name" title={conversation.name}>{conversation.name}</span>
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
              <h1
              style={selectedConversation ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : {}}
              title={selectedConversation?.name || ""}
            >
              {selectedConversation?.name || "Select a conversation"}
            </h1>
            </header>
            <div className="message-list">
              {selectedConversation ? (
                messages.length ? (
                  messages.map((message) => {
                  // All messages are now decryptable (including our own sent messages!)
                  const displayContent = decryptedMessages[message.id] ||
                    (privateKey ? "Decrypting..." : message.content);

                  return (
                      <article
                        key={message.id}
                        className={`message-bubble ${message.isOwn ? "own" : "their"}`}
                      >
                        <span className="bubble-meta" title={message.isOwn ? "You" : message.sender.username}>
                          {message.isOwn ? "You" : message.sender.username}
                        </span>
                        <p className="bubble-text">{displayContent}</p>
                        <time className="bubble-time">{formatTime(message.sentAt)}</time>
                      </article>
                    );
                })
                ) : (
                  <p className="placeholder">No messages yet. Say hello!</p>
                )
              ) : (
                <p className="placeholder">Pick a conversation to start chatting.</p>
              )}
              <span ref={messageEndRef} />
            </div>
            <form className="composer" onSubmit={handleSendMessage}>
              <textarea
                className="composer-input"
                placeholder="Type Your Message..."
                value={messageDraft}
                disabled={!selectedConversation}
                onChange={(event) => setMessageDraft(event.target.value)}
                maxLength={2000}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSendMessage(event);
                }
              }}
            />
              <button
                className="composer-send"
                type="submit"
                disabled={!selectedConversation || isSending || !messageDraft.trim()}
              >
                {isSending ? "…" : "➤"}
              </button>
            </form>
          {selectedConversation && (
            <p className="character-counter">
              {messageDraft.length}/2000 characters
            </p>
          )}
          </section>
        </div>
      </div>
    </main>
  );
}
