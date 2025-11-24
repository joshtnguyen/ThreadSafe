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
  deleteConversation: (token, conversationId) =>
    request(`/conversations/${conversationId}`, { method: "DELETE", token }),
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
  cancelFriendRequest: (token, recipientId) =>
    request(`/friends/requests/${recipientId}/cancel`, { method: "DELETE", token }),
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
  // Backup management
  getBackups: (token) => request("/backups", { token }),
  deleteBackup: (token, messageId) =>
    request(`/backups/${messageId}`, { method: "DELETE", token }),
  // Profile picture
  uploadProfilePicture: (token, imageData) =>
    request("/settings/profile-picture", { method: "POST", token, body: { imageData } }),
  deleteProfilePicture: (token) =>
    request("/settings/profile-picture", { method: "DELETE", token }),
  // Message edit, unsend, and reply
  editMessage: (token, conversationId, messageId, encryptedData) =>
    request(`/conversations/${conversationId}/messages/${messageId}/edit`, {
      method: "PATCH",
      token,
      body: { encrypted: true, ...encryptedData },
    }),
  unsendMessage: (token, conversationId, messageId) =>
    request(`/conversations/${conversationId}/messages/${messageId}/unsend`, {
      method: "PATCH",
      token,
    }),
  sendMessageWithReply: (token, conversationId, encryptedData, replyToId) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      token,
      body: { encrypted: true, ...encryptedData, replyToId },
    }),

  // ============================================================================
  // Group Chat API
  // ============================================================================

  // Group CRUD
  createGroup: (token, groupName, memberIds, encryptedKeys, profilePicUrl = null) =>
    request("/groups", {
      method: "POST",
      token,
      body: { groupName, memberIds, encryptedKeys, profilePicUrl },
    }),
  getGroups: (token) => request("/groups", { token }),
  getGroup: (token, groupId) => request(`/groups/${groupId}`, { token }),
  updateGroup: (token, groupId, updates) =>
    request(`/groups/${groupId}`, { method: "PATCH", token, body: updates }),
  deleteGroup: (token, groupId) =>
    request(`/groups/${groupId}`, { method: "DELETE", token }),

  // Group Membership
  addGroupMembers: (token, groupId, memberIds, encryptedKeys) =>
    request(`/groups/${groupId}/members`, {
      method: "POST",
      token,
      body: { memberIds, encryptedKeys },
    }),
  removeGroupMember: (token, groupId, memberId) =>
    request(`/groups/${groupId}/members/${memberId}`, { method: "DELETE", token }),
  leaveGroup: (token, groupId, userId) =>
    request(`/groups/${groupId}/members/${userId}`, { method: "DELETE", token }),
  transferOwnership: (token, groupId, newOwnerId) =>
    request(`/groups/${groupId}/members/${newOwnerId}/role`, {
      method: "PATCH",
      token,
      body: { role: "Owner" },
    }),

  // Group Key Management
  storeGroupKeys: (token, groupId, encryptedKeys) =>
    request(`/groups/${groupId}/keys`, {
      method: "POST",
      token,
      body: { encryptedKeys },
    }),
  getGroupKey: (token, groupId) => request(`/groups/${groupId}/keys`, { token }),
  rotateGroupKey: (token, groupId, encryptedKeys) =>
    request(`/groups/${groupId}/keys/rotate`, {
      method: "POST",
      token,
      body: { encryptedKeys },
    }),

  // Group Messages
  getGroupMessages: (token, groupId) =>
    request(`/groups/${groupId}/messages`, { token }),
  sendGroupMessage: (token, groupId, encryptedContent, iv, hmac, replyToId = null) =>
    request(`/groups/${groupId}/messages`, {
      method: "POST",
      token,
      body: { encryptedContent, iv, hmac, replyToId },
    }),
  markGroupMessageRead: (token, groupId, messageId) =>
    request(`/groups/${groupId}/messages/${messageId}/read`, {
      method: "PATCH",
      token,
    }),
  editGroupMessage: (token, groupId, messageId, encryptedContent, iv, hmac) =>
    request(`/groups/${groupId}/messages/${messageId}/edit`, {
      method: "PATCH",
      token,
      body: { encryptedContent, iv, hmac },
    }),
  unsendGroupMessage: (token, groupId, messageId) =>
    request(`/groups/${groupId}/messages/${messageId}/unsend`, {
      method: "PATCH",
      token,
    }),
  deleteGroupMessage: (token, groupId, messageId) =>
    request(`/groups/${groupId}/messages/${messageId}`, {
      method: "DELETE",
      token,
    }),
  saveGroupMessage: (token, groupId, messageId, saved) =>
    request(`/groups/${groupId}/messages/${messageId}/save`, {
      method: "PATCH",
      token,
      body: { saved },
    }),
};
