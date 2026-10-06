"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Boxes, Package, Upload, LogOut, X, UserRound } from "lucide-react";
import { useAuth } from "./auth-provider";
import { WS_URL, type LiveEvent } from "@/lib/api";

export function Brand() {
  return (
    <Link href="/products" className="brand">
      <span className="brand-icon">
        <Boxes size={22} />
      </span>
      <span>
        Precision<span className="brand-sub">Inventory</span>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, ready, signOut } = useAuth();
  const [connected, setConnected] = useState(false);
  const [alert, setAlert] = useState<{ text: string; id: number } | null>(null);
  const authPage = pathname === "/login" || pathname === "/register";
  useEffect(() => {
    if (!ready || authPage) return;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let delay = 1000;
    const connect = () => {
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        setConnected(true);
        delay = 1000;
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) {
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 15000);
        }
      };
      socket.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data) as LiveEvent;
          if (!event?.data?.type) return;
          window.dispatchEvent(
            new CustomEvent("inventory-event", { detail: event }),
          );
          if (event.channel === "stock_alerts" && event.data.product_id) {
            setAlert({
              id: event.data.product_id,
              text: `${event.data.name || "Product"}: ${event.data.stock ?? 0} in stock`,
            });
          }
        } catch {
          /* Ignore malformed live messages. */
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      setConnected(false);
    };
  }, [ready, authPage]);
  if (authPage) return <main className="auth-page">{children}</main>;
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          <Link
            href="/products"
            className={
              pathname === "/products" ? "nav-link active" : "nav-link"
            }
            aria-current={pathname === "/products" ? "page" : undefined}
          >
            <Package size={18} />
            Products
          </Link>
          {session && (
            <Link
              href="/imports"
              className={
                pathname === "/imports" ? "nav-link active" : "nav-link"
              }
              aria-current={pathname === "/imports" ? "page" : undefined}
            >
              <Upload size={18} />
              CSV imports
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          {session ? (
            <button className="nav-link logout-link" onClick={signOut}>
              <LogOut size={17} />
              Log out
            </button>
          ) : (
            ready && (
              <Link className="nav-link" href="/login">
                <LogOut size={17} />
                Log in
              </Link>
            )
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className={`connection ${connected ? "online" : ""}`}>
            <span />
            {connected ? "Live updates" : "Reconnecting"}
          </span>
          <div className="account">
            {session ? (
              <>
                <span className="account-email">{session.user.email}</span>
                <span className="account-avatar">
                  <UserRound size={17} />
                </span>
              </>
            ) : (
              ready && (
                <Link className="button secondary" href="/login">
                  Log in
                </Link>
              )
            )}
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      {alert && (
        <div className="toast" role="status">
          <div>
            <strong>Low stock</strong>
            <Link
              href={`/products?highlight=${alert.id}`}
              onClick={() => setAlert(null)}
            >
              {alert.text}
            </Link>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setAlert(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
