"use client";

import { useState, useEffect, useCallback } from "react";
import { authClient, useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Monitor,
  Smartphone,
  Globe,
  Loader2,
  LogOut,
  MapPin,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SessionData {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function parseUserAgent(ua?: string | null): {
  browser: string;
  os: string;
  isMobile: boolean;
} {
  if (!ua) return { browser: "Unknown Browser", os: "Unknown", isMobile: false };

  let browser = "Unknown Browser";
  let os = "Unknown";
  let isMobile = false;

  // OS detection
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|macOS/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) { os = "Android"; isMobile = true; }
  else if (/iPhone|iPad|iPod/i.test(ua)) { os = "iOS"; isMobile = true; }
  else if (/Linux/i.test(ua)) os = "Linux";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";

  // Browser detection (order matters — more specific first)
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
  else if (/Brave/i.test(ua)) browser = "Brave";
  else if (/Vivaldi/i.test(ua)) browser = "Vivaldi";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua)) browser = "Safari";
  else if (/xenode/i.test(ua)) { browser = "Xenode App"; isMobile = true; }

  return { browser, os, isMobile };
}

export function SessionsSettingsSection() {
  const { data: session } = useSession();
  const currentToken = session?.session?.token;

  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const { data, error } = await authClient.listSessions();
      if (error) {
        console.error("Failed to list sessions:", error);
        return;
      }
      if (data) {
        // Sort: current session first, then by most recent
        const sorted = [...data].sort((a, b) => {
          if (a.token === currentToken) return -1;
          if (b.token === currentToken) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        setSessions(sorted as SessionData[]);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [currentToken]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function handleRevoke(token: string) {
    setRevokingId(token);
    try {
      const { error } = await authClient.revokeSession({ token });
      if (error) {
        toast.error("Failed to revoke session");
        return;
      }
      toast.success("Session revoked");
      setSessions((prev) => prev.filter((s) => s.token !== token));
    } catch (err) {
      console.error("Revoke error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAll() {
    setRevokingAll(true);
    try {
      const { error } = await authClient.revokeSessions();
      if (error) {
        toast.error("Failed to revoke sessions");
        return;
      }
      toast.success("All other sessions revoked");
      // Keep only the current session
      setSessions((prev) => prev.filter((s) => s.token === currentToken));
    } catch (err) {
      console.error("Revoke all error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setRevokingAll(false);
    }
  }

  const otherSessions = sessions.filter((s) => s.token !== currentToken);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" /> Active Sessions
          </h3>
          <p className="text-xs text-muted-foreground">
            Manage your active sessions across devices. Sign out any session you
            don&apos;t recognize.
          </p>
        </div>
        {otherSessions.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevokeAll}
            disabled={revokingAll}
            className="gap-2 text-destructive hover:text-destructive shrink-0"
          >
            {revokingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            Sign out all others
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-16 w-full animate-pulse bg-muted rounded-md" />
          <div className="h-16 w-full animate-pulse bg-muted rounded-md" />
        </div>
      ) : sessions.length > 0 ? (
        <div className="border rounded-md overflow-hidden divide-y divide-border">
          {sessions.map((s) => {
            const isCurrent = s.token === currentToken;
            const { browser, os, isMobile } = parseUserAgent(s.userAgent);
            const DeviceIcon = isMobile ? Smartphone : Monitor;

            return (
              <div
                key={s.id}
                className={`p-3 flex items-center justify-between bg-card ${
                  isCurrent ? "bg-primary/[0.03]" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-full shrink-0 ${
                      isCurrent
                        ? "bg-primary/10"
                        : "bg-muted"
                    }`}
                  >
                    <DeviceIcon
                      className={`w-4 h-4 ${
                        isCurrent
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {browser} on {os}
                      </p>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                          This device
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {s.ipAddress && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" />
                          {s.ipAddress}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        Last active{" "}
                        {formatDistanceToNow(new Date(s.updatedAt))} ago
                      </span>
                    </div>
                  </div>
                </div>
                {!isCurrent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={() => handleRevoke(s.token)}
                    disabled={revokingId === s.token}
                    title="Revoke session"
                  >
                    {revokingId === s.token ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4 border border-dashed rounded-md text-center bg-muted/30">
          <p className="text-xs text-muted-foreground">
            No active sessions found.
          </p>
        </div>
      )}
    </div>
  );
}
