"use client";

/**
 * Drive session client — replaces the better-auth React client after the
 * Accounts OIDC cutover.
 *
 * Drive no longer runs its own auth authority: sessions are Drive
 * ProductSessions minted by /auth/callback, probed via GET /api/me, and
 * revoked via POST /auth/logout. Sign-in/sign-up, password, 2FA, passkeys
 * (as a login method), linked accounts, and device management all live at
 * the Accounts hub (ACCOUNTS_ORIGIN).
 *
 * The hook keeps better-auth's `{ data, isPending, error, refetch }` shape
 * so existing consumers keep working, with one shared in-flight fetch per
 * page load.
 */

import { useCallback, useEffect, useState } from "react";
import type { DriveSession } from "@/lib/auth/session";

type SessionState = {
  data: DriveSession | null;
  isPending: boolean;
  error: Error | null;
};

let current: SessionState = { data: null, isPending: true, error: null };
let inflight: Promise<DriveSession | null> | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

async function fetchSession(): Promise<DriveSession | null> {
  const response = await fetch("/api/me", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Session probe failed (${response.status})`);
  return ((await response.json()) as DriveSession | null) ?? null;
}

async function loadSession(force = false): Promise<DriveSession | null> {
  if (!force && loaded && !inflight) return current.data;
  if (!inflight) {
    inflight = fetchSession()
      .then((data) => {
        current = { data, isPending: false, error: null };
        return data;
      })
      .catch((error: Error) => {
        current = { data: null, isPending: false, error };
        return null;
      })
      .finally(() => {
        inflight = null;
        loaded = true;
        notify();
      });
  }
  return inflight;
}

/** React hook mirroring better-auth's useSession contract. */
export function useSession() {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    if (!loaded && !inflight) void loadSession();
    return () => void listeners.delete(listener);
  }, []);

  const refetch = useCallback(() => void loadSession(true), []);
  return { ...current, refetch };
}

/** One-shot session read (non-hook callers). */
export async function getSession(): Promise<{ data: DriveSession | null }> {
  return { data: await loadSession() };
}

/** Revoke the Drive ProductSession and clear the host-only cookie. */
export async function signOut(): Promise<{ success: boolean }> {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    current = { data: null, isPending: false, error: null };
    loaded = true;
    notify();
  }
  return { success: true };
}

export const authClient = { useSession, getSession, signOut };
