import { createHash } from "node:crypto";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  AuditEvent,
  VaultPasskey,
  VaultPasskeyChallenge,
  connectDatabase,
} from "@xenode/database";
import type {
  CryptoEnvelope,
  WebAuthnPrfWrappingParams,
} from "@xenode/crypto-core";
import { getAccountsAuth } from "@/lib/auth";
import { getAccountsWebAuthnConfig } from "@/lib/passkey-rp";
import { isAccountEnvelope } from "@/lib/vault-validation";

export async function POST(request: Request) {
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    nonce?: string;
    credential?: Parameters<typeof verifyRegistrationResponse>[0]["response"];
    envelope?: (CryptoEnvelope & { kdfParams?: WebAuthnPrfWrappingParams }) | null;
  } | null;
  if (!body?.nonce || !body.credential) {
    return Response.json(
      { error: "Invalid registration response" },
      { status: 400 },
    );
  }
  await connectDatabase();
  const challenge = await VaultPasskeyChallenge.findOne({
    nonce: body.nonce,
    accountId: session.user.id,
    type: "registration",
  });
  if (!challenge || challenge.expiresAt < new Date()) {
    return Response.json({ error: "Challenge expired" }, { status: 400 });
  }
  const { rpId, origin } = getAccountsWebAuthnConfig();
  const verification = await verifyRegistrationResponse({
    response: body.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Passkey verification failed" }, { status: 400 });
  }
  const credential = verification.registrationInfo.credential;
  if (credential.id !== body.credential.id) {
    return Response.json({ error: "Credential binding mismatch" }, { status: 400 });
  }
  const credentialIdHash = createHash("sha256")
    .update(credential.id)
    .digest("base64url");
  const expectedEnvelopeKeyId = `ark:passkey:${credentialIdHash}`;
  const params = body.envelope?.kdfParams;
  if (
    body.envelope &&
    (!isAccountEnvelope(body.envelope, session.user.id, "device") ||
      body.envelope.keyId !== expectedEnvelopeKeyId ||
      params?.algorithm !== "webauthn-prf-hkdf-sha256" ||
      params.credentialIdHash !== credentialIdHash ||
      params.prfInput !== challenge.prfInput ||
      params.hkdfSalt !== challenge.hkdfSalt)
  ) {
    return Response.json({ error: "Passkey envelope mismatch" }, { status: 400 });
  }
  const existing = await VaultPasskey.findOne({
    credentialId: credential.id,
  }).lean();
  if (existing && existing.accountId !== session.user.id) {
    return Response.json(
      { error: "Passkey is linked to another account" },
      { status: 409 },
    );
  }
  if (!existing) {
    await VaultPasskey.create({
      accountId: session.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      envelopeKeyId: expectedEnvelopeKeyId,
      prfInput: challenge.prfInput,
      hkdfSalt: challenge.hkdfSalt,
      name:
        body.credential.authenticatorAttachment === "platform"
          ? "Device passkey"
          : "Security key",
      status: body.envelope ? "active" : "pending",
    });
  } else if (existing.status === "pending" && body.envelope) {
    await VaultPasskey.updateOne(
      { credentialId: credential.id, accountId: session.user.id },
      { $set: { status: "active" } },
    );
  }
  await challenge.deleteOne();
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.passkey.enrolled",
    metadata: { method: body.credential.authenticatorAttachment ?? "unknown" },
  }).catch(() => undefined);
  return Response.json(
    {
      envelope: body.envelope ?? null,
      pending: !body.envelope,
      credentialIdHash,
    },
    { status: 201 },
  );
}
