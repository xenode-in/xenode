import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isCachedKeyOwner } from "../../../../../xenode-expo/src/lib/crypto/keyOwnership";
import { isSyncConfigOwner } from "../../../../../xenode-expo/src/sync/accountScope";

const mobileRoot = path.resolve(__dirname, "../../../xenode-expo");

describe("Android account isolation", () => {
  it("rejects cached keys and sync config from another account", () => {
    expect(isCachedKeyOwner("user-a", "user-a")).toBe(true);
    expect(isCachedKeyOwner("user-a", "user-b")).toBe(false);
    expect(isCachedKeyOwner(null, "user-b")).toBe(false);

    expect(isSyncConfigOwner("user-a", "user-a")).toBe(true);
    expect(isSyncConfigOwner("user-a", "user-b")).toBe(false);
    expect(isSyncConfigOwner(undefined, "user-b")).toBe(false);
  });

  it("routes alternate logout UI paths through centralized cleanup", () => {
    const drawer = readFileSync(
      path.join(mobileRoot, "src/components/CustomDrawerContent.tsx"),
      "utf8",
    );
    const verifyEmail = readFileSync(
      path.join(mobileRoot, "src/app/(auth)/verify-email.tsx"),
      "utf8",
    );
    const secureSignOut = readFileSync(
      path.join(mobileRoot, "src/lib/secureSignOut.ts"),
      "utf8",
    );

    expect(drawer).toContain("await secureSignOut()");
    expect(verifyEmail).toContain("await secureSignOut()");
    expect(secureSignOut).toContain("clearCachedKeys()");
    expect(secureSignOut).toContain("syncEngine.clearAccount()");
    expect(secureSignOut).toContain("SyncStorage.clearAll()");
    expect(secureSignOut).toContain("SyncDb.clearAll()");
  });
});
