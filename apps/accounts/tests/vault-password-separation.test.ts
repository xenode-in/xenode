import { afterEach, describe, expect, it, vi } from "vitest";
import {
  derivePasswordWrappingKey,
  generateAccountRootKey,
  generateRecoveryMnemonic,
  openEnvelope,
  sealEnvelope,
} from "@xenode/crypto-core";

vi.mock("@/lib/ark-cache", () => ({
  cacheAccountRootKey: vi.fn(async () => undefined),
}));
vi.mock("@/lib/device-vault", () => ({
  enrollBrowserDevice: vi.fn(),
  loadBrowserDeviceArk: vi.fn(async () => null),
  createBrowserDeviceEnvelope: vi.fn(
    async (accountId: string, ark: Uint8Array) => {
      const { sealEnvelope, generateAccountRootKey } = await import(
        "@xenode/crypto-core"
      );
      const key = generateAccountRootKey();
      try {
        return await sealEnvelope(ark, key, {
          accountId,
          keyId: "ark:device:synthetic",
          keyVersion: 1,
          type: "device",
        });
      } finally {
        key.fill(0);
      }
    },
  ),
}));

import {
  confirmVaultUnlock,
  createPasswordEnvelopeForArk,
  updateVaultPassword,
  type VaultResponse,
} from "../lib/password-vault";
import { deriveArgon2id } from "../lib/argon2";
import { createAccountVault } from "../lib/vault-setup";
import { createBrowserDeviceEnvelope } from "../lib/device-vault";

const accountId = "separation-test-account";
const loginPassword = "synthetic-login-password-123";
const vaultPassword = "different-local-vault-secret-456";
const context = {
  accountId,
  keyId: "ark",
  keyVersion: 1,
  type: "password" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Vault password separation", () => {
  it("creates a new Vault with a local-only password and never calls a credential endpoint", async () => {
    const kit = await generateRecoveryMnemonic();
    const writes: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!init?.method) return Response.json({ accountId, vault: null });
        writes.push({ url, body: String(init.body) });
        return Response.json(
          url === "/api/vault" ? { vault: { vaultRevision: 1 } } : { ok: true },
        );
      }),
    );
    await createAccountVault({
      accountId,
      password: vaultPassword,
      recoverySecret: kit.secret,
    });
    expect(writes).toHaveLength(3);
    expect(
      writes.every(
        ({ url }) =>
          url === "/api/vault" || url.startsWith("/api/space-product-keys?"),
      ),
    ).toBe(true);
    const body = JSON.parse(writes.at(-1)!.body);
    expect(body.passwordMode).toBe("separate");
    expect(body.deviceEnvelopes).toEqual([]);
    expect(createBrowserDeviceEnvelope).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).not.toContain(vaultPassword);
    expect(JSON.stringify(writes)).not.toContain(kit.words);
    kit.secret.fill(0);
  }, 60_000);

  it("enrolls a persistent device wrapping key only when the browser is explicitly trusted", async () => {
    const kit = await generateRecoveryMnemonic();
    let storedVault: { deviceEnvelopes?: unknown[] } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!init?.method) return Response.json({ accountId, vault: null });
        if (url === "/api/vault") storedVault = JSON.parse(String(init.body));
        return Response.json(
          url === "/api/vault" ? { vault: { vaultRevision: 1 } } : { ok: true },
        );
      }),
    );
    await createAccountVault({
      accountId,
      password: vaultPassword,
      recoverySecret: kit.secret,
      trustDevice: true,
    });
    expect(createBrowserDeviceEnvelope).toHaveBeenCalledOnce();
    expect(storedVault?.deviceEnvelopes).toHaveLength(1);
    kit.secret.fill(0);
  }, 60_000);
  it("rewraps the same root key while sending only ciphertext, and the login password cannot open the new wrap", async () => {
    const ark = generateAccountRootKey();
    const oldEnvelope = await createPasswordEnvelopeForArk(
      accountId,
      ark,
      loginPassword,
    );
    const wrappedSharingPrivateKey = await sealEnvelope(
      new Uint8Array([1, 2, 3]),
      ark,
      { ...context, keyId: "sharing-private-key", type: "sharing-private-key" },
    );
    const data: VaultResponse = {
      accountId,
      vault: {
        vaultRevision: 4,
        passwordEnvelope: oldEnvelope,
        recoveryEnvelope: oldEnvelope,
        wrappedSharingPrivateKey,
        deviceEnvelopes: [],
      },
    };
    let written:
      | { expectedVaultRevision: number; passwordEnvelope: typeof oldEnvelope }
      | undefined;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/vault") return Response.json(data);
        requests.push(String(init?.body));
        expect(url).toBe("/api/vault/separate-password");
        written = JSON.parse(String(init?.body));
        return Response.json({ vaultRevision: 5 });
      }),
    );
    await updateVaultPassword({
      currentPassword: loginPassword,
      newPassword: vaultPassword,
    });
    expect(written?.expectedVaultRevision).toBe(4);
    expect(Object.keys(written!)).toEqual([
      "expectedVaultRevision",
      "passwordEnvelope",
    ]);
    expect(requests.join(" ")).not.toContain(loginPassword);
    expect(requests.join(" ")).not.toContain(vaultPassword);
    const key = await derivePasswordWrappingKey(
      vaultPassword,
      written!.passwordEnvelope.kdfParams,
      deriveArgon2id,
    );
    const opened = await openEnvelope(written!.passwordEnvelope, key, context);
    expect(opened).toEqual(ark);
    const authKey = await derivePasswordWrappingKey(
      loginPassword,
      written!.passwordEnvelope.kdfParams,
      deriveArgon2id,
    );
    await expect(
      openEnvelope(written!.passwordEnvelope, authKey, context),
    ).rejects.toThrow();
    ark.fill(0);
    key.fill(0);
    authKey.fill(0);
    opened.fill(0);
  }, 60_000);

  it("supports recovery without transmitting the phrase and retries an uncertain write with the same envelope and ID", async () => {
    const ark = generateAccountRootKey();
    const kit = await generateRecoveryMnemonic();
    const recoveryEnvelope = await sealEnvelope(ark, kit.secret, {
      ...context,
      type: "recovery",
    });
    const wrappedSharingPrivateKey = await sealEnvelope(
      new Uint8Array([1, 2, 3]),
      ark,
      { ...context, keyId: "sharing-private-key", type: "sharing-private-key" },
    );
    const writes: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/vault")
          return Response.json({
            accountId,
            vault: {
              vaultRevision: 2,
              recoveryEnvelope,
              wrappedSharingPrivateKey,
              deviceEnvelopes: [],
            },
          });
        writes.push(init!);
        if (writes.length === 1) throw new Error("response lost");
        return Response.json({ vaultRevision: 3, idempotent: true });
      }),
    );
    await updateVaultPassword({
      recoveryPhrase: kit.words,
      newPassword: vaultPassword,
    });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(writes[1]);
    expect(String(writes[0].body)).not.toContain(kit.words);
    expect(String(writes[0].body)).not.toContain(vaultPassword);
    const { passwordEnvelope } = JSON.parse(String(writes[0].body));
    const key = await derivePasswordWrappingKey(
      vaultPassword,
      passwordEnvelope.kdfParams,
      deriveArgon2id,
    );
    expect(await openEnvelope(passwordEnvelope, key, context)).toEqual(ark);
    ark.fill(0);
    kit.secret.fill(0);
    key.fill(0);
  }, 60_000);

  it("rejects reusing the current shared password before issuing requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      updateVaultPassword({
        currentPassword: loginPassword,
        newPassword: loginPassword,
      }),
    ).rejects.toThrow("different Vault password");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms local navigation without transmitting a password or key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await confirmVaultUnlock("password");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/vault/unlock",
      expect.objectContaining({ body: JSON.stringify({ method: "password" }) }),
    );
  });
});
