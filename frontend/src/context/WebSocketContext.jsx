import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";

const WebSocketContext = createContext(null);

const RELAY_SERVER_URL = "http://localhost:5001";

// Helper function to redact sensitive information from logs
const redactSensitiveData = (obj) => {
  if (!obj) return obj;

  const redacted = { ...obj };

  // Redact user info in sender/receiver objects
  if (redacted.sender) {
    redacted.sender = {
      ...redacted.sender,
      username: redacted.sender.username ? "xxxxx" : undefined,
      email: redacted.sender.email ? "xxxxx@xxxxx.xxx" : undefined,
      displayName: redacted.sender.displayName ? "xxxxx" : undefined,
      profilePicUrl: redacted.sender.profilePicUrl ? "[REDACTED]" : undefined,
    };
  }

  if (redacted.receiver) {
    redacted.receiver = {
      ...redacted.receiver,
      username: redacted.receiver.username ? "xxxxx" : undefined,
      email: redacted.receiver.email ? "xxxxx@xxxxx.xxx" : undefined,
      displayName: redacted.receiver.displayName ? "xxxxx" : undefined,
      profilePicUrl: redacted.receiver.profilePicUrl ? "[REDACTED]" : undefined,
    };
  }

  return redacted;
};

export function WebSocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const messageHandlersRef = useRef([]);
  const friendRequestHandlersRef = useRef([]);
  const friendAcceptHandlersRef = useRef([]);
  const friendDeleteHandlersRef = useRef([]);
  const friendRejectHandlersRef = useRef([]);
  const friendCancelHandlersRef = useRef([]);
  const blockedHandlersRef = useRef([]);
  const unblockedHandlersRef = useRef([]);
  const messageStatusHandlersRef = useRef([]);
  const messageDeletedHandlersRef = useRef([]);
  const messageEditedHandlersRef = useRef([]);
  const messageUnsentHandlersRef = useRef([]);
  const messageSavedHandlersRef = useRef([]);
  // Group chat handlers
  const groupCreatedHandlersRef = useRef([]);
  const groupMessageHandlersRef = useRef([]);
  const groupMemberAddedHandlersRef = useRef([]);
  const groupMemberRemovedHandlersRef = useRef([]);
  const groupDeletedHandlersRef = useRef([]);
  const groupMessageEditedHandlersRef = useRef([]);
  const groupMessageUnsentHandlersRef = useRef([]);
  const groupMessageReadHandlersRef = useRef([]);
  const groupKeyRotatedHandlersRef = useRef([]);
  const groupMessageDeletedHandlersRef = useRef([]);
  const groupMessageSavedHandlersRef = useRef([]);
  const groupUpdatedHandlersRef = useRef([]);

  useEffect(() => {
    // Only connect if user is logged in
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Create socket connection
    const newSocket = io(RELAY_SERVER_URL, {
      transports: ["websocket", "polling"],
    });

    newSocket.on("connect", () => {
      console.log("[OK] Connected to WebSocket relay server");
      setIsConnected(true);
      // Authenticate with user ID
      newSocket.emit("authenticate", { userId: user.id });
    });

    newSocket.on("authenticated", (data) => {
      console.log("[OK] Authenticated as user", data.userId);
    });

    newSocket.on("disconnect", () => {
      console.log("✗ Disconnected from WebSocket relay server");
      setIsConnected(false);
    });

    // Listen for incoming messages
    newSocket.on("message_received", (data) => {
      console.log("📨 New message received:", redactSensitiveData(data.message));
      messageHandlersRef.current.forEach((handler) => handler(data.message));
    });

    // Listen for friend requests
    newSocket.on("friend_request_received", (data) => {
      console.log("👥 Friend request received:", data.request);
      friendRequestHandlersRef.current.forEach((handler) => handler(data.request));
    });

    // Listen for friend request acceptances
    newSocket.on("friend_request_accepted_event", (data) => {
      console.log("Friend request accepted event received:", data);
      if (data && data.friend) {
        console.log(`   Friend data:`, data.friend);
        friendAcceptHandlersRef.current.forEach((handler) => handler(data.friend));
        console.log(`   Notified ${friendAcceptHandlersRef.current.length} handler(s)`);
      } else {
        console.warn("WARNING: Friend request accepted event received but no friend data:", data);
      }
    });

    // Listen for friend deletions
    newSocket.on("friend_deleted_event", (data) => {
      console.log("[ERROR] Friend removed:", data.deleter);
      friendDeleteHandlersRef.current.forEach((handler) => handler(data.deleter));
    });

    // Listen for friend request rejections
    newSocket.on("friend_request_rejected_event", (data) => {
      console.log("Friend request rejected event received:", data);
      if (data && data.rejector) {
        console.log(`   Rejector data:`, data.rejector);
        friendRejectHandlersRef.current.forEach((handler) => handler(data.rejector));
        console.log(`   Notified ${friendRejectHandlersRef.current.length} handler(s)`);
      } else {
        console.warn("WARNING: Friend request rejected event received but no rejector data:", data);
      }
    });

    // Listen for friend request cancellations
    newSocket.on("friend_request_cancelled_event", (data) => {
      console.log("Friend request cancelled event received:", data);
      if (data && data.canceller) {
        console.log(`   Canceller data:`, data.canceller);
        friendCancelHandlersRef.current.forEach((handler) => handler(data.canceller));
        console.log(`   Notified ${friendCancelHandlersRef.current.length} handler(s)`);
      } else {
        console.warn("WARNING: Friend request cancelled event received but no canceller data:", data);
      }
    });

    newSocket.on("user_blocked_event", (data) => {
      if (data?.blocker) {
        blockedHandlersRef.current.forEach((handler) => handler(data.blocker));
      }
    });

    newSocket.on("user_unblocked_event", (data) => {
      if (data?.unblocker) {
        unblockedHandlersRef.current.forEach((handler) => handler(data.unblocker));
      }
    });

    newSocket.on("message_status_update_event", (data) => {
      messageStatusHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("message_deleted_event", (data) => {
      console.log("Message deleted event received:", data);
      messageDeletedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("message_edited_event", (data) => {
      console.log("Message edited event received:", data);
      messageEditedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("message_unsent_event", (data) => {
      console.log("Message unsent event received:", data);
      messageUnsentHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("message_saved_event", (data) => {
      console.log("Message saved event received:", data);
      messageSavedHandlersRef.current.forEach((handler) => handler(data));
    });

    // Group chat events
    newSocket.on("group_created_event", (data) => {
      console.log("Group created event received:", data);
      groupCreatedHandlersRef.current.forEach((handler) => handler(data.group));
    });

    newSocket.on("group_message_received", (data) => {
      console.log("Group message received:", {
        ...data,
        message: data.message ? redactSensitiveData(data.message) : data.message
      });
      groupMessageHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_member_added_event", (data) => {
      console.log("Group member added event received:", data);
      groupMemberAddedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_member_removed_event", (data) => {
      console.log("Group member removed event received:", data);
      groupMemberRemovedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_deleted_event", (data) => {
      console.log("Group deleted event received:", data);
      groupDeletedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_message_edited_event", (data) => {
      console.log("Group message edited event received:", data);
      groupMessageEditedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_message_unsent_event", (data) => {
      console.log("Group message unsent event received:", data);
      groupMessageUnsentHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_message_read_event", (data) => {
      console.log("Group message read event received:", data);
      groupMessageReadHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_key_rotated_event", (data) => {
      console.log("Group key rotated event received:", data);
      groupKeyRotatedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_message_deleted_event", (data) => {
      console.log("Group message deleted event received:", data);
      groupMessageDeletedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_message_saved_event", (data) => {
      console.log("Group message saved event received:", data);
      groupMessageSavedHandlersRef.current.forEach((handler) => handler(data));
    });

    newSocket.on("group_updated_event", (data) => {
      console.log("Group updated event received:", data);
      groupUpdatedHandlersRef.current.forEach((handler) => handler(data));
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user?.id]); // Only reconnect if user ID changes

  // Register message handler
  const onMessageReceived = (handler) => {
    messageHandlersRef.current = [...messageHandlersRef.current, handler];
    return () => {
      messageHandlersRef.current = messageHandlersRef.current.filter((h) => h !== handler);
    };
  };

  // Register friend request handler
  const onFriendRequest = (handler) => {
    friendRequestHandlersRef.current = [...friendRequestHandlersRef.current, handler];
    return () => {
      friendRequestHandlersRef.current = friendRequestHandlersRef.current.filter((h) => h !== handler);
    };
  };

  // Register friend accept handler
  const onFriendRequestAccepted = (handler) => {
    friendAcceptHandlersRef.current = [...friendAcceptHandlersRef.current, handler];
    return () => {
      friendAcceptHandlersRef.current = friendAcceptHandlersRef.current.filter((h) => h !== handler);
    };
  };

  // Register friend delete handler
  const onFriendDeleted = (handler) => {
    friendDeleteHandlersRef.current = [...friendDeleteHandlersRef.current, handler];
    return () => {
      friendDeleteHandlersRef.current = friendDeleteHandlersRef.current.filter((h) => h !== handler);
    };
  };

  // Register friend request rejection handler
  const onFriendRequestRejected = (handler) => {
    friendRejectHandlersRef.current = [...friendRejectHandlersRef.current, handler];
    return () => {
      friendRejectHandlersRef.current = friendRejectHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onFriendRequestCancelled = (handler) => {
    friendCancelHandlersRef.current = [...friendCancelHandlersRef.current, handler];
    return () => {
      friendCancelHandlersRef.current = friendCancelHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onUserBlocked = (handler) => {
    blockedHandlersRef.current = [...blockedHandlersRef.current, handler];
    return () => {
      blockedHandlersRef.current = blockedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onUserUnblocked = (handler) => {
    unblockedHandlersRef.current = [...unblockedHandlersRef.current, handler];
    return () => {
      unblockedHandlersRef.current = unblockedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onMessageStatusUpdate = (handler) => {
    messageStatusHandlersRef.current = [...messageStatusHandlersRef.current, handler];
    return () => {
      messageStatusHandlersRef.current = messageStatusHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onMessageDeleted = (handler) => {
    messageDeletedHandlersRef.current = [...messageDeletedHandlersRef.current, handler];
    return () => {
      messageDeletedHandlersRef.current = messageDeletedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onMessageEdited = (handler) => {
    messageEditedHandlersRef.current = [...messageEditedHandlersRef.current, handler];
    return () => {
      messageEditedHandlersRef.current = messageEditedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onMessageUnsent = (handler) => {
    messageUnsentHandlersRef.current = [...messageUnsentHandlersRef.current, handler];
    return () => {
      messageUnsentHandlersRef.current = messageUnsentHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onMessageSaved = (handler) => {
    messageSavedHandlersRef.current = [...messageSavedHandlersRef.current, handler];
    return () => {
      messageSavedHandlersRef.current = messageSavedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  // Group chat handler registrations
  const onGroupCreated = (handler) => {
    groupCreatedHandlersRef.current = [...groupCreatedHandlersRef.current, handler];
    return () => {
      groupCreatedHandlersRef.current = groupCreatedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessage = (handler) => {
    groupMessageHandlersRef.current = [...groupMessageHandlersRef.current, handler];
    return () => {
      groupMessageHandlersRef.current = groupMessageHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMemberAdded = (handler) => {
    groupMemberAddedHandlersRef.current = [...groupMemberAddedHandlersRef.current, handler];
    return () => {
      groupMemberAddedHandlersRef.current = groupMemberAddedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMemberRemoved = (handler) => {
    groupMemberRemovedHandlersRef.current = [...groupMemberRemovedHandlersRef.current, handler];
    return () => {
      groupMemberRemovedHandlersRef.current = groupMemberRemovedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupDeleted = (handler) => {
    groupDeletedHandlersRef.current = [...groupDeletedHandlersRef.current, handler];
    return () => {
      groupDeletedHandlersRef.current = groupDeletedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessageEdited = (handler) => {
    groupMessageEditedHandlersRef.current = [...groupMessageEditedHandlersRef.current, handler];
    return () => {
      groupMessageEditedHandlersRef.current = groupMessageEditedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessageUnsent = (handler) => {
    groupMessageUnsentHandlersRef.current = [...groupMessageUnsentHandlersRef.current, handler];
    return () => {
      groupMessageUnsentHandlersRef.current = groupMessageUnsentHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessageRead = (handler) => {
    groupMessageReadHandlersRef.current = [...groupMessageReadHandlersRef.current, handler];
    return () => {
      groupMessageReadHandlersRef.current = groupMessageReadHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupKeyRotated = (handler) => {
    groupKeyRotatedHandlersRef.current = [...groupKeyRotatedHandlersRef.current, handler];
    return () => {
      groupKeyRotatedHandlersRef.current = groupKeyRotatedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessageDeleted = (handler) => {
    groupMessageDeletedHandlersRef.current = [...groupMessageDeletedHandlersRef.current, handler];
    return () => {
      groupMessageDeletedHandlersRef.current = groupMessageDeletedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupMessageSaved = (handler) => {
    groupMessageSavedHandlersRef.current = [...groupMessageSavedHandlersRef.current, handler];
    return () => {
      groupMessageSavedHandlersRef.current = groupMessageSavedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const onGroupUpdated = (handler) => {
    groupUpdatedHandlersRef.current = [...groupUpdatedHandlersRef.current, handler];
    return () => {
      groupUpdatedHandlersRef.current = groupUpdatedHandlersRef.current.filter((h) => h !== handler);
    };
  };

  const value = {
    socket,
    isConnected,
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
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}
