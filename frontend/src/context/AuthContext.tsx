"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getSession,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  type PublicUser,
} from "@/lib/api/auth";

interface AuthContextType {
  user: PublicUser | null;
  isLoading: boolean;
  error: string | null;
  register: (input: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<PublicUser>;
  login: (input: { email: string; password: string }) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(false);

  const applyUser = useCallback((nextUser: PublicUser | null) => {
    if (!isMountedRef.current) {
      return;
    }

    setUser(nextUser);
    setError(null);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await getSession();
      applyUser(response.user);
    } catch (err) {
      if (isMountedRef.current) {
        setUser(null);
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyUser]);

  useEffect(() => {
    isMountedRef.current = true;
    void refreshSession();

    return () => {
      isMountedRef.current = false;
    };
  }, [refreshSession]);

  const register = useCallback(
    async (input: { email: string; password: string; displayName?: string }) => {
      setIsLoading(true);
      try {
        const response = await registerRequest(input);
        applyUser(response.user);
        return response.user;
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Registration failed");
        }
        throw err;
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [applyUser],
  );

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      setIsLoading(true);
      try {
        const response = await loginRequest(input);
        applyUser(response.user);
        return response.user;
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Login failed");
        }
        throw err;
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await logoutRequest();
      applyUser(null);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : "Logout failed");
      }
      throw err;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyUser]);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, error, register, login, logout, refreshSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
