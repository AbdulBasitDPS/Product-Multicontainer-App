"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { readSession, writeSession, type Session } from "@/lib/api";

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  expired: boolean;
  signIn: (session: Session) => void;
  signOut: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const router = useRouter();
  useEffect(() => {
    setSession(readSession());
    setReady(true);
  }, []);
  const signOut = useCallback(() => {
    writeSession(null);
    setSession(null);
    router.replace("/login");
  }, [router]);
  useEffect(() => {
    const handleExpiry = () => {
      setExpired(true);
      signOut();
    };
    window.addEventListener("session-expired", handleExpiry);
    return () => window.removeEventListener("session-expired", handleExpiry);
  }, [signOut]);
  useEffect(() => {
    if (!session) return;
    const payload = JSON.parse(
      atob(session.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const timer = setTimeout(
      () => {
        setExpired(true);
        signOut();
      },
      Math.max(0, payload.exp * 1000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, signOut]);
  const signIn = (value: Session) => {
    writeSession(value);
    setSession(value);
    setExpired(false);
    router.replace("/products");
  };
  return (
    <AuthContext.Provider value={{ session, ready, expired, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
