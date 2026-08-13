import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';

/**
 * Session scaffold — PLACEHOLDER FOR REAL AUTH.
 * ------------------------------------------------------------------------
 * The backend has no /login/JWT yet (see backend/README.md "Qué falta"):
 * this phase only exposes POST /users/register and GET /users/:id. There is
 * no password check, no token, nothing to refresh.
 *
 * So "being logged in" here just means "we have a user id we trust enough
 * to persist in localStorage and send as ownerId/buyerId on requests" —
 * either because the user just registered, or because they typed in an
 * existing user id (useful for testing with more than one account/device
 * without a real login form). Every consumer of this file talks to
 * `useAuth()` only, never to localStorage or the backend directly, so
 * swapping this out for real JWT auth later (token storage, refresh,
 * an actual login endpoint) only means rewriting this one file.
 */

const STORAGE_KEY = 'mtg_companion_user_id';

type AuthContextValue = {
  user: api.User | null;
  /** True only while we're resolving a persisted user id on first load. */
  isLoading: boolean;
  register: (input: api.RegisterUserInput) => Promise<api.User>;
  /** "Log in" by pointing at an existing user id — the closest thing to login this phase has. */
  continueWithExistingUserId: (id: string) => Promise<api.User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<api.User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On first mount, try to resume the "session" from the persisted id.
  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (!storedId) {
      setIsLoading(false);
      return;
    }
    api
      .getUser(storedId)
      .then(setUser)
      .catch(() => {
        // Stored id no longer resolves (deleted user, wrong backend, etc.) — drop it silently.
        localStorage.removeItem(STORAGE_KEY);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const persist = useCallback((nextUser: api.User) => {
    localStorage.setItem(STORAGE_KEY, nextUser.id);
    setUser(nextUser);
  }, []);

  const register = useCallback(
    async (input: api.RegisterUserInput) => {
      const newUser = await api.registerUser(input);
      persist(newUser);
      return newUser;
    },
    [persist],
  );

  const continueWithExistingUserId = useCallback(
    async (id: string) => {
      const existingUser = await api.getUser(id);
      persist(existingUser);
      return existingUser;
    },
    [persist],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, register, continueWithExistingUserId, logout }),
    [user, isLoading, register, continueWithExistingUserId, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>');
  return ctx;
}
