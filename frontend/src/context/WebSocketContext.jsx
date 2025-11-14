import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";

const WebSocketContext = createContext(null);

const RELAY_SERVER_URL = "http://localhost:5001";

export function WebSocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const messageHandlersRef = useRef([]);
  const friendRequestHandlersRef = useRef([]);
  const friendAcceptHandlersRef = useRef([]);
  const friendDeleteHandlersRef = useRef([]);

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
      console.log("📨 New message received:", data.message);
      messageHandlersRef.current.forEach((handler) => handler(data.message));
    });

    // Listen for friend requests
    newSocket.on("friend_request_received", (data) => {
      console.log("👥 Friend request received:", data.request);
      friendRequestHandlersRef.current.forEach((handler) => handler(data.request));
    });

    // Listen for friend request acceptances
    newSocket.on("friend_request_accepted_event", (data) => {
      console.log("[OK] Friend request accepted:", data.friend);
      friendAcceptHandlersRef.current.forEach((handler) => handler(data.friend));
    });

    // Listen for friend deletions
    newSocket.on("friend_deleted_event", (data) => {
      console.log("[ERROR] Friend removed:", data.deleter);
      friendDeleteHandlersRef.current.forEach((handler) => handler(data.deleter));
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

  const value = {
    socket,
    isConnected,
    onMessageReceived,
    onFriendRequest,
    onFriendRequestAccepted,
    onFriendDeleted,
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
