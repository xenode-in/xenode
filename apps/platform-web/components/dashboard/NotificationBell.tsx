"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, CheckCheck } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=1");
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent — the bell is non-critical chrome
    }
  }, []);

  useEffect(() => {
    void loadCount();
    const timer = setInterval(() => void loadCount(), 60_000);
    return () => clearInterval(timer);
  }, [loadCount]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadList();
  }

  async function markAllRead() {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground hover:bg-accent"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-3 py-2.5 ${n.read ? "" : "bg-primary/5"}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {formatDate(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
