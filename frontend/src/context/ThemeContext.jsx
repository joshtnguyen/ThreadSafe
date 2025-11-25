import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "./AuthContext.jsx";

const ThemeContext = createContext(null);

const STORAGE_KEY_PREFIX = "threadsafe:theme:user:";
const DEFAULT_THEME = "dark";

function getUserThemeKey(userId) {
  return userId ? `${STORAGE_KEY_PREFIX}${userId}` : null;
}

function getStoredTheme(userId) {
  // If no user is logged in, always return dark theme
  if (!userId) {
    return DEFAULT_THEME;
  }

  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  try {
    const key = getUserThemeKey(userId);
    if (key) {
      const stored = localStorage.getItem(key);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    }
  } catch {
    // Ignore storage errors (private mode, etc.)
  }

  return DEFAULT_THEME;
}

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  // Disable transitions temporarily to prevent flash
  document.documentElement.classList.add('theme-changing');

  // Apply theme instantly
  document.documentElement.setAttribute('data-theme', theme);

  // Re-enable transitions after paint completes
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-changing');
    });
  });
}

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState(() => {
    // If user is logged in, use their settings or stored preference
    // If not logged in, always use dark theme
    if (user) {
      return user.settings?.theme ?? getStoredTheme(user.id);
    }
    return DEFAULT_THEME;
  });

  useEffect(() => {
    if (user) {
      // User is logged in - use their preference
      const preferred = user.settings?.theme ?? getStoredTheme(user.id);
      if (preferred !== theme) {
        setThemeState(preferred);
      }
    } else {
      // User is logged out - always use dark theme
      if (theme !== DEFAULT_THEME) {
        setThemeState(DEFAULT_THEME);
      }
    }
  }, [user, user?.id, user?.settings?.theme]);

  useEffect(() => {
    applyTheme(theme);
    // Only save to localStorage if user is logged in
    if (user?.id) {
      try {
        const key = getUserThemeKey(user.id);
        if (key) {
          localStorage.setItem(key, theme);
        }
      } catch {
        // Ignore storage write errors
      }
    }
  }, [theme, user?.id]);

  const updateTheme = useCallback((nextTheme) => {
    setThemeState(nextTheme === "light" ? "light" : "dark");
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme: updateTheme,
    }),
    [theme, updateTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
