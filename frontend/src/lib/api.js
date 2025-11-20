const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request(path, { method = "GET", token, body } = {}) {
  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type");
  const hasJson = contentType && contentType.includes("application/json");
  const payload = hasJson ? await response.json() : null;

  if (!response.ok) {
    const message =
      payload?.message || payload?.error || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export const api = {
  register: (data) => request("/auth/register", { method: "POST", body: data }),
  login: (data) => request("/auth/login", { method: "POST", body: data }),
  currentUser: (token) => request("/auth/me", { token }),
  conversations: (token) => request("/conversations", { token }),
  conversationById: (token, id) => request(`/conversations/${id}`, { token }),
  createConversation: (token, data) =>
    request("/conversations", { method: "POST", token, body: data }),
  messages: (token, conversationId) =>
    request(`/conversations/${conversationId}/messages`, { token }),
  sendMessage: (token, conversationId, content) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      token,
      body: { content },
    }),
  sendEncryptedMessage: (token, conversationId, encryptedData) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      token,
      body: { encrypted: true, ...encryptedData },
    }),
  getPublicKey: (token, userId) =>
    request(`/keys/public/${userId}`, { token }),
  friends: (token) => request("/friends", { token }),
  friendRequests: (token) => request("/friends/requests", { token }),
  blockedFriends: (token) => request("/friends/blocked", { token }),
  addFriend: (token, username) =>
    request("/friends", { method: "POST", token, body: { username } }),
  searchUser: (token, username) =>
    request(`/friends/search?username=${encodeURIComponent(username)}`, { token }),
  blockUser: (token, username) =>
    request("/friends/block", { method: "POST", token, body: { username } }),
  unblockUser: (token, username) =>
    request("/friends/unblock", { method: "POST", token, body: { username } }),
  acceptFriendRequest: (token, requesterId) =>
    request(`/friends/requests/${requesterId}/accept`, { method: "POST", token }),
  rejectFriendRequest: (token, requesterId) =>
    request(`/friends/requests/${requesterId}/reject`, { method: "DELETE", token }),
  deleteFriend: (token, friendId) =>
    request(`/friends/${friendId}`, { method: "DELETE", token }),
  rotatePublicKey: (token, publicKey, encryptedPrivateKey = null, salt = null, iv = null) =>
    request("/keys/rotate", {
      method: "PUT",
      token,
      body: {
        publicKey,
        algorithm: "ECC-SECP256R1",
        encryptedPrivateKey,
        salt,
        iv
      },
    }),
  registerPublicKey: (token, publicKey, encryptedPrivateKey = null, salt = null, iv = null) =>
    request("/keys/register", {
      method: "POST",
      token,
      body: {
        publicKey,
        algorithm: "ECC-SECP256R1",
        encryptedPrivateKey,
        salt,
        iv
      },
    }),
  myPublicKey: (token) => request("/keys/my-key", { token }),
  userSettings: (token) => request("/settings", { token }),
  updateSettings: (token, data) =>
    request("/settings", { method: "PUT", token, body: data }),
  updateMessageStatus: (token, conversationId, messageId, status) =>
    request(`/conversations/${conversationId}/messages/${messageId}/status`, {
      method: "PATCH",
      token,
      body: { status },
    }),
  saveMessage: (token, conversationId, messageId, saved) =>
    request(`/conversations/${conversationId}/messages/${messageId}/save`, {
      method: "PATCH",
      token,
      body: { saved },
    }),
};
