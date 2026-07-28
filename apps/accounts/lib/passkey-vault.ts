"use client";

import {
  base64URLStringToBuffer,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import {
  derivePasskeyWrappingKey,
  encodeBase64Url,
  importProductKey,
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
  PASSKEY_WRAP_INFO,
  type CryptoEnvelope,
  type WebAuthnPrfWrappingParams,
} from "@xenode/crypto-core";
import { cacheAccountRootKey } from "@/lib/ark-cache";

type PrfOutput = {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
};

function prfResult(value: unknown): Uint8Array | null {
  const prf = (value as { prf?: PrfOutput } | undefined)?.prf;
  return prf?.results?.first
    ? new Uint8Array(prf.results.first)
    : null;
}

function sanitize<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(
  credential: T,
): T {
  const extensions = credential.clientExtensionResults as {
    prf?: PrfOutput;
  };
  return {
    ...credential,
    clientExtensionResults: {
      ...credential.clientExtensionResults,
      ...(extensions.prf
        ? { prf: { enabled: extensions.prf.enabled === true } }
        : {}),
    },
  };
}

async function credentialHash(credentialId: string) {
  return encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(credentialId),
      ),
    ),
  );
}

async function passkeyEnvelope(
  accountId: string,
  ark: Uint8Array,
  credentialIdHash: string,
  prfOutput: Uint8Array,
  prfInput: string,
  hkdfSalt: string,
) {
  const wrappingKey = await derivePasskeyWrappingKey(prfOutput, hkdfSalt);
  const kdfParams: WebAuthnPrfWrappingParams = {
    algorithm: "webauthn-prf-hkdf-sha256",
    credentialIdHash,
    prfInput,
    hkdfSalt,
    info: PASSKEY_WRAP_INFO,
  };
  return {
    ...(await sealEnvelopeWithKey(ark, wrappingKey, {
      accountId,
      keyId: `ark:passkey:${credentialIdHash}`,
      keyVersion: 1,
      type: "device",
    })),
    kdfParams,
  };
}

function decodePrfRequestOptions(options: PublicKeyCredentialRequestOptionsJSON) {
  const decoded = structuredClone(options);
  const prf = (decoded.extensions as {
    prf?: {
      evalByCredential?: Record<string, { first: string | ArrayBuffer }>;
    };
  })?.prf;
  if (prf?.evalByCredential) {
    for (const value of Object.values(prf.evalByCredential)) {
      if (typeof value.first === "string") {
        value.first = base64URLStringToBuffer(value.first);
      }
    }
  }
  return decoded;
}

export async function tryEnrollPasskey(
  accountId: string,
  ark: Uint8Array,
): Promise<CryptoEnvelope | null> {
  if (typeof PublicKeyCredential === "undefined") return null;
  try {
    const start = await fetch("/api/vault/passkeys/register/options", {
      method: "POST",
      credentials: "include",
    });
    if (!start.ok) return null;
    const payload = (await start.json()) as {
      options: PublicKeyCredentialCreationOptionsJSON;
      nonce: string;
      prfInput: string;
      hkdfSalt: string;
    };
    const options = structuredClone(payload.options);
    const extensions = options.extensions as {
      prf?: { eval?: { first?: string | ArrayBuffer } };
    };
    if (extensions.prf?.eval) {
      extensions.prf.eval.first = base64URLStringToBuffer(payload.prfInput);
    }
    const credential = await startRegistration({ optionsJSON: options });
    const hash = await credentialHash(credential.id);
    const output = prfResult(credential.clientExtensionResults);
    const envelope = output
      ? await passkeyEnvelope(
          accountId,
          ark,
          hash,
          output,
          payload.prfInput,
          payload.hkdfSalt,
        )
      : null;
    output?.fill(0);
    const finish = await fetch("/api/vault/passkeys/register/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce: payload.nonce,
        credential: sanitize(credential),
        envelope,
      }),
    });
    if (!finish.ok) return null;
    if (envelope) return envelope;

    // Some authenticators advertise PRF at creation but only produce an
    // evaluation during assertion. Activate the pending credential immediately.
    const assertionStart = await fetch("/api/vault/passkeys/unlock/options", {
      method: "POST",
      credentials: "include",
    });
    if (!assertionStart.ok) return null;
    const assertionPayload = (await assertionStart.json()) as {
      options: PublicKeyCredentialRequestOptionsJSON;
      nonce: string;
    };
    const assertion = await startAuthentication({
      optionsJSON: decodePrfRequestOptions(assertionPayload.options),
    });
    const assertionOutput = prfResult(assertion.clientExtensionResults);
    if (!assertionOutput) return null;
    const assertionEnvelope = await passkeyEnvelope(
      accountId,
      ark,
      hash,
      assertionOutput,
      payload.prfInput,
      payload.hkdfSalt,
    );
    assertionOutput.fill(0);
    const activation = await fetch("/api/vault/passkeys/unlock/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce: assertionPayload.nonce,
        credential: sanitize(assertion),
        envelope: assertionEnvelope,
      }),
    });
    if (activation.ok) return assertionEnvelope;
    await fetch(
      `/api/vault/passkeys?credentialId=${encodeURIComponent(credential.id)}`,
      { method: "DELETE", credentials: "include" },
    ).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}

export async function unlockArkWithPasskey(
  accountId: string,
): Promise<CryptoKey | null> {
  const start = await fetch("/api/vault/passkeys/unlock/options", {
    method: "POST",
    credentials: "include",
  });
  if (!start.ok) return null;
  const payload = (await start.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
    nonce: string;
  };
  const credential = await startAuthentication({
    optionsJSON: decodePrfRequestOptions(payload.options),
  });
  const output = prfResult(credential.clientExtensionResults);
  if (!output) return null;
  const verify = await fetch("/api/vault/passkeys/unlock/verify", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nonce: payload.nonce,
      credential: sanitize(credential),
    }),
  });
  if (!verify.ok) {
    output.fill(0);
    return null;
  }
  const result = (await verify.json()) as {
    envelope: CryptoEnvelope;
    wrapping: { hkdfSalt: string };
  };
  const wrappingKey = await derivePasskeyWrappingKey(
    output,
    result.wrapping.hkdfSalt,
  );
  output.fill(0);
  let ark: Uint8Array | undefined;
  try {
    ark = await openEnvelopeWithKey(result.envelope, wrappingKey, {
      accountId,
      keyId: result.envelope.keyId,
      keyVersion: result.envelope.keyVersion,
      type: "device",
    });
    await cacheAccountRootKey(accountId, ark).catch(() => undefined);
    return await importProductKey(ark);
  } finally {
    ark?.fill(0);
  }
}
