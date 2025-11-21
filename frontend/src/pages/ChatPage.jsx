import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useWebSocket } from "../context/WebSocketContext.jsx";
import { api } from "../lib/api.js";
import { decryptMessageComplete, importPrivateKey, encryptMessageForRecipient, generateAESKey, encryptMessage, encryptAESKey } from "../lib/crypto.js";
import { getPrivateKey, getPublicKey } from "../lib/keyStorage.js";

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
  const { user, token, logout, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const {
    onMessageReceived,
    onFriendRequest,
    onFriendRequestAccepted,
    onFriendDeleted,
    onFriendRequestRejected,
    onUserBlocked,
    onUserUnblocked,
    onMessageStatusUpdate,
    onMessageDeleted,
  } = useWebSocket();

  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(null); // Track which conversation's menu is open
  const [conversationMenuPosition, setConversationMenuPosition] = useState({ x: 0, y: 0 });
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [friendMenuOpen, setFriendMenuOpen] = useState(null);
  const [friendMenuPosition, setFriendMenuPosition] = useState({ x: 0, y: 0 });
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [backups, setBackups] = useState([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsForm, setSettingsForm] = useState(() => ({
    messageRetentionHours: String(user?.settings?.messageRetentionHours ?? 72),
    theme: user?.settings?.theme ?? theme ?? "dark",
  }));

  const messageEndRef = useRef(null);
  const friendDropdownRef = useRef(null);
  const friendIconRef = useRef(null);
  const publicKeyCache = useRef({});

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (isSettingsOpen) {
      return;
    }
    setSettingsForm({
      messageRetentionHours: String(user?.settings?.messageRetentionHours ?? 72),
      theme: user?.settings?.theme ?? theme ?? "dark",
    });
  }, [isSettingsOpen, user?.settings?.messageRetentionHours, user?.settings?.theme, theme]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let isMounted = true;
    async function syncSettings() {
      try {
        const response = await api.userSettings(token);
        if (!isMounted) {
          return;
        }
        updateUser((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            settings: response.settings,
          };
        });
        if (response.settings?.theme) {
          setTheme(response.settings.theme);
        }
      } catch (error) {
        console.warn("Failed to load settings:", error);
      }
    }
    syncSettings();
    return () => {
      isMounted = false;
    };
  }, [setTheme, token, updateUser]);

  // Load backups when modal opens
  useEffect(() => {
    if (isBackupModalOpen) {
      loadBackups();
    }
  }, [isBackupModalOpen]);

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

  // Decrypt last messages for all conversations (for previews)
  useEffect(() => {
    if (!privateKey || conversations.length === 0) {
      return;
    }

    async function decryptConversationPreviews() {
      const newDecryptions = {};

      for (const conversation of conversations) {
        const lastMsg = conversation.lastMessage;
        if (!lastMsg) {
          continue; // Skip if no message
        }

        // Check if message has encryption data
        if (lastMsg.encrypted_aes_key && lastMsg.ephemeral_public_key) {
          try {
            const plaintext = await decryptMessageComplete(lastMsg, privateKey);
            newDecryptions[lastMsg.id] = plaintext;
          } catch (error) {
            console.error(`Failed to decrypt preview for message ${lastMsg.id}:`, error);
            newDecryptions[lastMsg.id] = "[Decryption failed]";
          }
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

    decryptConversationPreviews();
  }, [conversations, privateKey]);

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

  // Mark messages as "Read" when conversation is opened
  useEffect(() => {
    if (!selectedId || messages.length === 0) return;

    async function markAsRead() {
      // Find unread messages that we received (not our own)
      const unreadMessages = messages.filter(
        (msg) => !msg.isOwn && msg.status !== "Read"
      );

      for (const msg of unreadMessages) {
        try {
          await api.updateMessageStatus(token, selectedId, msg.id, "Read");
          // Update local message status
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, status: "Read" } : m))
          );
        } catch (error) {
          console.error(`Failed to mark message ${msg.id} as read:`, error);
        }
      }
    }

    markAsRead();
  }, [selectedId, messages.length, token]);

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
      if (conversationMenuOpen !== null) {
        setConversationMenuOpen(null);
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
  }, [friendMenuOpen, conversationMenuOpen, isFriendDropdownOpen]);

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

      // Mark message as "Delivered" if we're the receiver
      if (!message.isOwn && message.status === "Sent") {
        try {
          await api.updateMessageStatus(token, message.senderID, message.id, "Delivered");
        } catch (error) {
          console.error("Failed to update message status to Delivered:", error);
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

  // Listen for message status updates (delivered/read receipts)
  useEffect(() => {
    const unsubscribe = onMessageStatusUpdate((statusData) => {
      const { messageId, status, conversationId } = statusData;

      // Update message status in messages list
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, status } : msg))
      );

      // Update status in conversation preview if it's the last message
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id === conversationId && conv.lastMessage?.id === messageId) {
            return {
              ...conv,
              lastMessage: { ...conv.lastMessage, status },
            };
          }
          return conv;
        })
      );
    });
    return unsubscribe;
  }, [onMessageStatusUpdate]);

  // Listen for message deletion events (real-time auto-delete)
  useEffect(() => {
    const unsubscribe = onMessageDeleted((deletionData) => {
      const { messageId, conversationId } = deletionData;

      console.log(`Message ${messageId} deleted for conversation ${conversationId}`);

      // Remove message from messages list
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));

      // Update conversation list - remove if it was last message
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id === conversationId && conv.lastMessage?.id === messageId) {
            // This was the last message, we need to fetch new last message or set to null
            return { ...conv, lastMessage: null };
          }
          return conv;
        })
      );
    });
    return unsubscribe;
  }, [onMessageDeleted]);

  // Listen for block/unblock events targeting current user
  useEffect(() => {
    const unsubscribeBlocked = onUserBlocked((blocker) => {
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== blocker.id) {
          return previous;
        }
        return { ...previous, user: blocker, relationshipStatus: "blocked_by" };
      });
      setFriends((prev) => prev.filter((friend) => friend.id !== blocker.id));
      if (selectedId === blocker.id) {
        setSelectedId(null);
        setMessages([]);
      }
      setToast({ message: `${blocker.username} has blocked you.`, tone: "info" });
    });

    const unsubscribeUnblocked = onUserUnblocked((unblocker) => {
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== unblocker.id) {
          return previous;
        }
        return { ...previous, user: unblocker, relationshipStatus: "friends" };
      });
      setFriends((prev) => {
        const exists = prev.some((entry) => entry.id === unblocker.id);
        if (exists) return prev;
        return [...prev, unblocker].sort((a, b) => a.username.localeCompare(b.username));
      });
      setToast({ message: `${unblocker.username} unblocked you.`, tone: "success" });
    });

    return () => {
      unsubscribeBlocked();
      unsubscribeUnblocked();
    };
  }, [onUserBlocked, onUserUnblocked, selectedId]);

  const handleSaveMessage = async (messageId, currentSavedStatus) => {
    if (!selectedId || !token) return;

    const newSavedStatus = !currentSavedStatus;

    try {
      // Optimistically update UI
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, saved: newSavedStatus } : msg
        )
      );

      // Call API
      await api.saveMessage(token, selectedId, messageId, newSavedStatus);
    } catch (error) {
      console.error("Failed to save message:", error);
      // Revert on error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, saved: currentSavedStatus } : msg
        )
      );
      setToast({ message: "Failed to save message.", tone: "error" });
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    const content = messageDraft.trim();
    if (!content || !selectedId) {
      return;
    }

    // Clear draft immediately so user can type next message
    // This also prevents duplicate sends on spam-click
    setMessageDraft("");
    setIsSending(true);
    setToast(null);
    try {

      // Get recipient's public key (from cache or fetch)
      let recipientPublicKey = publicKeyCache.current[selectedId];
      if (!recipientPublicKey) {
        const keyResponse = await api.getPublicKey(token, selectedId);
        recipientPublicKey = keyResponse.key.publicKey;
        publicKeyCache.current[selectedId] = recipientPublicKey;
      }

      // Get sender's public key from localStorage
      const senderPublicKey = getPublicKey(user.id);
      if (!senderPublicKey) {
        throw new Error("Your encryption key is missing. Please log out and log back in.");
      }

      // Generate AES key for this message
      const aesKeyBytes = await generateAESKey();

      // Encrypt message content with AES
      const { encryptedContent, iv } = await encryptMessage(content, aesKeyBytes);

      // Encrypt AES key for recipient
      const recipientEncrypted = await encryptAESKey(aesKeyBytes, recipientPublicKey);

      // Encrypt AES key for sender (so they can read their own messages)
      const senderEncrypted = await encryptAESKey(aesKeyBytes, senderPublicKey);

      // Send encrypted message to server
      const response = await api.sendEncryptedMessage(token, selectedId, {
        encryptedContent,
        iv,
        recipientEncryptedKey: recipientEncrypted.encryptedAESKey,
        recipientEphemeralKey: recipientEncrypted.ephemeralPublicKey,
        senderEncryptedKey: senderEncrypted.encryptedAESKey,
        senderEphemeralKey: senderEncrypted.ephemeralPublicKey,
      });

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
        // Update search result to show as friends (handles "already friends" case)
        setFriendSearchResult((previous) => {
          if (!previous || previous.user.username !== target) {
            return previous;
          }
          return {
            ...previous,
            relationshipStatus: "friends",
          };
        });
        setToast({ message: ` ${response.message || "Now friends!"}`, tone: "success" });
        return; // Early return since we've already updated the search result
      } else if (status === "pending") {
        // Request sent - add to outgoing requests
        if (friend) {
          setFriendRequests((prev) => ({
            ...prev,
            outgoing: [...prev.outgoing, { requestId: friend.id, user: friend }],
          }));
        }
        // Update search result to show pending outgoing
        setFriendSearchResult((previous) => {
          if (!previous || previous.user.username !== target) {
            return previous;
          }
          return {
            ...previous,
            relationshipStatus: "pending_outgoing",
          };
        });
        setToast({ message: ` ${response.message || "Friend request sent."}`, tone: "success" });
      }
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
      const wasFriend = response.wasFriend;
      // Remove from blocked list
      setBlockedUsers((prev) => prev.filter((entry) => entry.username !== target));
      // Only add back to friends list if they were friends before blocking
      if (wasFriend) {
        setFriends((prev) => {
          const exists = prev.some((entry) => entry.id === unblockedUser.id);
          if (exists) return prev;
          return [...prev, unblockedUser].sort((a, b) => a.username.localeCompare(b.username));
        });
      }
      // Update search result based on whether they were friends
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.username !== target) {
          return previous;
        }
        return { ...previous, relationshipStatus: wasFriend ? "friends" : "none", user: unblockedUser };
      });
      setToast({ message: `Unblocked ${target}.`, tone: "success" });
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

  const handleThemeChange = (nextTheme) => {
    const safeTheme = nextTheme === "light" ? "light" : "dark";
    setSettingsForm((prev) => ({
      ...prev,
      theme: safeTheme,
    }));
    setTheme(safeTheme);
  };

  const handleSettingsSubmit = async (event) => {
    event?.preventDefault();

    const hours = Number(settingsForm.messageRetentionHours);
    const minHours = 15 / 3600; // 15 seconds
    const maxHours = 72; // 72 hours (3 days)
    if (isNaN(hours) || hours < minHours || hours > maxHours) {
      setSettingsError("Retention must be between 0.004167 hours (15 seconds) and 72 hours (3 days).");
      return;
    }

    setIsSavingSettings(true);
    setSettingsError("");
    try {
      const response = await api.updateSettings(token, {
        messageRetentionHours: hours,
        theme: settingsForm.theme,
      });
      updateUser((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          settings: response.settings,
        };
      });
      setTheme(response.settings.theme);
      setToast({ message: "✓ Settings updated.", tone: "success" });
      setIsSettingsOpen(false);
    } catch (error) {
      setSettingsError(error.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    setBackupError("");
    try {
      const response = await api.getBackups(token);

      // Get private key for decryption
      const privKey = await getPrivateKey(user.id);
      if (!privKey) {
        setBackupError("Private key not found. Cannot decrypt backups.");
        setIsLoadingBackups(false);
        return;
      }

      const importedPrivateKey = await importPrivateKey(privKey);

      // Decrypt each backup message
      const decryptedBackups = await Promise.all(
        response.backups.map(async (backup) => {
          try {
            const decrypted = await decryptMessageComplete(backup, importedPrivateKey);
            return { ...backup, decryptedContent: decrypted };
          } catch (error) {
            console.error("Failed to decrypt backup:", backup.id, error);
            return { ...backup, decryptedContent: "[Unable to decrypt]" };
          }
        })
      );

      setBackups(decryptedBackups);
    } catch (error) {
      setBackupError(error.message);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleDeleteBackup = async (messageId) => {
    try {
      await api.deleteBackup(token, messageId);
      setBackups((prev) => prev.filter((b) => b.id !== messageId));
      setToast({ message: "✓ Backup removed.", tone: "success" });
    } catch (error) {
      setToast({ message: `Failed to remove backup: ${error.message}`, tone: "error" });
    }
  };

  const handleDeleteConversation = async (conversationId) => {
    try {
      await api.deleteConversation(token, conversationId);

      // Remove conversation from list
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      // If the deleted conversation was the active one, clear the chat panel
      if (selectedId === conversationId) {
        setSelectedId(null);
        setMessages([]);
      }

      setToast({ message: "✓ Conversation deleted.", tone: "success" });
    } catch (error) {
      setToast({ message: `Failed to delete conversation: ${error.message}`, tone: "error" });
    }
  };

  const relationshipLabels = {
    friends: "You're friends",
    pending_outgoing: "Request sent",
    pending_incoming: "Sent you a request",
    blocked: "Blocked",
    blocked_by: "This user has blocked you",
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

    if (status === "blocked_by") {
      return (
        <span className="search-card-pill muted">Blocked by user</span>
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
      {isSettingsOpen && (
        <div
          className="settings-overlay"
          onClick={() => {
            if (!isSavingSettings) {
              setIsSettingsOpen(false);
            }
          }}
        >
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Preferences</h2>
                <p>Control auto-deletion and appearance.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </header>
            <form className="settings-form" onSubmit={handleSettingsSubmit}>
              <label className="field ghost">
                <span className="field-label">Auto-delete after (hours)</span>
                <input
                  type="number"
                  min="0.004167"
                  max="72"
                  step="0.000001"
                  value={settingsForm.messageRetentionHours}
                  onChange={(event) => {
                    setSettingsError("");
                    setSettingsForm((prev) => ({
                      ...prev,
                      messageRetentionHours: event.target.value,
                    }));
                  }}
                />
                <span className="field-note">Minimum 0.004167 hours (15 seconds), maximum 72 hours (3 days).</span>
              </label>
              <div className="field ghost">
                <span className="field-label">Theme</span>
                <div className="theme-options">
                  <button
                    type="button"
                    className={`theme-chip ${settingsForm.theme === "light" ? "active" : ""}`}
                    onClick={() => {
                      setSettingsError("");
                      handleThemeChange("light");
                    }}
                  >
                    🌞 Light
                  </button>
                  <button
                    type="button"
                    className={`theme-chip ${settingsForm.theme === "dark" ? "active" : ""}`}
                    onClick={() => {
                      setSettingsError("");
                      handleThemeChange("dark");
                    }}
                  >
                    🌙 Dark
                  </button>
                </div>
              </div>
              <div className="field ghost">
                <span className="field-label">Backup Management</span>
                <button
                  type="button"
                  className="ghost-button inline"
                  onClick={() => {
                    setIsBackupModalOpen(true);
                    setIsSettingsOpen(false);
                  }}
                  style={{ width: "100%", marginTop: "8px" }}
                >
                  📁 Manage Backups
                </button>
                <span className="field-note">View and manage your saved messages.</span>
              </div>
              {settingsError && <p className="form-error banner">{settingsError}</p>}
              <div className="settings-actions">
                <button
                  type="button"
                  className="ghost-button inline"
                  onClick={() => setIsSettingsOpen(false)}
                  disabled={isSavingSettings}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ghost-button inline primary"
                  disabled={isSavingSettings}
                >
                  {isSavingSettings ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isBackupModalOpen && (
        <div className="settings-overlay" onClick={() => setIsBackupModalOpen(false)}>
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "700px", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Backup Management</h2>
                <p>View and manage your saved messages.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsBackupModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div style={{ flex: 1, overflow: "auto", padding: "16px 0" }}>
              {isLoadingBackups ? (
                <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Loading backups...</p>
              ) : backupError ? (
                <p style={{ textAlign: "center", color: "#ff9898" }}>{backupError}</p>
              ) : backups.length === 0 ? (
                <p style={{ textAlign: "center", color: "var(--text-muted)" }}>No saved messages yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {backups.map((backup) => {
                    const isOwn = backup.senderID === user.id;
                    const otherUsername = isOwn
                      ? (backup.receiver?.username || "Unknown")
                      : (backup.sender?.username || "Unknown");
                    const date = new Date(backup.timestamp || backup.sentAt);
                    return (
                      <div
                        key={backup.id}
                        style={{
                          background: "var(--panel-soft)",
                          borderRadius: "16px",
                          padding: "16px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                              {isOwn ? `You → ${otherUsername}` : `${otherUsername} → You`}
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              {date.toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="ghost-button inline danger"
                            onClick={() => handleDeleteBackup(backup.id)}
                            style={{ flexShrink: 0 }}
                          >
                            Delete
                          </button>
                        </div>
                        <p style={{ margin: 0, wordBreak: "break-word", color: "var(--text-primary)" }}>
                          {backup.decryptedContent}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ paddingTop: "16px", borderTop: "1px solid var(--card-border)" }}>
              <button
                type="button"
                className="ghost-button inline"
                onClick={() => setIsBackupModalOpen(false)}
                style={{ width: "100%" }}
              >
                Close
              </button>
            </div>
          </div>
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
            onClick={() => {
              setSettingsError("");
              setIsSettingsOpen(true);
            }}
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
                                const rect = e.currentTarget.getBoundingClientRect();
                                setFriendMenuPosition({
                                  x: rect.right + 12,
                                  y: rect.top + rect.height / 2,
                                });
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
                                  position: "fixed",
                                  left: `${friendMenuPosition.x}px`,
                                  top: `${friendMenuPosition.y}px`,
                                  transform: "translateY(-50%)",
                                  backgroundColor: "white",
                                  border: "1px solid #ddd",
                                  borderRadius: "6px",
                                  boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
                                  zIndex: 4000,
                                  minWidth: "170px",
                                  padding: "6px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "6px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Block ${friend.username}? They won't be able to message you.`
                                      )
                                    ) {
                                      setFriendMenuOpen(null);
                                      handleBlockUser(friend.username);
                                    }
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    border: "none",
                                    background: "#fff6e5",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "#b26a00",
                                    borderRadius: "4px",
                                    fontWeight: 600,
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.target.style.backgroundColor = "#ffe6bf")}
                                  onMouseLeave={(e) => (e.target.style.backgroundColor = "#fff6e5")}
                                >
                                  Block
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(`Remove ${friend.username} from friends?`)) {
                                      setFriendMenuOpen(null);
                                      handleDeleteFriend(friend.id);
                                    }
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    border: "none",
                                    background: "#fff1f1",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "#d32f2f",
                                    borderRadius: "4px",
                                    fontWeight: 600,
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.target.style.backgroundColor = "#ffe1e1")}
                                  onMouseLeave={(e) => (e.target.style.backgroundColor = "#fff1f1")}
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
                    <div
                      key={conversation.id}
                      style={{ position: "relative", width: "100%" }}
                    >
                      <button
                        type="button"
                        className={`conversation-item ${
                          conversation.id === selectedId ? "active" : ""
                        }`}
                        onClick={() => setSelectedId(conversation.id)}
                        style={{ paddingRight: "40px" }}
                      >
                        <div className="conversation-avatar">
                          {conversation.name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="conversation-copy">
                          <span className="conversation-name" title={conversation.name}>{conversation.name}</span>
                          <span className="conversation-preview">{preview}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setConversationMenuPosition({
                            x: rect.right + 12,
                            y: rect.top + rect.height / 2,
                          });
                          setConversationMenuOpen(conversationMenuOpen === conversation.id ? null : conversation.id);
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
                          color: "var(--text-muted)",
                        }}
                      >
                        ⋮
                      </button>
                      {conversationMenuOpen === conversation.id && (
                        <div
                          style={{
                            position: "fixed",
                            left: `${conversationMenuPosition.x}px`,
                            top: `${conversationMenuPosition.y}px`,
                            transform: "translateY(-50%)",
                            backgroundColor: "white",
                            border: "1px solid #ddd",
                            borderRadius: "6px",
                            boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
                            zIndex: 4000,
                            minWidth: "170px",
                            padding: "6px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete conversation with ${conversation.name}? All messages will be permanently removed.`
                                )
                              ) {
                                setConversationMenuOpen(null);
                                handleDeleteConversation(conversation.id);
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              border: "none",
                              background: "#fff1f1",
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#d32f2f",
                              borderRadius: "4px",
                              fontWeight: 600,
                              transition: "background-color 0.15s ease",
                            }}
                            onMouseEnter={(e) => (e.target.style.backgroundColor = "#ffe1e1")}
                            onMouseLeave={(e) => (e.target.style.backgroundColor = "#fff1f1")}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
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

                  // Get status indicator for sent messages
                  const getStatusIndicator = (status) => {
                    if (status === "Read") return <span style={{ color: "#4a9eff" }}>Read</span>;
                    if (status === "Delivered") return <span>Delivered</span>;
                    return <span>Sent</span>;
                  };

                  return (
                      <article
                        key={message.id}
                        className={`message-bubble ${message.isOwn ? "own" : "their"} ${message.saved ? "saved" : ""}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className="bubble-meta" title={message.isOwn ? "You" : message.sender.username}>
                            {message.isOwn ? "You" : message.sender.username}
                          </span>
                          <button
                            type="button"
                            className="save-message-btn"
                            onClick={() => handleSaveMessage(message.id, message.saved)}
                            title={message.saved ? "Unsave message" : "Save message"}
                            aria-label={message.saved ? "Unsave message" : "Save message"}
                          >
                            {message.saved ? "★" : "☆"}
                          </button>
                        </div>
                        <p className="bubble-text">{displayContent}</p>
                        <time className="bubble-time">
                          {message.isOwn && (
                            <>
                              {getStatusIndicator(message.status)}
                              <span style={{ marginLeft: '8px' }}>{formatTime(message.sentAt)}</span>
                            </>
                          )}
                          {!message.isOwn && formatTime(message.sentAt)}
                        </time>
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
