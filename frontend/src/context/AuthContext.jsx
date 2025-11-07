import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const AuthContext = createContext(null);

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
  const [user, setUser] = useState(() => loadStoredValue("user"));

  const login = useCallback((nextUser, accessToken) => {
    setUser(nextUser);
    setToken(accessToken);
    sessionStorage.setItem("user", JSON.stringify(nextUser));
    sessionStorage.setItem("accessToken", JSON.stringify(accessToken));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("accessToken");
    // Clear encryption keys on logout
    sessionStorage.removeItem("privateKey");
    sessionStorage.removeItem("publicKey");
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      login,
      logout,
      isAuthenticated: Boolean(token && user),
    }),
    [login, logout, token, user],
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
