import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ProductSession,
  consumeBrowserLogoutCleanupTicket,
} from "@xenode/database";
import { DRIVE_SESSION_COOKIE } from "@/lib/auth/session";
import { parseDriveSessionCookie } from "@/lib/auth/product-cookie";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");
  const transaction = ticket
    ? await consumeBrowserLogoutCleanupTicket(ticket, "drive")
    : null;
  if (!transaction) return new Response("Expired", { status: 410 });

  const rawCookie = /(?:^|;\s*)xenode_drive_session=([^;]+)/u.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
  const credential = rawCookie
    ? await parseDriveSessionCookie(decodeURIComponent(rawCookie))
    : null;
  const session = credential
    ? await ProductSession.findOne({ sessionId: credential.sessionId }).lean()
    : null;
  const shouldClear =
    !session ||
    (session.accountId === transaction.accountId &&
      session.issuerSessionId === transaction.issuerSessionId);
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://accounts.xenode.in"
      : "http://localhost:3001");
  const nonce = randomBytes(18).toString("base64url");
  const script = shouldClear
    ? `
      try { new BroadcastChannel("xenode-auth:drive").postMessage({type:"logout"}); } catch {}
      for (const name of ["xenode-keys-drive","xenode-handoff-drive","xenode-keys-drive-sharing-private","xenode-keys-drive-sharing-public","xenode-keys-drive-metadata"]) {
        try { indexedDB.deleteDatabase(name); } catch {}
      }
      try { localStorage.removeItem("lastSync"); } catch {}
    `
    : "";
  const response = new NextResponse(
    `<!doctype html><meta charset="utf-8"><script nonce="${nonce}">${script}
      parent.postMessage({type:"xenode:logout-cleanup",productId:"drive"},${JSON.stringify(new URL(accountsOrigin).origin)});
    </script>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors ${new URL(accountsOrigin).origin}`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
  if (shouldClear) {
    response.cookies.set({
      name: DRIVE_SESSION_COOKIE,
      value: "",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
