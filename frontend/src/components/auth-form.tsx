"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  UserRoundPlus,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Brand } from "./app-shell";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { session, ready, expired, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const registering = mode === "register";
  useEffect(() => {
    if (ready && session) router.replace("/products");
  }, [ready, session, router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      signIn(
        await api.authenticate(
          mode,
          String(form.get("email")).trim(),
          String(form.get("password")),
        ),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-container">
      <section className="card auth-card">
        <Brand />
        <h1>
          {registering ? "Create an account" : "Log in to your workspace"}
        </h1>
        <nav className="auth-tabs" aria-label="Account access">
          <Link
            href="/login"
            className={!registering ? "selected" : ""}
            aria-current={!registering ? "page" : undefined}
          >
            <LockKeyhole size={14} />
            Log in
          </Link>
          <Link
            href="/register"
            className={registering ? "selected" : ""}
            aria-current={registering ? "page" : undefined}
          >
            <UserRoundPlus size={15} />
            Create account
          </Link>
        </nav>
        {expired && !error && (
          <p className="notice" role="status">
            Your session expired. Please log in again.
          </p>
        )}
        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={busy}
            />
          </label>
          <div>
            <label htmlFor="password">Password</label>
            <div className="password-input">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 6 : undefined}
                placeholder={
                  registering ? "At least 6 characters" : "Your password"
                }
                required
                disabled={busy}
              />
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy || !ready}>
            {busy
              ? "Please wait..."
              : registering
                ? "Create account"
                : "Log in"}
            <ArrowRight size={16} />
          </button>
        </form>
      </section>
      <Link className="browse-link" href="/products">
        Browse products
      </Link>
    </div>
  );
}
