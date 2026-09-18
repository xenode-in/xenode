"use client";

import { base64URLStringToBuffer } from "@simplewebauthn/browser";
import {
  derivePasskeyWrappingKey,
  encodeBase64Url,
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
  PASSKEY_WRAP_INFO,
  type CryptoEnvelope,
  type WebAuthnPrfWrappingParams,
} from "@xenode/crypto-core";
import { authClient } from "@/lib/auth-client";
import { cacheAccountRootKey } from "@/lib/ark-cache";
import { openArkWithPassword, confirmVaultUnlock } from "@/lib/password-vault";
import { ACCOUNT_PASSKEY_PRF_INPUT } from "@/lib/passkey-constants";

type PrfOutput = {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
};

function prfResult(value: unknown): Uint8Array | null {
  const prf = (value as { prf?: PrfOutput } | undefined)?.prf;
  return prf?.results?.first ? new Uint8Array(prf.results.first) : null;
}

function prfExtensions() {
  return {
    prf: {
      eval: {
        first: base64URLStringToBuffer(ACCOUNT_PASSKEY_PRF_INPUT),
      },
    },
  } as AuthenticationExtensionsClientInputs;
}

export async function enrollAccountPasskey(params: {
  password: string;
  name: string;
}) {
  const opened = await openArkWithPassword(params.password);
  let output: Uint8Array | null = null;
  let passkeyId: string | undefined;
  try {
    const result = await authClient.passkey.addPasskey({
      name: params.name.trim() || "My passkey",
      extensions: prfExtensions(),
      returnWebAuthnResponse: true,
    });
    if (result.error || !result.data || !("webauthn" in result)) {
      throw new Error(result.error?.message ?? "Could not create the passkey.");
    }
    passkeyId = result.data.id;
    output = prfResult(result.webauthn.clientExtensionResults);
    if (!output) {
      throw new Error(
        "This authenticator cannot unlock the Xenode Vault because WebAuthn PRF is unavailable.",
      );
    }
    const hkdfSalt = encodeBase64Url(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const credentialId = result.webauthn.response.id;
    const credentialIdHash = encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(credentialId),
        ),
      ),
    );
    const wrappingKey = await derivePasskeyWrappingKey(output, hkdfSalt);
    const kdfParams: WebAuthnPrfWrappingParams = {
      algorithm: "webauthn-prf-hkdf-sha256",
      credentialIdHash,
      prfInput: ACCOUNT_PASSKEY_PRF_INPUT,
      hkdfSalt,
      info: PASSKEY_WRAP_INFO,
    };
    const envelope = {
      ...(await sealEnvelopeWithKey(opened.ark, wrappingKey, {
        accountId: opened.accountId,
        keyId: `ark:account-passkey:${credentialIdHash}`,
        keyVersion: 1,
        type: "device",
      })),
      kdfParams,
    };
    const response = await fetch("/api/account/passkeys", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        passkeyId,
        credentialId,
        expectedVaultRevision: opened.vaultRevision,
        envelope,
        prfInput: ACCOUNT_PASSKEY_PRF_INPUT,
        hkdfSalt,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(payload.error ?? "Could not bind the passkey to the Vault.");
    }
  } catch (error) {
    if (passkeyId) {
      await authClient.passkey
        .deletePasskey({ id: passkeyId })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    output?.fill(0);
    opened.ark.fill(0);
  }
}

export async function signInAndUnlockWithPasskey(): Promise<void> {
  const result = await authClient.signIn.passkey({
    extensions: prfExtensions(),
    returnWebAuthnResponse: true,
  });
  if (result.error || !result.data || !("webauthn" in result)) {
    throw new Error(result.error?.message ?? "Passkey sign-in failed.");
  }
  const output = prfResult(result.webauthn.clientExtensionResults);
  if (!output) {
    await authClient.signOut();
    throw new Error("This passkey did not provide the Vault unlock secret.");
  }
  try {
    const credentialId = result.webauthn.response.id;
    const response = await fetch(
      `/api/account/passkeys?credentialId=${encodeURIComponent(credentialId)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) throw new Error("This passkey is not bound to the Vault.");
    const payload = (await response.json()) as {
      accountId: string;
      envelope: CryptoEnvelope;
      hkdfSalt: string;
    };
    const wrappingKey = await derivePasskeyWrappingKey(
      output,
      payload.hkdfSalt,
    );
    const ark = await openEnvelopeWithKey(payload.envelope, wrappingKey, {
      accountId: payload.accountId,
      keyId: payload.envelope.keyId,
      keyVersion: payload.envelope.keyVersion,
      type: "device",
    });
    try {
      await cacheAccountRootKey(payload.accountId, ark);
      await confirmVaultUnlock("trusted-device");
    } finally {
      ark.fill(0);
    }
  } catch (error) {
    await authClient.signOut();
    throw error;
  } finally {
    output.fill(0);
  }
}
