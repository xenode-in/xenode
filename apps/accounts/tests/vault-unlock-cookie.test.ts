import { describe, expect, it } from "vitest";
import { VAULT_UNLOCK_COOKIE, withVaultUnlockCookie } from "@/lib/vault-unlock-session";

describe("withVaultUnlockCookie", () => {
  it("adds the confirmation without rewriting the auth cookies already set", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "xenode_accounts.session_token=abc.sig; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "xenode_accounts.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    const carried = withVaultUnlockCookie(new Response('{"ok":true}', { status: 200, headers }), "token");
    const cookies = carried.headers.getSetCookie();
    expect(cookies.slice(0, 2)).toEqual(headers.getSetCookie());
    expect(cookies[2]).toMatch(new RegExp(`^${VAULT_UNLOCK_COOKIE}=token;.*HttpOnly`, "u"));
    expect(cookies[2]).toMatch(/SameSite=strict/iu);
    expect(await carried.json()).toEqual({ ok: true });
  });
});
