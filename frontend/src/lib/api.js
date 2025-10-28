const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api";

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
  friends: (token) => request("/friends", { token }),
  friendRequests: (token) => request("/friends/requests", { token }),
  addFriend: (token, username) =>
    request("/friends", { method: "POST", token, body: { username } }),
  acceptFriendRequest: (token, requesterId) =>
    request(`/friends/requests/${requesterId}/accept`, { method: "POST", token }),
  rejectFriendRequest: (token, requesterId) =>
    request(`/friends/requests/${requesterId}/reject`, { method: "DELETE", token }),
  deleteFriend: (token, friendId) =>
    request(`/friends/${friendId}`, { method: "DELETE", token }),
};
