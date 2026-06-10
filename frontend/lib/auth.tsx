"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Cookies from "js-cookie";
import { getMe, login as apiLogin, logout as apiLogout } from "./api";
import type { User } from "@/types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = Cookies.get("access_token");
    if (!token) { setLoading(false); return; }
    getMe().then(setUser).catch(() => Cookies.remove("access_token")).finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    await apiLogin(email, password);
    setUser(await getMe());
  }

  function logout() {
    apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
