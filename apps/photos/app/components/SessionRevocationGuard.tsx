"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";

export function SessionRevocationGuard({
  sessionId,
}: {
  sessionId: string;
}) {
  useEffect(() => {
    let disposed = false;
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("xenode-auth:photos");
    const revoke = () => {
      if (disposed) return;
      channel?.postMessage({ type: "logout" });
      window.location.reload();
    };
    const probe = async () => {
      const response = await fetch("/api/session", {
        credentials: "include",
        cache: "no-store",
      }).catch(() => null);
      if (!response || response.status === 401) revoke();
    };
    const onFocus = () => void probe();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probe();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    let socket: ReturnType<typeof io> | undefined;
    void fetch("/api/realtime/token", {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok || disposed) return null;
        return (await response.json()) as { token: string };
      })
      .then((ticket) => {
        if (!ticket || disposed) return;
        const realtimeOrigin =
          process.env.NEXT_PUBLIC_REALTIME_ORIGIN ??
          (process.env.NODE_ENV === "production"
            ? "https://drive.xenode.in"
            : "http://localhost:3000");
        socket = io(realtimeOrigin, {
          path: "/api/socket.io",
          transports: ["websocket"],
          withCredentials: true,
          auth: { token: ticket.token },
        });
        socket.on("sync:event", (event: {
          type?: string;
          sessionId?: string;
        }) => {
          if (
            event.type === "SESSION_REVOKED" &&
            event.sessionId === sessionId
          ) {
            revoke();
          }
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      socket?.disconnect();
      channel?.close();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);
  return null;
}
