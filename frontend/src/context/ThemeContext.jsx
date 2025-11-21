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

const STORAGE_KEY = "threadsafe:theme";
const DEFAULT_THEME = "dark";

function getStoredTheme() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage errors (private mode, etc.)
  }
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (media) {
    return media.matches ? "dark" : "light";
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
    return user?.settings?.theme ?? getStoredTheme();
  });

  useEffect(() => {
    const preferred = user?.settings?.theme;
    if (preferred && preferred !== theme) {
      setThemeState(preferred);
    }
  }, [theme, user?.settings?.theme]);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

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
