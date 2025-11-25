import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useWebSocket } from "../context/WebSocketContext.jsx";
import { api } from "../lib/api.js";
import { decryptMessageComplete, importPrivateKey, encryptMessageForRecipient, generateAESKey, encryptMessage, encryptAESKey, generateGroupKey, encryptGroupKeyForMembers, decryptGroupKey, encryptGroupMessage, decryptGroupMessage } from "../lib/crypto.js";
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
  // Format: m/dd/yy h:mm am/pm (no leading zeros on hour)
  const month = date.getMonth() + 1;
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12; // Convert to 12-hour format, no leading zero

  return `${month}/${day}/${year} at ${hour12}:${minutes} ${ampm}`;
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
    onFriendRequestCancelled,
    onUserBlocked,
    onUserUnblocked,
    onMessageStatusUpdate,
    onMessageDeleted,
    onMessageEdited,
    onMessageUnsent,
    onMessageSaved,
    // Group chat handlers
    onGroupCreated,
    onGroupMessage,
    onGroupMemberAdded,
    onGroupMemberRemoved,
    onGroupDeleted,
    onGroupMessageEdited,
    onGroupMessageUnsent,
    onGroupMessageRead,
    onGroupKeyRotated,
    onGroupMessageDeleted,
    onGroupMessageSaved,
    onGroupUpdated,
  } = useWebSocket();

  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(null); // Track which conversation's menu is open
  const [conversationMenuPosition, setConversationMenuPosition] = useState({ x: 0, y: 0 });
  const conversationMenuButtonRef = useRef(null); // Track the current open conversation menu button for repositioning
  const [messages, setMessages] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [friendMenuOpen, setFriendMenuOpen] = useState(null);
  const [friendMenuPosition, setFriendMenuPosition] = useState({ x: 0, y: 0 });
  const friendMenuButtonRef = useRef(null); // Track the current open friend menu button for repositioning
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
  const [expandedBackups, setExpandedBackups] = useState(new Set());
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsForm, setSettingsForm] = useState(() => ({
    messageRetentionHours: String(user?.settings?.messageRetentionHours ?? 72),
    theme: user?.settings?.theme ?? theme ?? "dark",
  }));
  const [originalTheme, setOriginalTheme] = useState(theme); // Store original theme for cancel
  const [isUploadingProfilePic, setIsUploadingProfilePic] = useState(false);

  // Edit, unsend, and reply states
  const [contextMenu, setContextMenu] = useState(null); // { x, y, messageId, isOwn }
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [replyingTo, setReplyingTo] = useState(null); // { id, senderUsername, content }
  const [isEditing, setIsEditing] = useState(false);

  // Group chat states
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [createGroupForm, setCreateGroupForm] = useState({ name: "", memberIds: [], profilePic: null });
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const groupPicInputRef = useRef(null);
  const [groupKeys, setGroupKeys] = useState({}); // { groupId: decryptedGroupKey }
  const groupKeysRef = useRef({}); // Ref mirror for synchronous access
  const selectedGroupIdRef = useRef(null); // Ref for synchronous access in WebSocket handlers
  const [groupMenuOpen, setGroupMenuOpen] = useState(null); // Track which group's menu is open
  const [groupMenuPosition, setGroupMenuPosition] = useState({ x: 0, y: 0 });
  const groupMenuButtonRef = useRef(null); // Track the current open group menu button for repositioning
  const [hoveredGroupMembers, setHoveredGroupMembers] = useState(null); // Track which group's member tooltip is shown
  const [memberTooltipPosition, setMemberTooltipPosition] = useState({ x: 0, y: 0 });
  const [isEditGroupPicModalOpen, setIsEditGroupPicModalOpen] = useState(false);
  const [editGroupPicForm, setEditGroupPicForm] = useState({ groupId: null, profilePic: null, groupName: null });
  const editGroupPicInputRef = useRef(null);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState({ groupId: null, selectedFriends: [] });
  const [isRemoveMemberModalOpen, setIsRemoveMemberModalOpen] = useState(false);
  const [removeMemberForm, setRemoveMemberForm] = useState({ groupId: null, selectedMember: null });

  const messageEndRef = useRef(null);
  const friendDropdownRef = useRef(null);
  const friendIconRef = useRef(null);
  const publicKeyCache = useRef({});
  const profilePicInputRef = useRef(null);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  // Keep groupKeysRef in sync with groupKeys state for synchronous access
  useEffect(() => {
    groupKeysRef.current = groupKeys;
  }, [groupKeys]);

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

  // Load backups when modal opens and reset expansion state
  useEffect(() => {
    if (isBackupModalOpen) {
      loadBackups();
      setExpandedBackups(new Set()); // Reset all expanded messages to collapsed
    }
  }, [isBackupModalOpen]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId],
  );

  const selectedGroup = useMemo(
    () => groups.find((group) => group.groupChatID === selectedGroupId),
    [groups, selectedGroupId],
  );

  // Keep selectedGroupIdRef in sync for WebSocket handlers
  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId;
  }, [selectedGroupId]);

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
        const [conversationResponse, friendResponse, requestsResponse, blockedResponse, groupsResponse] = await Promise.all([
          api.conversations(token),
          api.friends(token),
          api.friendRequests(token),
          api.blockedFriends(token),
          api.getGroups(token),
        ]);
        if (!isMounted) {
          return;
        }
        setConversations(conversationResponse.conversations ?? []);
        setGroups(groupsResponse.groups ?? []);
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

  // Decrypt group keys when groups are loaded
  useEffect(() => {
    if (!privateKey || groups.length === 0) {
      return;
    }

    async function decryptGroupKeys() {
      const newKeys = {};

      for (const group of groups) {
        // Skip if we already have this key decrypted
        if (groupKeys[group.groupChatID]) {
          continue;
        }

        // Check if group has an encrypted key attached
        if (group.encryptedGroupKey) {
          try {
            const decryptedKey = await decryptGroupKey(group.encryptedGroupKey, privateKey);
            newKeys[group.groupChatID] = decryptedKey;
          } catch (error) {
            console.error(`Failed to decrypt key for group ${group.groupChatID}:`, error);
          }
        }
      }

      // Update all group keys at once (both ref and state)
      if (Object.keys(newKeys).length > 0) {
        Object.assign(groupKeysRef.current, newKeys);
        setGroupKeys((prev) => ({
          ...prev,
          ...newKeys,
        }));
      }
    }

    decryptGroupKeys();
  }, [groups, privateKey]);

  // Decrypt group message previews when group keys are available
  useEffect(() => {
    if (Object.keys(groupKeys).length === 0 || groups.length === 0) {
      return;
    }

    async function decryptGroupPreviews() {
      const newDecryptions = {};

      for (const group of groups) {
        const lastMsg = group.lastMessage;
        if (!lastMsg || lastMsg.isUnsent) {
          continue;
        }

        // Skip if already decrypted
        if (decryptedMessages[lastMsg.id]) {
          continue;
        }

        // Get the group key
        const groupKey = groupKeys[group.groupChatID];
        if (!groupKey) {
          continue;
        }

        // Check if message has encryption data
        if (lastMsg.encryptedContent && lastMsg.iv) {
          try {
            const plaintext = await decryptGroupMessage(lastMsg.encryptedContent, lastMsg.iv, groupKey);
            newDecryptions[lastMsg.id] = plaintext;
          } catch (error) {
            console.error(`Failed to decrypt group preview for message ${lastMsg.id}:`, error);
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

    decryptGroupPreviews();
  }, [groups, groupKeys]);

  useEffect(() => {
    // Only clear/load messages for 1-1 conversations, not when a group is selected
    if (!selectedId) {
      // Only clear messages if no group is selected either
      if (!selectedGroupId) {
        setMessages([]);
      }
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
  }, [selectedId, selectedGroupId, token]);

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
      if (groupMenuOpen !== null) {
        setGroupMenuOpen(null);
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
  }, [friendMenuOpen, conversationMenuOpen, groupMenuOpen, isFriendDropdownOpen]);

  // Handle window resize to reposition dropdown menus
  useEffect(() => {
    const handleResize = () => {
      const dropdownWidth = 170; // minWidth of the dropdown menu

      // Update friend menu position if it's open
      if (friendMenuOpen !== null && friendMenuButtonRef.current) {
        const rect = friendMenuButtonRef.current.getBoundingClientRect();
        const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

        // In stacked view, always position on the left side of the button
        // In normal view, always position on the right side
        const x = isStackedView
          ? rect.left - dropdownWidth - 12
          : rect.right + 12;

        setFriendMenuPosition({
          x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
          y: rect.top + rect.height / 2,
        });
      }

      // Update conversation menu position if it's open
      if (conversationMenuOpen !== null && conversationMenuButtonRef.current) {
        const rect = conversationMenuButtonRef.current.getBoundingClientRect();
        const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

        // In stacked view, always position on the left side of the button
        // In normal view, always position on the right side
        const x = isStackedView
          ? rect.left - dropdownWidth - 12
          : rect.right + 12;

        setConversationMenuPosition({
          x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
          y: rect.top + rect.height / 2,
        });
      }

      // Update group menu position if it's open
      if (groupMenuOpen !== null && groupMenuButtonRef.current) {
        const rect = groupMenuButtonRef.current.getBoundingClientRect();
        const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

        // In stacked view, always position on the left side of the button
        // In normal view, always position on the right side
        const x = isStackedView
          ? rect.left - dropdownWidth - 12
          : rect.right + 12;

        setGroupMenuPosition({
          x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
          y: rect.top + rect.height / 2,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [friendMenuOpen, conversationMenuOpen, groupMenuOpen]);

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
            profilePicUrl: message.sender?.profilePicUrl || null,
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

  // Listen for friend request cancellations
  useEffect(() => {
    const unsubscribe = onFriendRequestCancelled((cancellerData) => {
      console.log("Friend request cancellation event received:", cancellerData);

      // Remove from incoming requests
      setFriendRequests((prev) => {
        const newIncoming = prev.incoming.filter((req) => req.user.id !== cancellerData.id);
        console.log(`Removing from incoming after cancellation: ${prev.incoming.length} -> ${newIncoming.length}`);
        return {
          ...prev,
          incoming: newIncoming,
        };
      });

      // Update search results if showing this user
      setFriendSearchResult((prev) => {
        if (!prev || prev.user.id !== cancellerData.id) return prev;
        return { ...prev, relationshipStatus: "none" };
      });

      setToast({ message: `${cancellerData.username} cancelled their friend request.`, tone: "info" });
    });
    return unsubscribe;
  }, [onFriendRequestCancelled]);

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

  // Listen for message edited events
  useEffect(() => {
    const unsubscribe = onMessageEdited(async (editData) => {
      const { messageId, message: updatedMessage } = editData;

      console.log(`Message ${messageId} was edited`);

      // Update the message in the messages list
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, ...updatedMessage, editedAt: updatedMessage.editedAt }
            : msg
        )
      );

      // Decrypt the updated message if we have a private key
      if (privateKey && updatedMessage.encrypted_aes_key && updatedMessage.ephemeral_public_key) {
        try {
          const plaintext = await decryptMessageComplete(updatedMessage, privateKey);
          setDecryptedMessages((prev) => ({
            ...prev,
            [messageId]: plaintext,
          }));
        } catch (error) {
          console.error(`Failed to decrypt edited message ${messageId}:`, error);
        }
      }
    });
    return unsubscribe;
  }, [onMessageEdited, privateKey]);

  // Listen for message unsent events
  useEffect(() => {
    const unsubscribe = onMessageUnsent((unsentData) => {
      const { messageId, senderUsername, unsentAt } = unsentData;

      console.log(`Message ${messageId} was unsent by ${senderUsername}`);

      // Update the message in the messages list to show as unsent
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, isUnsent: true, unsentAt, senderUsername }
            : msg
        )
      );

      // Clear decrypted content for this message
      setDecryptedMessages((prev) => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });
    });
    return unsubscribe;
  }, [onMessageUnsent]);

  // Listen for message saved/unsaved events
  useEffect(() => {
    const unsubscribe = onMessageSaved(({ messageId, conversationId, saved }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, saved } : msg
        )
      );

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          if (conv.lastMessage?.id !== messageId) return conv;
          return {
            ...conv,
            lastMessage: { ...conv.lastMessage, saved },
          };
        })
      );

      // If message is unsaved, remove it from the backups list
      if (!saved) {
        setBackups((prev) => prev.filter((b) => b.id !== messageId));
      }
    });
    return unsubscribe;
  }, [onMessageSaved]);

  // ============================================================================
  // GROUP WEBSOCKET EVENT HANDLERS
  // ============================================================================

  // Listen for new group creation (when someone adds us to a group)
  useEffect(() => {
    const unsubscribe = onGroupCreated(async (group) => {
      setGroups((prev) => [group, ...prev]);
      setToast({ message: `You were added to group "${group.groupName}"`, tone: "info" });

      // Immediately decrypt and store the group key if available
      if (group.encryptedGroupKey && privateKey) {
        try {
          const decryptedKey = await decryptGroupKey(group.encryptedGroupKey, privateKey);
          // Update both ref and state
          groupKeysRef.current[group.groupChatID] = decryptedKey;
          setGroupKeys((prev) => ({ ...prev, [group.groupChatID]: decryptedKey }));
        } catch (error) {
          console.error("Failed to decrypt group key on creation:", error);
        }
      }
    });
    return unsubscribe;
  }, [onGroupCreated, privateKey]);

  // Listen for incoming group messages
  useEffect(() => {
    const unsubscribe = onGroupMessage(async (data) => {
      const { groupChatID, message } = data;

      // Always add message to list if this group is selected
      if (selectedGroupId === groupChatID) {
        setMessages((prev) => [...prev, message]);
      }

      // Try to decrypt the message - first check ref (synchronous), then try loading from API
      let groupKey = groupKeysRef.current[groupChatID];
      if (!groupKey) {
        // Key not in cache, try to load it from API
        try {
          const response = await api.getGroupKey(token, groupChatID);
          if (response.encryptedGroupKey && privateKey) {
            groupKey = await decryptGroupKey(response.encryptedGroupKey, privateKey);
            groupKeysRef.current[groupChatID] = groupKey;
            setGroupKeys((prev) => ({ ...prev, [groupChatID]: groupKey }));
          }
        } catch (error) {
          console.error("Failed to load group key for incoming message:", error);
        }
      }

      if (groupKey && message.encryptedContent && message.iv) {
        try {
          const plaintext = await decryptGroupMessage(message.encryptedContent, message.iv, groupKey);
          setDecryptedMessages((prev) => ({
            ...prev,
            [message.id]: plaintext,
          }));
        } catch (error) {
          console.error("Failed to decrypt group message:", error);
        }
      }

      // Mark as read if not our own message and group is selected
      if (selectedGroupId === groupChatID && !message.isOwn) {
        try {
          await api.markGroupMessageRead(token, groupChatID, message.id);
        } catch (error) {
          console.error("Failed to mark group message as read:", error);
        }
      }

      // Update group's last message in list
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === groupChatID ? { ...g, lastMessage: message } : g
        )
      );
    });
    return unsubscribe;
  }, [onGroupMessage, selectedGroupId, groupKeys, token, privateKey]);

  // Listen for group member additions
  useEffect(() => {
    const unsubscribe = onGroupMemberAdded((data) => {
      const { groupChatID, member } = data;
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupChatID !== groupChatID) return g;
          const exists = g.members?.some((m) => m.user?.id === member.user?.id);
          if (exists) return g;
          return { ...g, members: [...(g.members || []), member] };
        })
      );
    });
    return unsubscribe;
  }, [onGroupMemberAdded]);

  // Listen for group member removals
  useEffect(() => {
    const unsubscribe = onGroupMemberRemoved(async (data) => {
      const { groupChatID, removedUserId } = data;

      // If we were removed, remove the group from our list
      if (removedUserId === user.id) {
        setGroups((prev) => prev.filter((g) => g.groupChatID !== groupChatID));
        if (selectedGroupId === groupChatID) {
          setSelectedGroupId(null);
          setMessages([]);
        }
        // Clean up group key
        delete groupKeysRef.current[groupChatID];
        setGroupKeys((prev) => {
          const newKeys = { ...prev };
          delete newKeys[groupChatID];
          return newKeys;
        });
        setToast({ message: "You were removed from a group.", tone: "info" });
      } else {
        // Someone else was removed - update member list
        let updatedGroup = null;
        setGroups((prev) =>
          prev.map((g) => {
            if (g.groupChatID !== groupChatID) return g;
            updatedGroup = {
              ...g,
              members: g.members?.filter((m) => m.user?.id !== removedUserId),
            };
            return updatedGroup;
          })
        );

        // If I'm the owner, rotate keys for forward secrecy
        if (updatedGroup) {
          const myMember = updatedGroup.members?.find((m) => m.user?.id === user.id);
          if (myMember?.role === "Owner") {
            const remainingMemberIds = updatedGroup.members?.map((m) => m.user?.id).filter(Boolean);
            if (remainingMemberIds?.length > 0) {
              console.log("Owner initiating key rotation after member removal...");
              await rotateGroupKey(groupChatID, remainingMemberIds);
            }
          }
        }
      }
    });
    return unsubscribe;
  }, [onGroupMemberRemoved, selectedGroupId, user.id, token]);

  // Listen for group deletions
  useEffect(() => {
    const unsubscribe = onGroupDeleted((data) => {
      const { groupChatID } = data;
      setGroups((prev) => prev.filter((g) => g.groupChatID !== groupChatID));
      if (selectedGroupId === groupChatID) {
        setSelectedGroupId(null);
        setMessages([]);
        setToast({ message: "This group has been deleted.", tone: "info" });
      }
    });
    return unsubscribe;
  }, [onGroupDeleted, selectedGroupId]);

  // Listen for group updates (profile picture, name, etc.)
  useEffect(() => {
    const unsubscribe = onGroupUpdated((data) => {
      const { groupChatID, groupName, profilePicUrl } = data;
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === groupChatID
            ? { ...g, groupName: groupName || g.groupName, profilePicUrl: profilePicUrl !== undefined ? profilePicUrl : g.profilePicUrl }
            : g
        )
      );
    });
    return unsubscribe;
  }, [onGroupUpdated]);

  // Listen for group message edits
  useEffect(() => {
    const unsubscribe = onGroupMessageEdited(async (data) => {
      const { groupChatID, messageId, encryptedContent, iv } = data;

      // Use ref to always get current selectedGroupId value
      if (selectedGroupIdRef.current === groupChatID) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, isEdited: true, encryptedContent, iv } : msg
          )
        );

        // Re-decrypt the edited message - check ref first, then load from API
        let groupKey = groupKeysRef.current[groupChatID];
        if (!groupKey) {
          try {
            const response = await api.getGroupKey(token, groupChatID);
            if (response.encryptedGroupKey && privateKey) {
              groupKey = await decryptGroupKey(response.encryptedGroupKey, privateKey);
              groupKeysRef.current[groupChatID] = groupKey;
              setGroupKeys((prev) => ({ ...prev, [groupChatID]: groupKey }));
            }
          } catch (error) {
            console.error("Failed to load group key for edited message:", error);
          }
        }

        if (groupKey && encryptedContent && iv) {
          try {
            const plaintext = await decryptGroupMessage(encryptedContent, iv, groupKey);
            setDecryptedMessages((prev) => ({
              ...prev,
              [messageId]: plaintext,
            }));
          } catch (error) {
            console.error("Failed to decrypt edited message:", error);
          }
        }
      }
    });
    return unsubscribe;
  }, [onGroupMessageEdited, groupKeys, token, privateKey]);

  // Listen for group message unsend
  useEffect(() => {
    const unsubscribe = onGroupMessageUnsent((data) => {
      const { groupChatID, messageId } = data;

      // Use ref to always get current selectedGroupId value
      if (selectedGroupIdRef.current === groupChatID) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, isUnsent: true, unsentAt: new Date().toISOString() } : msg
          )
        );
      }

      // Update group preview
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupChatID !== groupChatID || g.lastMessage?.id !== messageId) return g;
          return { ...g, lastMessage: { ...g.lastMessage, isUnsent: true } };
        })
      );
    });
    return unsubscribe;
  }, [onGroupMessageUnsent]);

  // Listen for group message read status
  useEffect(() => {
    const unsubscribe = onGroupMessageRead((data) => {
      const { groupChatID, messageId, readBy } = data;
      console.log("[WS] Group message read event:", { groupChatID, messageId, readBy, currentGroupId: selectedGroupIdRef.current });

      // Use ref to always get current selectedGroupId value
      if (selectedGroupIdRef.current === groupChatID) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const currentReadBy = msg.readBy || [];
            if (currentReadBy.includes(readBy)) return msg;
            console.log("[WS] Updating readBy for message", messageId, "adding user", readBy);
            return { ...msg, readBy: [...currentReadBy, readBy] };
          })
        );
      }
    });
    return unsubscribe;
  }, [onGroupMessageRead]);

  // Listen for group key rotation
  useEffect(() => {
    const unsubscribe = onGroupKeyRotated(async (data) => {
      const { groupChatID, encryptedGroupKey } = data;

      // Decrypt and store the new group key (both ref and state)
      if (privateKey && encryptedGroupKey) {
        try {
          const newKey = await decryptGroupKey(encryptedGroupKey, privateKey);
          groupKeysRef.current[groupChatID] = newKey;
          setGroupKeys((prev) => ({ ...prev, [groupChatID]: newKey }));
        } catch (error) {
          console.error("Failed to decrypt rotated group key:", error);
        }
      }
    });
    return unsubscribe;
  }, [onGroupKeyRotated, privateKey]);

  // Listen for group message deletion
  useEffect(() => {
    const unsubscribe = onGroupMessageDeleted((data) => {
      const { groupChatID, messageId } = data;

      // Use ref to always get current selectedGroupId value
      if (selectedGroupIdRef.current === groupChatID) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }

      // Update group's last message if needed
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupChatID !== groupChatID || g.lastMessage?.id !== messageId) return g;
          return { ...g, lastMessage: null };
        })
      );
    });
    return unsubscribe;
  }, [onGroupMessageDeleted]);

  // Listen for group message save/star changes
  useEffect(() => {
    const unsubscribe = onGroupMessageSaved((data) => {
      const { groupChatID, messageId, saved } = data;

      // Use ref to always get current selectedGroupId value
      if (selectedGroupIdRef.current === groupChatID) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, saved } : m))
        );
      }

      // If message is unsaved, remove it from the backups list
      if (!saved) {
        setBackups((prev) => prev.filter((b) => b.id !== messageId));
      }
    });
    return unsubscribe;
  }, [onGroupMessageSaved]);

  // Load group messages when a group is selected
  useEffect(() => {
    if (!selectedGroupId) return;
    if (!privateKey) {
      console.log("[DEBUG] loadGroup: privateKey not available yet, waiting...");
      return;
    }

    let isMounted = true;

    async function loadGroup() {
      try {
        // Load the group key first
        console.log("[DEBUG] loadGroup: Loading key for group", selectedGroupId);
        const key = await loadGroupKey(selectedGroupId);
        console.log("[DEBUG] loadGroup: Key loaded:", key ? "success" : "failed");

        // Then load messages
        const response = await api.getGroupMessages(token, selectedGroupId);
        const loadedMessages = response.messages ?? [];

        if (isMounted) {
          setMessages(loadedMessages);

          // Mark unread messages as read (messages not from us and not already read by us)
          if (user) {
            const unreadMessages = loadedMessages.filter(
              (msg) => !msg.isOwn && !(msg.readBy || []).includes(user.id)
            );

            for (const msg of unreadMessages) {
              try {
                await api.markGroupMessageRead(token, selectedGroupId, msg.id);
                // Update local state to include ourselves in readBy
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === msg.id
                      ? { ...m, readBy: [...(m.readBy || []), user.id] }
                      : m
                  )
                );
              } catch (error) {
                console.error(`Failed to mark group message ${msg.id} as read:`, error);
              }
            }
          }
        }
      } catch (error) {
        if (isMounted) {
          setToast({ message: `Failed to load group: ${error.message}`, tone: "error" });
        }
      }
    }

    loadGroup();
    return () => {
      isMounted = false;
    };
  }, [selectedGroupId, token, privateKey, user]);

  // Decrypt group messages when they load
  useEffect(() => {
    if (!selectedGroupId || messages.length === 0 || !privateKey) return;

    async function decryptMessages() {
      // Try to get key from ref, or load it
      let groupKey = groupKeysRef.current[selectedGroupId];

      if (!groupKey) {
        console.log("[DEBUG] decryptMessages: Key not in cache, trying to load...");
        try {
          const response = await api.getGroupKey(token, selectedGroupId);
          if (response.encryptedGroupKey) {
            groupKey = await decryptGroupKey(response.encryptedGroupKey, privateKey);
            groupKeysRef.current[selectedGroupId] = groupKey;
            setGroupKeys((prev) => ({ ...prev, [selectedGroupId]: groupKey }));
            console.log("[DEBUG] decryptMessages: Key loaded successfully");
          }
        } catch (error) {
          console.error("[DEBUG] decryptMessages: Failed to load key:", error);
          return;
        }
      }

      if (!groupKey) {
        console.log("[DEBUG] decryptMessages: No key available, skipping decryption");
        return;
      }

      const newDecryptions = {};

      for (const message of messages) {
        if (!message.encryptedContent || !message.iv) continue;
        if (decryptedMessages[message.id]) continue; // Already decrypted

        try {
          const plaintext = await decryptGroupMessage(message.encryptedContent, message.iv, groupKey);
          newDecryptions[message.id] = plaintext;
        } catch (error) {
          console.error(`Failed to decrypt group message ${message.id}:`, error);
          newDecryptions[message.id] = "[Decryption failed]";
        }
      }

      if (Object.keys(newDecryptions).length > 0) {
        setDecryptedMessages((prev) => ({ ...prev, ...newDecryptions }));
      }
    }

    decryptMessages();
  }, [messages, selectedGroupId, groupKeys, decryptedMessages, privateKey, token]);

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
      // Remove the conversation with the blocker from the conversations list
      setConversations((prev) => prev.filter((conv) => conv.id !== blocker.id));
      if (selectedId === blocker.id) {
        setSelectedId(null);
        setMessages([]);
      }
    });

    const unsubscribeUnblocked = onUserUnblocked((unblocker) => {
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== unblocker.id) {
          return previous;
        }
        return { ...previous, user: unblocker, relationshipStatus: "none" };
      });
      // Do NOT restore friendship - users must re-add each other
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

  // Right-click context menu handler
  const handleMessageContextMenu = (event, message) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      messageId: message.id,
      isOwn: message.isOwn,
      message,
    });
  };

  // Close context menu on click anywhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  // Start editing a message
  const handleStartEdit = (message) => {
    const content = decryptedMessages[message.id] || "";
    setEditingMessageId(message.id);
    setEditContent(content);
    setContextMenu(null);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  // Save edited message
  const handleSaveEdit = async () => {
    if (!editContent.trim() || !editingMessageId || !selectedId) return;

    setIsEditing(true);
    try {
      // Get recipient's public key
      let recipientPublicKey = publicKeyCache.current[selectedId];
      if (!recipientPublicKey) {
        const keyResponse = await api.getPublicKey(token, selectedId);
        recipientPublicKey = keyResponse.key.publicKey;
        publicKeyCache.current[selectedId] = recipientPublicKey;
      }

      // Get sender's public key
      const senderPublicKey = getPublicKey(user.id);
      if (!senderPublicKey) {
        throw new Error("Your encryption key is missing.");
      }

      // Generate AES key and encrypt
      const aesKeyBytes = await generateAESKey();
      const { encryptedContent, iv } = await encryptMessage(editContent.trim(), aesKeyBytes);
      const recipientEncrypted = await encryptAESKey(aesKeyBytes, recipientPublicKey);
      const senderEncrypted = await encryptAESKey(aesKeyBytes, senderPublicKey);

      // Send edit request
      const response = await api.editMessage(token, selectedId, editingMessageId, {
        encryptedContent,
        iv,
        recipientEncryptedKey: recipientEncrypted.encryptedAESKey,
        recipientEphemeralKey: recipientEncrypted.ephemeralPublicKey,
        senderEncryptedKey: senderEncrypted.encryptedAESKey,
        senderEphemeralKey: senderEncrypted.ephemeralPublicKey,
      });

      // Update local message
      const updatedMessage = response.message;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === editingMessageId ? { ...msg, ...updatedMessage } : msg
        )
      );

      // Update decrypted content
      setDecryptedMessages((prev) => ({
        ...prev,
        [editingMessageId]: editContent.trim(),
      }));

      setToast({ message: "Message edited.", tone: "success" });
      handleCancelEdit();
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    } finally {
      setIsEditing(false);
    }
  };

  // Unsend a message
  const handleUnsendMessage = async (messageId) => {
    if (!selectedId) return;

    try {
      await api.unsendMessage(token, selectedId, messageId);

      // Remove message from local state (it's deleted for sender)
      setMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== messageId);

        // Update conversation's lastMessage to the previous message (or null)
        const previousMessage = filtered.length > 0 ? filtered[filtered.length - 1] : null;
        setConversations((convs) =>
          convs.map((conv) =>
            conv.id === selectedId
              ? { ...conv, lastMessage: previousMessage }
              : conv
          )
        );

        return filtered;
      });

      // Clear decrypted content
      setDecryptedMessages((prev) => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });

      setToast({ message: "Message unsent.", tone: "success" });
    } catch (error) {
      setToast({ message: error.message, tone: "error" });
    }
    setContextMenu(null);
  };

  // Start replying to a message
  const handleStartReply = (message) => {
    const content = decryptedMessages[message.id] || "[Encrypted]";
    setReplyingTo({
      id: message.id,
      senderUsername: message.isOwn ? "You" : message.sender?.username,
      content: content.length > 50 ? content.substring(0, 50) + "..." : content,
    });
    setContextMenu(null);
  };

  // Cancel reply
  const handleCancelReply = () => {
    setReplyingTo(null);
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

      // Send encrypted message to server (with optional reply)
      const encryptedData = {
        encryptedContent,
        iv,
        recipientEncryptedKey: recipientEncrypted.encryptedAESKey,
        recipientEphemeralKey: recipientEncrypted.ephemeralPublicKey,
        senderEncryptedKey: senderEncrypted.encryptedAESKey,
        senderEphemeralKey: senderEncrypted.ephemeralPublicKey,
      };

      const response = replyingTo
        ? await api.sendMessageWithReply(token, selectedId, encryptedData, replyingTo.id)
        : await api.sendEncryptedMessage(token, selectedId, encryptedData);

      const newMessage = response.message;

      // Clear reply state after sending
      if (replyingTo) {
        setReplyingTo(null);
      }

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

  const handleCancelRequest = async (recipientId) => {
    setToast(null);
    try {
      await api.cancelFriendRequest(token, recipientId);
      // Update the search result to reflect the cancelled request
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.id !== recipientId) {
          return previous;
        }
        return { ...previous, relationshipStatus: "none" };
      });
      setToast({ message: "✓ Friend request cancelled.", tone: "info" });
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
      // Remove the conversation with the blocked user from the conversations list
      setConversations((prev) => prev.filter((conv) => conv.id !== blockedUser.id));
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
      setToast({ message: `✓ Blocked ${target}. All messages and conversation deleted.`, tone: "info" });
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
      // Remove from blocked list
      setBlockedUsers((prev) => prev.filter((entry) => entry.username !== target));
      // Do NOT restore friendship - users must re-add each other
      // Update search result to show "none" (not connected)
      setFriendSearchResult((previous) => {
        if (!previous || previous.user.username !== target) {
          return previous;
        }
        return { ...previous, relationshipStatus: "none", user: unblockedUser };
      });
      setToast({ message: `Unblocked ${target}. You can re-add them as a friend if you wish.`, tone: "success" });
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

    // Add class to disable all transitions during theme change
    document.documentElement.classList.add('theme-changing');

    // Apply theme to DOM INSTANTLY (preview only - not saved yet)
    document.documentElement.setAttribute('data-theme', safeTheme);

    // Update form state only (not persisted until Save)
    setSettingsForm((prev) => ({
      ...prev,
      theme: safeTheme,
    }));

    // Remove transition-disabling class after theme is applied
    // Use double RAF to ensure it happens after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('theme-changing');
      });
    });
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
            // Handle group messages differently
            if (backup.isGroupMessage) {
              // Get the group key (check ref first, load if not cached)
              const groupId = backup.groupId;
              let groupKey = groupKeysRef.current[groupId];

              if (!groupKey) {
                // Load the group key from API
                const keyResponse = await api.getGroupKey(token, groupId);
                if (keyResponse.encryptedGroupKey) {
                  groupKey = await decryptGroupKey(keyResponse.encryptedGroupKey, importedPrivateKey);
                  // Cache it for future use (both ref and state)
                  groupKeysRef.current[groupId] = groupKey;
                  setGroupKeys((prev) => ({ ...prev, [groupId]: groupKey }));
                }
              }

              if (groupKey && backup.encryptedContent && backup.iv) {
                const decrypted = await decryptGroupMessage(backup.encryptedContent, backup.iv, groupKey);
                return { ...backup, decryptedContent: decrypted };
              }
              return { ...backup, decryptedContent: "[Unable to decrypt group message]" };
            }

            // Handle 1-1 messages
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

  // ============================================================================
  // GROUP CHAT HANDLERS
  // ============================================================================

  const handleCreateGroup = async () => {
    if (!createGroupForm.name.trim()) {
      setToast({ message: "Please enter a group name.", tone: "error" });
      return;
    }
    if (createGroupForm.memberIds.length === 0) {
      setToast({ message: "Please select at least one member.", tone: "error" });
      return;
    }

    setIsCreatingGroup(true);
    try {
      // Generate a random AES-256 group key
      const groupKeyBase64 = await generateGroupKey();
      console.log("[DEBUG] handleCreateGroup: Generated group key");

      // Get public keys for all selected members + self
      const memberIds = [...createGroupForm.memberIds, user.id];
      console.log("[DEBUG] handleCreateGroup: Member IDs =", memberIds);

      const membersWithKeys = await Promise.all(
        memberIds.map(async (memberId) => {
          const response = await api.getPublicKey(token, memberId);
          // Backend returns { user: {...}, key: { publicKey: "..." } }
          const publicKey = response.key?.publicKey;
          console.log(`[DEBUG] handleCreateGroup: Got public key for member ${memberId}:`, publicKey ? "present" : "missing");
          return { id: memberId, publicKey };
        })
      );

      // Encrypt the group key for each member
      const encryptedKeys = await encryptGroupKeyForMembers(groupKeyBase64, membersWithKeys);
      console.log("[DEBUG] handleCreateGroup: Encrypted keys for members:", Object.keys(encryptedKeys));

      // Create the group
      const response = await api.createGroup(
        token,
        createGroupForm.name.trim(),
        createGroupForm.memberIds, // Don't include self, backend adds creator automatically
        encryptedKeys,
        createGroupForm.profilePic // Pass profile picture (base64 or null)
      );

      // Store the decrypted group key locally (both ref and state)
      groupKeysRef.current[response.group.groupChatID] = groupKeyBase64;
      setGroupKeys((prev) => ({
        ...prev,
        [response.group.groupChatID]: groupKeyBase64,
      }));

      // Add to groups list
      setGroups((prev) => [response.group, ...prev]);

      // Close modal and reset form
      setIsCreateGroupModalOpen(false);
      setCreateGroupForm({ name: "", memberIds: [], profilePic: null });
      setToast({ message: `✓ Group "${response.group.groupName}" created!`, tone: "success" });

      // Select the new group
      setSelectedId(null);
      setSelectedGroupId(response.group.groupChatID);
    } catch (error) {
      console.error("Failed to create group:", error);
      setToast({ message: `Failed to create group: ${error.message}`, tone: "error" });
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const loadGroupMessages = async (groupId) => {
    try {
      const response = await api.getGroupMessages(token, groupId);
      setMessages(response.messages ?? []);
    } catch (error) {
      setToast({ message: `Failed to load messages: ${error.message}`, tone: "error" });
    }
  };

  const loadGroupKey = async (groupId, forceRefresh = false) => {
    // Check if we already have the key (use ref for synchronous access)
    const existingKey = groupKeysRef.current[groupId];
    if (existingKey && !forceRefresh) {
      return existingKey;
    }

    try {
      const response = await api.getGroupKey(token, groupId);
      console.log("loadGroupKey API response:", { groupId, encryptedGroupKey: response.encryptedGroupKey ? "present" : "missing", privateKeyAvailable: !!privateKey });

      if (!response.encryptedGroupKey) {
        console.error("No encrypted group key returned from API for group", groupId);
        return null;
      }

      if (!privateKey) {
        console.error("Private key not available for decrypting group key");
        return null;
      }

      const decryptedKey = await decryptGroupKey(response.encryptedGroupKey, privateKey);
      // Update both state and ref
      groupKeysRef.current[groupId] = decryptedKey;
      setGroupKeys((prev) => ({ ...prev, [groupId]: decryptedKey }));
      return decryptedKey;
    } catch (error) {
      console.error("Failed to load group key:", error);
    }
    return null;
  };

  const handleSendGroupMessage = async () => {
    if (!messageDraft.trim() || !selectedGroupId) return;

    setIsSending(true);
    try {
      // Always try to load the group key (loadGroupKey checks cache first)
      const groupKey = await loadGroupKey(selectedGroupId);
      if (!groupKey) {
        throw new Error("Unable to load group encryption key");
      }

      // Encrypt the message with the group key
      const { encryptedContent, iv, hmac } = await encryptGroupMessage(messageDraft, groupKey);

      // Send via API
      const response = await api.sendGroupMessage(
        token,
        selectedGroupId,
        encryptedContent,
        iv,
        hmac,
        replyingTo?.id || null
      );

      // Add message to local list (backend returns message in "data" field)
      const newMessage = response.data;
      setMessages((prev) => [...prev, newMessage]);

      // Store decrypted content
      setDecryptedMessages((prev) => ({
        ...prev,
        [newMessage.id]: messageDraft,
      }));

      // Update group's lastMessage in the sidebar
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === selectedGroupId ? { ...g, lastMessage: newMessage } : g
        )
      );

      setMessageDraft("");
      setReplyingTo(null);
    } catch (error) {
      setToast({ message: `Failed to send message: ${error.message}`, tone: "error" });
    } finally {
      setIsSending(false);
    }
  };

  const handleEditGroupMessage = async (messageId) => {
    if (!editContent.trim() || !selectedGroupId) return;

    setIsEditing(true);
    try {
      // Always try to load the group key (loadGroupKey checks cache first)
      const groupKey = await loadGroupKey(selectedGroupId);
      if (!groupKey) {
        throw new Error("Unable to load group encryption key");
      }

      const { encryptedContent, iv, hmac } = await encryptGroupMessage(editContent, groupKey);

      await api.editGroupMessage(token, selectedGroupId, messageId, encryptedContent, iv, hmac);

      // Update local message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, isEdited: true } : msg
        )
      );
      setDecryptedMessages((prev) => ({
        ...prev,
        [messageId]: editContent,
      }));

      setEditingMessageId(null);
      setEditContent("");
    } catch (error) {
      setToast({ message: `Failed to edit message: ${error.message}`, tone: "error" });
    } finally {
      setIsEditing(false);
    }
  };

  const handleUnsendGroupMessage = async (messageId) => {
    if (!selectedGroupId) return;

    try {
      const response = await api.unsendGroupMessage(token, selectedGroupId, messageId);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, isUnsent: true, unsentAt: new Date().toISOString() } : msg
        )
      );

      // Update the group's lastMessage with the new one from backend
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === selectedGroupId
            ? { ...g, lastMessage: response.newLastMessage }
            : g
        )
      );
    } catch (error) {
      setToast({ message: `Failed to unsend message: ${error.message}`, tone: "error" });
    }
  };

  const handleDeleteGroupMessage = async (messageId) => {
    if (!selectedGroupId) return;

    try {
      const response = await api.deleteGroupMessage(token, selectedGroupId, messageId);
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));

      // Update the group's lastMessage with the new one from backend
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === selectedGroupId
            ? { ...g, lastMessage: response.newLastMessage }
            : g
        )
      );
    } catch (error) {
      setToast({ message: `Failed to delete message: ${error.message}`, tone: "error" });
    }
  };

  const handleSaveGroupMessage = async (messageId, currentlySaved) => {
    if (!selectedGroupId) return;

    try {
      await api.saveGroupMessage(token, selectedGroupId, messageId, !currentlySaved);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, saved: !currentlySaved } : msg
        )
      );
      setToast({
        message: currentlySaved ? "Message unsaved." : "Message saved!",
        tone: "success",
      });
    } catch (error) {
      setToast({ message: `Failed to save message: ${error.message}`, tone: "error" });
    }
  };

  const handleGroupMenuClick = (e, groupId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const dropdownWidth = 170;
    const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

    // In stacked view, always position on the left side of the button
    // In normal view, always position on the right side
    const x = isStackedView
      ? rect.left - dropdownWidth - 12
      : rect.right + 12;

    setGroupMenuPosition({
      x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
      y: rect.top + rect.height / 2,
    });
    groupMenuButtonRef.current = e.currentTarget; // Store button reference for repositioning on resize
    setGroupMenuOpen(groupMenuOpen === groupId ? null : groupId);
  };

  const handleLeaveGroup = async (groupId) => {
    setGroupMenuOpen(null);
    try {
      await api.leaveGroup(token, groupId, user.id);

      // Remove group from list
      setGroups((prev) => prev.filter((g) => g.groupChatID !== groupId));

      // Clear chat if this was selected
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null);
        setMessages([]);
      }

      // Clean up group key
      delete groupKeysRef.current[groupId];
      setGroupKeys((prev) => {
        const newKeys = { ...prev };
        delete newKeys[groupId];
        return newKeys;
      });

      setToast({ message: "You left the group.", tone: "success" });
    } catch (error) {
      setToast({ message: `Failed to leave group: ${error.message}`, tone: "error" });
    }
  };

  const handleDeleteGroup = async (groupId) => {
    setGroupMenuOpen(null);
    try {
      await api.deleteGroup(token, groupId);

      // Remove group from list
      setGroups((prev) => prev.filter((g) => g.groupChatID !== groupId));

      // Clear chat if this was selected
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null);
        setMessages([]);
      }

      // Clean up group key
      delete groupKeysRef.current[groupId];
      setGroupKeys((prev) => {
        const newKeys = { ...prev };
        delete newKeys[groupId];
        return newKeys;
      });

      setToast({ message: "Group deleted.", tone: "success" });
    } catch (error) {
      setToast({ message: `Failed to delete group: ${error.message}`, tone: "error" });
    }
  };

  const handleEditGroupPicture = async () => {
    if (!editGroupPicForm.groupId) return;

    try {
      await api.updateGroup(token, editGroupPicForm.groupId, {
        profilePicUrl: editGroupPicForm.profilePic,
      });

      // Update local state
      setGroups((prev) =>
        prev.map((g) =>
          g.groupChatID === editGroupPicForm.groupId
            ? { ...g, profilePicUrl: editGroupPicForm.profilePic }
            : g
        )
      );

      setToast({ message: "✓ Group picture updated.", tone: "success" });
      setIsEditGroupPicModalOpen(false);
      setEditGroupPicForm({ groupId: null, profilePic: null, groupName: null });
    } catch (error) {
      setToast({ message: `Failed to update group picture: ${error.message}`, tone: "error" });
    }
  };

  const handleAddMember = async () => {
    if (!addMemberForm.groupId || addMemberForm.selectedFriends.length === 0) {
      setToast({ message: "Please select at least one friend to add.", tone: "error" });
      return;
    }

    try {
      // Get the current group key
      let groupKey = groupKeysRef.current[addMemberForm.groupId];
      if (!groupKey) {
        // Load from API if not in cache
        const response = await api.getGroupKey(token, addMemberForm.groupId);
        groupKey = await decryptGroupKey(response.encryptedGroupKey);
        groupKeysRef.current[addMemberForm.groupId] = groupKey;
        setGroupKeys((prev) => ({ ...prev, [addMemberForm.groupId]: groupKey }));
      }

      // Get public keys for new members
      const membersWithKeys = await Promise.all(
        addMemberForm.selectedFriends.map(async (memberId) => {
          // Check cache first
          if (publicKeyCache.current[memberId]) {
            return { id: memberId, publicKey: publicKeyCache.current[memberId] };
          }
          const response = await api.getPublicKey(token, memberId);
          const publicKey = response.key?.publicKey;
          if (publicKey) {
            publicKeyCache.current[memberId] = publicKey;
          }
          return { id: memberId, publicKey };
        })
      );

      // Encrypt the group key for each new member
      const encryptedKeys = await encryptGroupKeyForMembers(groupKey, membersWithKeys);

      // Add members via API
      await api.addGroupMembers(token, addMemberForm.groupId, addMemberForm.selectedFriends, encryptedKeys);

      // Update local group state with new members
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupChatID === addMemberForm.groupId) {
            // Add new member IDs to the group's members list
            const newMembers = addMemberForm.selectedFriends.map((id) => ({
              userID: id,
              role: "Member",
            }));
            return { ...g, members: [...g.members, ...newMembers] };
          }
          return g;
        })
      );

      setToast({ message: `✓ Added ${addMemberForm.selectedFriends.length} member(s).`, tone: "success" });
      setIsAddMemberModalOpen(false);
      setAddMemberForm({ groupId: null, selectedFriends: [] });
    } catch (error) {
      setToast({ message: `Failed to add members: ${error.message}`, tone: "error" });
    }
  };

  const handleRemoveMember = async () => {
    if (!removeMemberForm.groupId || !removeMemberForm.selectedMember) {
      setToast({ message: "Please select a member to remove.", tone: "error" });
      return;
    }

    try {
      // Remove member via API
      await api.removeGroupMember(token, removeMemberForm.groupId, removeMemberForm.selectedMember);

      // Update local group state
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupChatID === removeMemberForm.groupId) {
            return {
              ...g,
              members: g.members.filter((m) => m.userID !== removeMemberForm.selectedMember),
            };
          }
          return g;
        })
      );

      setToast({ message: "✓ Member removed.", tone: "success" });
      setIsRemoveMemberModalOpen(false);
      setRemoveMemberForm({ groupId: null, selectedMember: null });
    } catch (error) {
      setToast({ message: `Failed to remove member: ${error.message}`, tone: "error" });
    }
  };

  const rotateGroupKey = async (groupId, memberIds) => {
    try {
      // Generate new group key
      const newGroupKeyBase64 = await generateGroupKey();

      // Get public keys for all remaining members
      const memberPublicKeys = await Promise.all(
        memberIds.map(async (memberId) => {
          // Check cache first
          if (publicKeyCache.current[memberId]) {
            return { id: memberId, publicKey: publicKeyCache.current[memberId] };
          }
          try {
            const response = await api.getPublicKey(token, memberId);
            const publicKey = response.key?.publicKey;
            if (publicKey) {
              publicKeyCache.current[memberId] = publicKey;
            }
            return { id: memberId, publicKey };
          } catch {
            return { id: memberId, publicKey: null };
          }
        })
      );

      // Filter out members without public keys
      const validMembers = memberPublicKeys.filter((m) => m.publicKey);

      if (validMembers.length === 0) {
        console.error("No valid public keys for key rotation");
        return false;
      }

      // Encrypt the new group key for each member
      const encryptedKeys = await encryptGroupKeyForMembers(
        newGroupKeyBase64,
        validMembers.map((m) => ({ userId: m.id, publicKeyPem: m.publicKey }))
      );

      // Call the rotate key API
      await api.rotateGroupKey(token, groupId, encryptedKeys);

      // Store the new key locally
      groupKeysRef.current[groupId] = newGroupKeyBase64;
      setGroupKeys((prev) => ({ ...prev, [groupId]: newGroupKeyBase64 }));

      console.log(`Group key rotated for group ${groupId}`);
      return true;
    } catch (error) {
      console.error("Failed to rotate group key:", error);
      return false;
    }
  };

  const handleProfilePicClick = () => {
    profilePicInputRef.current?.click();
  };

  const handleProfilePicChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setToast({ message: "Invalid file type. Please use JPG, PNG, GIF, or WebP.", tone: "error" });
      return;
    }

    // Validate file size (500KB)
    if (file.size > 500 * 1024) {
      setToast({ message: "Image too large. Maximum size is 500KB.", tone: "error" });
      return;
    }

    setIsUploadingProfilePic(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageData = e.target.result;

        try {
          const response = await api.uploadProfilePicture(token, imageData);
          updateUser(response.user);
          setToast({ message: "✓ Profile picture updated!", tone: "success" });
        } catch (error) {
          setToast({ message: error.message, tone: "error" });
        } finally {
          setIsUploadingProfilePic(false);
          // Reset input so same file can be selected again
          event.target.value = "";
        }
      };
      reader.onerror = () => {
        setToast({ message: "Failed to read image file.", tone: "error" });
        setIsUploadingProfilePic(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setToast({ message: "Failed to upload profile picture.", tone: "error" });
      setIsUploadingProfilePic(false);
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
            className="ghost-button inline"
            onClick={() => handleCancelRequest(friendSearchResult.user.id)}
          >
            Cancel Request
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
              // Revert theme to original on cancel
              document.documentElement.setAttribute('data-theme', originalTheme);
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
                onClick={() => {
                  // Revert theme to original on close
                  document.documentElement.setAttribute('data-theme', originalTheme);
                  setIsSettingsOpen(false);
                }}
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
                  onClick={() => {
                    // Revert theme to original on cancel
                    document.documentElement.setAttribute('data-theme', originalTheme);
                    setIsSettingsOpen(false);
                  }}
                  disabled={isSavingSettings}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ghost-button inline danger"
                  onClick={() => {
                    setTheme('dark'); // keep branded login theme on logout
                    logout();
                  }}
                  disabled={isSavingSettings}
                >
                  Log out
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
                    const isGroupMessage = backup.isGroupMessage;
                    const senderName = backup.sender?.username || "Unknown";

                    // Format the header based on message type
                    let headerText;
                    if (isGroupMessage) {
                      headerText = `${isOwn ? "You" : senderName} in ${backup.groupName || "Group"}`;
                    } else {
                      const otherUsername = isOwn
                        ? (backup.receiver?.username || "Unknown")
                        : senderName;
                      headerText = isOwn ? `You → ${otherUsername}` : `${otherUsername} → You`;
                    }

                    const backupTimestamp = backup.sentAt || backup.timestamp;
                    const content = backup.decryptedContent || "";
                    const isLongMessage = content.length > 200;
                    const isExpanded = expandedBackups.has(backup.id);
                    const displayContent = isLongMessage && !isExpanded
                      ? content.substring(0, 200) + "..."
                      : content;

                    return (
                      <div
                        key={backup.id}
                        style={{
                          background: "var(--panel-soft)",
                          borderRadius: "16px",
                          display: "flex",
                          overflow: "hidden",
                        }}
                      >
                        {/* Left side - Content */}
                        <div
                          style={{
                            flex: 1,
                            padding: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            minWidth: 0,
                          }}
                        >
                          <div>
                            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                              {isGroupMessage && (
                                <span style={{ marginRight: "6px", fontSize: "0.75rem", background: "var(--accent-soft)", padding: "2px 6px", borderRadius: "4px" }}>
                                  Group
                                </span>
                              )}
                              {headerText}
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              {formatTime(backupTimestamp)}
                            </p>
                          </div>
                          <p style={{ margin: 0, wordBreak: "break-word", color: "var(--text-primary)" }}>
                            {displayContent}
                          </p>
                          {isLongMessage && (
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedBackups((prev) => {
                                  const newSet = new Set(prev);
                                  if (isExpanded) {
                                    newSet.delete(backup.id);
                                  } else {
                                    newSet.add(backup.id);
                                  }
                                  return newSet;
                                });
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                fontSize: "0.75rem",
                                padding: "4px 0",
                                textAlign: "left",
                                fontWeight: 400,
                              }}
                            >
                              {isExpanded ? "hide..." : "see more..."}
                            </button>
                          )}
                        </div>

                        {/* Right side - Delete button */}
                        <button
                          type="button"
                          onClick={() => handleDeleteBackup(backup.id)}
                          style={{
                            width: "80px",
                            background: "transparent",
                            border: "none",
                            borderLeft: "1px solid var(--card-border)",
                            color: "#ff9898",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            transition: "background 0.2s ease",
                          }}
                          onMouseEnter={(e) => (e.target.style.background = "rgba(255, 152, 152, 0.1)")}
                          onMouseLeave={(e) => (e.target.style.background = "transparent")}
                        >
                          Delete
                        </button>
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
      {isCreateGroupModalOpen && (
        <div className="settings-overlay" onClick={() => setIsCreateGroupModalOpen(false)}>
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Create Group</h2>
                <p>Start a new group conversation with your friends.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsCreateGroupModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div style={{ padding: "20px 0", maxHeight: "60vh", overflowY: "auto" }}>
              {/* Group Profile Picture */}
              <div className="form-group" style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
                <input
                  ref={groupPicInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 500 * 1024) {
                      setToast({ message: "Image too large. Maximum size is 500KB.", tone: "error" });
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setCreateGroupForm((prev) => ({ ...prev, profilePic: event.target.result }));
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
                <div
                  onClick={() => groupPicInputRef.current?.click()}
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: createGroupForm.profilePic ? "transparent" : "#d3d3d3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                  title="Click to add group picture"
                >
                  {createGroupForm.profilePic ? (
                    <img src={createGroupForm.profilePic} alt="Group" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: "1.8rem", color: "#555", fontWeight: 600 }}>
                      {createGroupForm.name.trim() ? createGroupForm.name.charAt(0).toUpperCase() : "+"}
                    </span>
                  )}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 500 }}>Group Picture</p>
                  <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Optional. Click to upload (max 500KB)
                  </p>
                  {createGroupForm.profilePic && (
                    <button
                      type="button"
                      onClick={() => setCreateGroupForm((prev) => ({ ...prev, profilePic: null }))}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#ff6b6b",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        padding: "4px 0",
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label htmlFor="groupName" style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>
                  Group Name
                </label>
                <input
                  type="text"
                  id="groupName"
                  className="input-box"
                  placeholder="Enter group name..."
                  value={createGroupForm.name}
                  onChange={(e) => {
                    // Only allow alphanumeric characters and basic punctuation
                    const value = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                    setCreateGroupForm((prev) => ({ ...prev, name: value }));
                  }}
                  maxLength={8}
                  style={{ width: "100%" }}
                />
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {createGroupForm.name.length}/8 characters (letters, numbers, _ and - only)
                </p>
              </div>
              <div className="form-group">
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>
                  Select Members ({createGroupForm.memberIds.length}/31 selected)
                </label>
                <div
                  style={{
                    maxHeight: "200px",
                    overflowY: "auto",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    padding: "8px",
                  }}
                >
                  {friends.length === 0 ? (
                    <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                      No friends to add. Add some friends first!
                    </p>
                  ) : (
                    friends.map((friend) => {
                      const isSelected = createGroupForm.memberIds.includes(friend.id);
                      return (
                        <label
                          key={friend.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderRadius: "6px",
                            background: isSelected ? "var(--accent-soft)" : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setCreateGroupForm((prev) => {
                                const newIds = isSelected
                                  ? prev.memberIds.filter((id) => id !== friend.id)
                                  : [...prev.memberIds, friend.id];
                                return { ...prev, memberIds: newIds };
                              });
                            }}
                            disabled={!isSelected && createGroupForm.memberIds.length >= 31}
                          />
                          <div className="conversation-avatar" style={{ width: "32px", height: "32px", fontSize: "0.8rem" }}>
                            {friend.profilePicUrl ? (
                              <img src={friend.profilePicUrl} alt={friend.username} className="avatar-image" />
                            ) : (
                              friend.displayName?.charAt(0).toUpperCase() || friend.username?.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <span style={{ fontWeight: 500 }}>{friend.displayName || friend.username}</span>
                            {friend.displayName && (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "6px" }}>
                                @{friend.username}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost-button inline"
                onClick={() => {
                  setIsCreateGroupModalOpen(false);
                  setCreateGroupForm({ name: "", memberIds: [], profilePic: null });
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={isCreatingGroup || !createGroupForm.name.trim() || createGroupForm.memberIds.length === 0}
                style={{
                  background: createGroupForm.name.trim() && createGroupForm.memberIds.length > 0 ? "var(--accent)" : "#e0e0e0",
                  color: createGroupForm.name.trim() && createGroupForm.memberIds.length > 0 ? "var(--button-primary-text)" : "#999",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  cursor: isCreatingGroup || !createGroupForm.name.trim() || createGroupForm.memberIds.length === 0 ? "not-allowed" : "pointer",
                  opacity: isCreatingGroup || !createGroupForm.name.trim() || createGroupForm.memberIds.length === 0 ? 0.5 : 1,
                }}
              >
                {isCreatingGroup ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
      {isEditGroupPicModalOpen && (
        <div className="settings-overlay" onClick={() => setIsEditGroupPicModalOpen(false)}>
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "400px" }}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Edit Group Picture</h2>
                <p>Update the profile picture for this group.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsEditGroupPicModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div style={{ padding: "20px 0" }}>
              <input
                ref={editGroupPicInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500 * 1024) {
                    setToast({ message: "Image too large. Maximum size is 500KB.", tone: "error" });
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    setEditGroupPicForm((prev) => ({ ...prev, profilePic: event.target.result }));
                  };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div
                  onClick={() => editGroupPicInputRef.current?.click()}
                  style={{
                    width: "120px",
                    height: "120px",
                    borderRadius: "50%",
                    background: editGroupPicForm.profilePic ? "transparent" : "#d3d3d3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    overflow: "hidden",
                    border: "2px dashed var(--card-border)",
                  }}
                  title="Click to change picture"
                >
                  {editGroupPicForm.profilePic ? (
                    <img src={editGroupPicForm.profilePic} alt="Group" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: "3rem", color: "#555", fontWeight: 600 }}>
                      {editGroupPicForm.groupName?.charAt(0).toUpperCase() || "+"}
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
                  Click to upload (max 500KB)
                </p>
                {editGroupPicForm.profilePic && (
                  <button
                    type="button"
                    onClick={() => setEditGroupPicForm((prev) => ({ ...prev, profilePic: null }))}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ff6b6b",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      padding: "4px 0",
                    }}
                  >
                    Remove Picture
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost-button inline"
                onClick={() => {
                  setIsEditGroupPicModalOpen(false);
                  setEditGroupPicForm({ groupId: null, profilePic: null, groupName: null });
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditGroupPicture}
                style={{
                  background: "#000000",
                  color: "var(--button-primary-text)",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      {isAddMemberModalOpen && (
        <div className="settings-overlay" onClick={() => setIsAddMemberModalOpen(false)}>
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Add Members</h2>
                <p>Select friends to add to this group.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsAddMemberModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div style={{ padding: "20px 0", maxHeight: "60vh", overflowY: "auto" }}>
              <div className="form-group">
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>
                  Select Friends ({addMemberForm.selectedFriends.length} selected)
                </label>
                <div
                  style={{
                    maxHeight: "300px",
                    overflowY: "auto",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    padding: "8px",
                  }}
                >
                  {(() => {
                    // Get current group
                    const currentGroup = groups.find((g) => g.groupChatID === addMemberForm.groupId);
                    if (!currentGroup) return <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>Group not found.</p>;

                    // Get list of current member IDs
                    const currentMemberIds = currentGroup.members.map((m) => m.userID);

                    // Filter friends who are NOT in the group
                    const availableFriends = friends.filter((friend) => !currentMemberIds.includes(friend.id));

                    if (availableFriends.length === 0) {
                      return <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>All your friends are already in this group!</p>;
                    }

                    return availableFriends.map((friend) => {
                      const isSelected = addMemberForm.selectedFriends.includes(friend.id);
                      return (
                        <label
                          key={friend.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderRadius: "6px",
                            background: isSelected
                              ? (theme === "dark" ? "rgba(76, 175, 80, 0.2)" : "var(--accent-soft)")
                              : "transparent",
                            border: isSelected
                              ? (theme === "dark" ? "1px solid #4CAF50" : "1px solid transparent")
                              : "1px solid transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setAddMemberForm((prev) => {
                                const newSelected = isSelected
                                  ? prev.selectedFriends.filter((id) => id !== friend.id)
                                  : [...prev.selectedFriends, friend.id];
                                return { ...prev, selectedFriends: newSelected };
                              });
                            }}
                          />
                          <div className="conversation-avatar" style={{ width: "32px", height: "32px", fontSize: "0.8rem" }}>
                            {friend.profilePicUrl ? (
                              <img src={friend.profilePicUrl} alt={friend.username} className="avatar-image" />
                            ) : (
                              friend.displayName?.charAt(0).toUpperCase() || friend.username?.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <span style={{ fontWeight: 500 }}>{friend.displayName || friend.username}</span>
                            {friend.displayName && (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "6px" }}>
                                @{friend.username}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost-button inline"
                onClick={() => {
                  setIsAddMemberModalOpen(false);
                  setAddMemberForm({ groupId: null, selectedFriends: [] });
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMember}
                disabled={addMemberForm.selectedFriends.length === 0}
                style={{
                  background: addMemberForm.selectedFriends.length > 0
                    ? (theme === "dark" ? "#4CAF50" : "#000000")
                    : (theme === "dark" ? "#555" : "var(--accent)"),
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: addMemberForm.selectedFriends.length === 0 ? "not-allowed" : "pointer",
                  opacity: addMemberForm.selectedFriends.length === 0 ? 0.5 : 1,
                }}
              >
                Add Members
              </button>
            </div>
          </div>
        </div>
      )}
      {isRemoveMemberModalOpen && (
        <div className="settings-overlay" onClick={() => setIsRemoveMemberModalOpen(false)}>
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "450px" }}
          >
            <header className="settings-modal-header">
              <div>
                <h2>Remove Member</h2>
                <p>Select a member to remove from this group.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsRemoveMemberModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div style={{ padding: "20px 0", maxHeight: "60vh", overflowY: "auto" }}>
              <div className="form-group">
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}>
                  Select Member to Remove
                </label>
                <div
                  style={{
                    maxHeight: "300px",
                    overflowY: "auto",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    padding: "8px",
                  }}
                >
                  {(() => {
                    // Get current group
                    const currentGroup = groups.find((g) => g.groupChatID === removeMemberForm.groupId);
                    if (!currentGroup) return <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>Group not found.</p>;

                    // Filter out the owner (can't remove owner)
                    const removableMembers = currentGroup.members.filter((m) => m.role !== "Owner");

                    if (removableMembers.length === 0) {
                      return <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>No members to remove.</p>;
                    }

                    return removableMembers.map((member) => {
                      const isSelected = removeMemberForm.selectedMember === member.userID;
                      // Find friend info for this member
                      const friendInfo = friends.find((f) => f.id === member.userID);
                      const displayName = friendInfo?.displayName || friendInfo?.username || `User ${member.userID}`;
                      const username = friendInfo?.username;
                      const profilePicUrl = friendInfo?.profilePicUrl;

                      return (
                        <label
                          key={member.userID}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderRadius: "6px",
                            background: isSelected
                              ? (theme === "dark" ? "rgba(244, 67, 54, 0.2)" : "#fff1f1")
                              : "transparent",
                            border: isSelected
                              ? (theme === "dark" ? "1px solid #f44336" : "1px solid #ffcccb")
                              : "1px solid transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setRemoveMemberForm((prev) => ({
                                ...prev,
                                selectedMember: isSelected ? null : member.userID,
                              }));
                            }}
                          />
                          <div className="conversation-avatar" style={{ width: "32px", height: "32px", fontSize: "0.8rem" }}>
                            {profilePicUrl ? (
                              <img src={profilePicUrl} alt={displayName} className="avatar-image" />
                            ) : (
                              displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <span style={{ fontWeight: 500 }}>{displayName}</span>
                            {username && displayName !== username && (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "6px" }}>
                                @{username}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost-button inline"
                onClick={() => {
                  setIsRemoveMemberModalOpen(false);
                  setRemoveMemberForm({ groupId: null, selectedMember: null });
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveMember}
                disabled={!removeMemberForm.selectedMember}
                style={{
                  background: "#d32f2f",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: !removeMemberForm.selectedMember ? "not-allowed" : "pointer",
                  opacity: !removeMemberForm.selectedMember ? 0.5 : 1,
                }}
              >
                Remove Member
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="chat-layout">
        <aside className="sidebar sidebar-rail">
          <div className="sidebar-profile">
            <input
              ref={profilePicInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={handleProfilePicChange}
            />
            <div
              className="avatar"
              onClick={handleProfilePicClick}
              style={{ opacity: isUploadingProfilePic ? 0.5 : 1, cursor: isUploadingProfilePic ? "wait" : "pointer" }}
              title="Click to change profile picture"
            >
              {user.profilePicUrl ? (
                <img src={user.profilePicUrl} alt="Profile" className="avatar-image" />
              ) : (
                user.displayName?.charAt(0).toUpperCase()
              )}
              <div className="avatar-edit-overlay"></div>
            </div>
            <div className="sidebar-profile-copy">
              <h2 title={user.displayName || user.username}>
                {user.displayName || user.username}
              </h2>
              <p title={`@${user.username}`}>
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
              setOriginalTheme(theme); // Store current theme for cancel
              setIsSettingsOpen(true);
            }}
          >
            <span aria-hidden>⚙️</span>
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="sidebar-mini-logout"
            onClick={() => {
              // Reset theme to dark mode on logout (branded login page)
              setTheme('dark');
              logout();
            }}
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
                      {friendSearchResult.user.profilePicUrl ? (
                        <img src={friendSearchResult.user.profilePicUrl} alt="Profile" className="avatar-image" />
                      ) : (
                        friendSearchResult.user.username.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="search-card-info">
                      <p className="search-card-name" title={friendSearchResult.user.displayName || friendSearchResult.user.username}>
                        {friendSearchResult.user.displayName || friendSearchResult.user.username}
                      </p>
                      <p className="search-card-username" title={`@${friendSearchResult.user.username}`}>@{friendSearchResult.user.username}</p>
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
                            <div
                              style={{
                                marginBottom: "8px",
                                fontWeight: "500",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap"
                              }}
                              title={request.user.username}
                            >
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
                                {friend.profilePicUrl ? (
                                  <img src={friend.profilePicUrl} alt="Profile" className="avatar-image" />
                                ) : (
                                  friend.username.charAt(0).toUpperCase()
                                )}
                              </span>
                              <span className="nav-label" title={friend.username}>
                                {friend.username}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const dropdownWidth = 170;
                                const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

                                // In stacked view, always position on the left side of the button
                                // In normal view, always position on the right side
                                const x = isStackedView
                                  ? rect.left - dropdownWidth - 12
                                  : rect.right + 12;

                                setFriendMenuPosition({
                                  x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
                                  y: rect.top + rect.height / 2,
                                });
                                friendMenuButtonRef.current = e.currentTarget; // Store button reference for repositioning on resize
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
                              gap: "8px",
                            }}
                          >
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                                minWidth: 0,
                              }}
                              title={request.user.username}
                            >
                              {request.user.username}
                            </span>
                            <span style={{ fontSize: "11px", flexShrink: 0 }}>⏳ Pending</span>
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
                                {blocked.profilePicUrl ? (
                                  <img src={blocked.profilePicUrl} alt="Profile" className="avatar-image" />
                                ) : (
                                  blocked.username?.charAt(0).toUpperCase()
                                )}
                              </span>
                              <div style={{ minWidth: 0, overflow: "hidden", flex: 1 }}>
                                <div className="blocked-entry-name" title={blocked.displayName || blocked.username}>
                                  {blocked.displayName || blocked.username}
                                </div>
                                <div className="blocked-entry-username" title={`@${blocked.username}`}>@{blocked.username}</div>
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
            <header className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h1>Chats</h1>
              <button
                type="button"
                onClick={() => {
                  setCreateGroupForm({ name: "", memberIds: [] });
                  setIsCreateGroupModalOpen(true);
                }}
                style={{
                  background: "var(--accent)",
                  color: "var(--button-primary-text)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
                title="Create Group"
              >
                + Group
              </button>
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
                  ? (lastMsg.isUnsent
                    ? "Message was unsent"
                    : (decryptedMessages[lastMsg.id] || lastMsg.content || "Encrypted message"))
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
                        onClick={() => {
                          setSelectedGroupId(null);
                          setSelectedId(conversation.id);
                        }}
                        style={{ paddingRight: "40px" }}
                      >
                        <div className="conversation-avatar">
                          {conversation.profilePicUrl ? (
                            <img src={conversation.profilePicUrl} alt="Profile" className="avatar-image" />
                          ) : (
                            conversation.name?.charAt(0).toUpperCase()
                          )}
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
                          const dropdownWidth = 170;
                          const isStackedView = window.innerWidth < 900; // Stacked layout breakpoint

                          // In stacked view, always position on the left side of the button
                          // In normal view, always position on the right side
                          const x = isStackedView
                            ? rect.left - dropdownWidth - 12
                            : rect.right + 12;

                          setConversationMenuPosition({
                            x: Math.max(12, Math.min(x, window.innerWidth - dropdownWidth - 12)),
                            y: rect.top + rect.height / 2,
                          });
                          conversationMenuButtonRef.current = e.currentTarget; // Store button reference for repositioning on resize
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

              {/* Groups Section */}
              {groups.length > 0 && (
                <>
                  <div style={{ padding: "12px 16px 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Groups
                  </div>
                  {groups.map((group) => {
                    const lastMsg = group.lastMessage;
                    const memberCount = group.members?.length || 0;
                    const preview = lastMsg
                      ? (lastMsg.isUnsent ? "Message was unsent" : (decryptedMessages[lastMsg.id] || "Encrypted message"))
                      : "No messages yet.";
                    const isOwner = group.members?.find(m => m.user?.id === user.id)?.role === "Owner";
                    // Sort members: owner first, then alphabetically
                    const sortedMembers = [...(group.members || [])].sort((a, b) => {
                      if (a.role === "Owner") return -1;
                      if (b.role === "Owner") return 1;
                      return (a.user?.username || "").localeCompare(b.user?.username || "");
                    });
                    return (
                      <div
                        key={`group-${group.groupChatID}`}
                        style={{ position: "relative", width: "100%" }}
                      >
                        <button
                          type="button"
                          className={`conversation-item ${selectedGroupId === group.groupChatID ? "active" : ""}`}
                          onClick={() => {
                            setSelectedId(null);
                            setSelectedGroupId(group.groupChatID);
                          }}
                          style={{ paddingRight: "40px" }}
                        >
                          <div className="conversation-avatar" style={{ background: group.profilePicUrl ? "transparent" : "#d3d3d3" }}>
                            {group.profilePicUrl ? (
                              <img src={group.profilePicUrl} alt="Group" className="avatar-image" />
                            ) : (
                              <span style={{ color: "#555", fontSize: "1.2rem", fontWeight: 600 }}>
                                {group.groupName?.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="conversation-copy">
                            <span className="conversation-name" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span title={group.groupName}>{group.groupName}</span>
                              <span
                                style={{
                                  fontSize: "0.65rem",
                                  color: "var(--text-muted)",
                                  fontWeight: "normal",
                                  cursor: "pointer",
                                  flexShrink: 0,
                                  marginLeft: "auto",
                                }}
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMemberTooltipPosition({ x: rect.left, y: rect.bottom + 4 });
                                  setHoveredGroupMembers(group.groupChatID);
                                }}
                                onMouseLeave={() => setHoveredGroupMembers(null)}
                              >
                                {memberCount} member{memberCount !== 1 ? "s" : ""}
                              </span>
                            </span>
                            <span className="conversation-preview">
                              {lastMsg ? (
                                lastMsg.isUnsent ? "Message was unsent" : (
                                  <>
                                    <span style={{ fontWeight: 500 }}>{lastMsg.sender?.username || "Unknown"}</span>: {decryptedMessages[lastMsg.id] || "Encrypted message"}
                                  </>
                                )
                              ) : "No messages yet."}
                            </span>
                          </div>
                        </button>
                        {/* Member tooltip */}
                        {hoveredGroupMembers === group.groupChatID && (
                          <div
                            style={{
                              position: "fixed",
                              left: `${memberTooltipPosition.x}px`,
                              top: `${memberTooltipPosition.y}px`,
                              backgroundColor: "#333",
                              color: "white",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              fontSize: "0.8rem",
                              zIndex: 5000,
                              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                              maxWidth: "200px",
                            }}
                            onMouseEnter={() => setHoveredGroupMembers(group.groupChatID)}
                            onMouseLeave={() => setHoveredGroupMembers(null)}
                          >
                            {sortedMembers.map((m) => (
                              <div key={m.user?.id} style={{ padding: "2px 0" }}>
                                {m.role === "Owner" ? (
                                  <span style={{ fontWeight: "bold" }}>
                                    {m.user?.username} 👑
                                  </span>
                                ) : (
                                  <span>{m.user?.username}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 3-dot menu button */}
                        <button
                          type="button"
                          onClick={(e) => handleGroupMenuClick(e, group.groupChatID)}
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
                        {/* Group menu dropdown */}
                        {groupMenuOpen === group.groupChatID && (
                          <div
                            style={{
                              position: "fixed",
                              left: `${groupMenuPosition.x}px`,
                              top: `${groupMenuPosition.y}px`,
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
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isOwner ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditGroupPicForm({ groupId: group.groupChatID, profilePic: group.profilePicUrl, groupName: group.groupName });
                                    setIsEditGroupPicModalOpen(true);
                                    setGroupMenuOpen(null);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    border: "none",
                                    background: "#f5f5f5",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "#333",
                                    borderRadius: "4px",
                                    fontWeight: 500,
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#e8e8e8")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
                                >
                                  Edit Profile Picture
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddMemberForm({ groupId: group.groupChatID, selectedFriends: [] });
                                    setIsAddMemberModalOpen(true);
                                    setGroupMenuOpen(null);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    border: "none",
                                    background: "#f5f5f5",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "#333",
                                    borderRadius: "4px",
                                    fontWeight: 500,
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#e8e8e8")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
                                >
                                  Add Member
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRemoveMemberForm({ groupId: group.groupChatID, selectedMember: null });
                                    setIsRemoveMemberModalOpen(true);
                                    setGroupMenuOpen(null);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    border: "none",
                                    background: "#f5f5f5",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "#333",
                                    borderRadius: "4px",
                                    fontWeight: 500,
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#e8e8e8")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
                                >
                                  Remove Member
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteGroup(group.groupChatID)}
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
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#ffe1e1")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff1f1")}
                                >
                                  Delete
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleLeaveGroup(group.groupChatID)}
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
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#ffe1e1")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff1f1")}
                              >
                                Leave
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>

          <section className="chat-panel">
            <header className="panel-header conversation">
              <h1
              style={(selectedConversation || selectedGroup) ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : {}}
              title={selectedGroup ? selectedGroup.groupName : (selectedConversation?.participants?.[0]?.displayName || selectedConversation?.name || "")}
            >
              {selectedGroup
                ? selectedGroup.groupName
                : (selectedConversation?.participants?.[0]?.displayName || selectedConversation?.name || "Select a conversation")}
            </h1>
            {selectedGroup && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "8px" }}>
                {selectedGroup.members?.length || 0} members
              </span>
            )}
            </header>
            <div className="message-list">
              {(selectedConversation || selectedGroup) ? (
                messages.length ? (
                  messages.map((message) => {
                  // Handle unsent messages
                  if (message.isUnsent) {
                    const senderName = message.senderUsername || message.sender?.username || "Someone";
                    return (
                      <article
                        key={message.id}
                        className="message-bubble unsent-placeholder"
                        style={{ opacity: 0.6, fontStyle: "italic" }}
                      >
                        <p className="bubble-text" style={{ color: "var(--text-muted)" }}>
                          {senderName} unsent a message
                        </p>
                        <time className="bubble-time">{formatTime(message.unsentAt || message.sentAt)}</time>
                      </article>
                    );
                  }

                  // Check if this message is being edited
                  const isEditingThis = editingMessageId === message.id;

                  // All messages are now decryptable (including our own sent messages!)
                  const displayContent = decryptedMessages[message.id] ||
                    (privateKey ? "Decrypting..." : message.content);

                  // Get status indicator for sent messages
                  const getStatusIndicator = (status, readBy, memberCount) => {
                    // For group messages, show read count with color coding
                    if (selectedGroup) {
                      const readCount = readBy?.length || 0;
                      const totalOthers = (memberCount || 0) - 1; // Exclude sender

                      if (totalOthers <= 0) {
                        return <span style={{ color: "var(--status-pending)" }}>Sent</span>;
                      }

                      if (readCount === 0) {
                        // No one has read - show "Delivered"
                        return <span style={{ color: "var(--status-pending)" }}>Delivered</span>;
                      }

                      if (readCount >= totalOthers) {
                        // All members have read - show in blue
                        return <span style={{ color: "#4a9eff" }}>Read {readCount}/{totalOthers}</span>;
                      }

                      // Partial reads - show count
                      return (
                        <span style={{ color: "var(--status-pending)" }}>
                          Read {readCount}/{totalOthers}
                        </span>
                      );
                    }
                    // For 1-1 messages
                    if (status === "Read") return <span style={{ color: "#4a9eff" }}>Read</span>;
                    if (status === "Delivered") return <span style={{ color: "var(--status-pending)" }}>Delivered</span>;
                    return <span style={{ color: "var(--status-pending)" }}>Sent</span>;
                  };

                  // Get reply preview if this message is a reply
                  const replyPreview = message.replyTo ? (
                    <div className="reply-preview-bubble" style={{
                      background: "rgba(255,255,255,0.05)",
                      borderLeft: "3px solid var(--text-muted)",
                      padding: "6px 10px",
                      marginBottom: "6px",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                    }}>
                      <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>
                        {message.replyTo.senderUsername || "Unknown"}
                      </span>
                      <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                        {message.replyTo.isUnsent
                          ? "Message was unsent"
                          : (decryptedMessages[message.replyTo.id] || "[Encrypted]").substring(0, 50)}
                      </p>
                    </div>
                  ) : null;

                  // Check if message sender is the group owner
                  const senderIsOwner = selectedGroup && selectedGroup.members?.find(
                    (m) => m.user?.id === message.sender?.id
                  )?.role === "Owner";

                  return (
                      <article
                        key={message.id}
                        className={`message-bubble ${message.isOwn ? "own" : "their"} ${message.saved ? "saved" : ""}`}
                        onContextMenu={(e) => handleMessageContextMenu(e, message)}
                      >
                        {replyPreview}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className="bubble-meta" title={message.isOwn ? "You" : message.sender.username}>
                            {message.isOwn ? "You" : message.sender.username}
                            {senderIsOwner && (
                              <span style={{ marginLeft: "4px", fontSize: "0.85em" }} title="Group Owner">👑</span>
                            )}
                          </span>
                          <button
                            type="button"
                            className="save-message-btn"
                            onClick={() => selectedGroup
                              ? handleSaveGroupMessage(message.id, message.saved)
                              : handleSaveMessage(message.id, message.saved)
                            }
                            title={message.saved ? "Unsave message" : "Save message"}
                            aria-label={message.saved ? "Unsave message" : "Save message"}
                          >
                            {message.saved ? "★" : "☆"}
                          </button>
                        </div>
                        {isEditingThis ? (
                          <div className="edit-mode">
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="edit-textarea"
                              maxLength={2000}
                              autoFocus
                              style={{
                                width: "100%",
                                minHeight: "60px",
                                padding: "8px",
                                borderRadius: "8px",
                                border: "1px solid var(--card-border)",
                                background: "var(--input-bg)",
                                color: "var(--input-color)",
                                resize: "vertical",
                                fontFamily: "inherit",
                                fontSize: "inherit",
                              }}
                            />
                            <div style={{ display: "flex", gap: "8px", marginTop: "6px", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                disabled={isEditing}
                                style={{
                                  fontSize: "0.75rem",
                                  padding: "4px 10px",
                                  background: "transparent",
                                  border: "1px solid var(--card-border)",
                                  borderRadius: "6px",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => selectedGroup
                                  ? handleEditGroupMessage(message.id)
                                  : handleSaveEdit()
                                }
                                disabled={isEditing || !editContent.trim()}
                                style={{
                                  fontSize: "0.75rem",
                                  padding: "4px 10px",
                                  background: "var(--accent)",
                                  border: "none",
                                  borderRadius: "6px",
                                  color: "var(--button-primary-text)",
                                  cursor: "pointer",
                                }}
                              >
                                {isEditing ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="bubble-text">{displayContent}</p>
                        )}
                        <time className="bubble-time">
                          {message.editedAt && (
                            <span style={{ marginRight: "6px", fontStyle: "italic" }}>(edited)</span>
                          )}
                          {message.isOwn && (
                            <>
                              {getStatusIndicator(message.status, message.readBy, selectedGroup?.members?.length)}
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

            {/* Context Menu */}
            {contextMenu && (
              <div
                className="context-menu"
                style={{
                  position: "fixed",
                  left: contextMenu.x,
                  top: contextMenu.y,
                  background: "var(--panel-dark)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "8px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                  zIndex: 5000,
                  minWidth: "120px",
                  padding: "4px",
                }}
              >
                <button
                  type="button"
                  onClick={() => handleStartReply(contextMenu.message)}
                  className="context-menu-item"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    borderRadius: "4px",
                  }}
                  onMouseEnter={(e) => e.target.style.background = "var(--panel-soft)"}
                  onMouseLeave={(e) => e.target.style.background = "transparent"}
                >
                  Reply
                </button>
                {contextMenu.isOwn && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(contextMenu.message)}
                      className="context-menu-item"
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        borderRadius: "4px",
                      }}
                      onMouseEnter={(e) => e.target.style.background = "var(--panel-soft)"}
                      onMouseLeave={(e) => e.target.style.background = "transparent"}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedGroup
                        ? handleUnsendGroupMessage(contextMenu.messageId)
                        : handleUnsendMessage(contextMenu.messageId)
                      }
                      className="context-menu-item"
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#ff9898",
                        borderRadius: "4px",
                      }}
                      onMouseEnter={(e) => e.target.style.background = "var(--panel-soft)"}
                      onMouseLeave={(e) => e.target.style.background = "transparent"}
                    >
                      Unsend
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Reply Preview */}
            {replyingTo && (
              <div
                className="reply-preview-composer"
                style={{
                  background: "var(--panel-soft)",
                  borderLeft: "3px solid var(--accent)",
                  padding: "8px 12px",
                  margin: "0 16px 8px",
                  borderRadius: "6px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Replying to <strong>{replyingTo.senderUsername}</strong>
                  </span>
                  <p style={{
                    margin: "2px 0 0",
                    fontSize: "0.8rem",
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {replyingTo.content}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancelReply}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "1.2rem",
                    padding: "0 4px",
                  }}
                  title="Cancel reply"
                >
                  ×
                </button>
              </div>
            )}

            <form className="composer" onSubmit={(e) => {
              e.preventDefault();
              if (selectedGroup) {
                handleSendGroupMessage();
              } else {
                handleSendMessage(e);
              }
            }}>
              <textarea
                className="composer-input"
                placeholder="Type Your Message..."
                value={messageDraft}
                disabled={!selectedConversation && !selectedGroup}
                onChange={(event) => setMessageDraft(event.target.value)}
                maxLength={2000}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (selectedGroup) {
                    handleSendGroupMessage();
                  } else {
                    handleSendMessage(event);
                  }
                }
              }}
            />
              <button
                className="composer-send"
                type="submit"
                disabled={(!selectedConversation && !selectedGroup) || isSending || !messageDraft.trim()}
              >
                {isSending ? "…" : "➤"}
              </button>
            </form>
          {(selectedConversation || selectedGroup) && (
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
