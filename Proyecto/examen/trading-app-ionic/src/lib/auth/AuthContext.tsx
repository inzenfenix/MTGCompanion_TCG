import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';

/**
 * Session — backed by the backend's real JWT login (`POST /auth/login`,
 * see backend/README.md "Estado actual"). Every consumer talks to
 * `useAuth()` only, never to localStorage or api.setAuthToken() directly,
 * so a future change (refresh tokens, 2FA) only means rewriting this file.
 *
 * Persisted as one JSON blob (token + user) rather than re-deriving the
 * user from a "whoami" endpoint on reload — there isn't one, and the
 * access token is short-lived (JWT_ACCESS_TTL, 15min by default) anyway,
 * so a stale cached user is corrected the moment any real request 401s
 * (see the onUnauthorized wiring below).
 */

const STORAGE_KEY = 'mtg_companion_session';

type StoredSession = { accessToken: string; user: api.User };

type AuthContextValue = {
  user: api.User | null;
  /** True only while we're resolving a persisted session on first load. */
  isLoading: boolean;
  register: (input: api.RegisterUserInput) => Promise<api.User>;
  login: (input: api.LoginInput) => Promise<api.User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null; // corrupted value from an older app version — treat as logged out
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<api.User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    api.setAuthToken(null);
    setUser(null);
  }, []);

  const persistSession = useCallback((session: StoredSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    api.setAuthToken(session.accessToken);
    setUser(session.user);
  }, []);

  // Resume the session on first load, and react to any future 401 (expired
  // or invalid token) by logging out — a single place that handles it
  // instead of every page checking for it individually.
  useEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      api.setAuthToken(stored.accessToken);
      setUser(stored.user);
    }
    setIsLoading(false);

    api.setUnauthorizedHandler(clearSession);
    return () => api.setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = useCallback(
    async (input: api.LoginInput) => {
      const result = await api.login(input);
      persistSession(result);
      return result.user;
    },
    [persistSession],
  );

  const register = useCallback(
    async (input: api.RegisterUserInput) => {
      // Registration alone doesn't return a session (no accessToken) — log
      // in right after with the same credentials so "sign up" reads as one
      // step to the user instead of two.
      await api.registerUser(input);
      return login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, isLoading, register, login, logout }),
    [user, isLoading, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>');
  return ctx;
}
