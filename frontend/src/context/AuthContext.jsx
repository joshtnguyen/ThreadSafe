import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const AuthContext = createContext(null);

function normalizeUser(user) {
  if (!user) {
    return null;
  }
  const settings = typeof user.settings === "object" && user.settings !== null ? user.settings : {};
  return {
    ...user,
    settings,
  };
}

function persistUser(user) {
  if (user) {
    sessionStorage.setItem("user", JSON.stringify(user));
  } else {
    sessionStorage.removeItem("user");
  }
}

function loadStoredValue(key) {
  const value = sessionStorage.getItem(key);
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => loadStoredValue("accessToken"));
  const [user, setUser] = useState(() => normalizeUser(loadStoredValue("user")));

  const login = useCallback((nextUser, accessToken) => {
    const normalizedUser = normalizeUser(nextUser);
    setUser(normalizedUser);
    setToken(accessToken);
    persistUser(normalizedUser);
    sessionStorage.setItem("accessToken", JSON.stringify(accessToken));
  }, []);

  const updateUser = useCallback((updater) => {
    setUser((previous) => {
      const nextValue = typeof updater === "function" ? updater(previous) : updater;
      const normalized = normalizeUser(nextValue);
      persistUser(normalized);
      return normalized;
    });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("accessToken");
    // Note: We DON'T clear encryption keys on logout
    // Keys are stored per-user in localStorage and will be loaded on next login
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      login,
      logout,
      updateUser,
      isAuthenticated: Boolean(token && user),
    }),
    [login, logout, token, updateUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
