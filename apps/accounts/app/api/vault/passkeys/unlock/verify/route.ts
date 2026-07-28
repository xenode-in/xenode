import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  AuditEvent,
  UserVault,
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
    credential?: Parameters<typeof verifyAuthenticationResponse>[0]["response"];
    envelope?: CryptoEnvelope & { kdfParams?: WebAuthnPrfWrappingParams };
  } | null;
  if (!body?.nonce || !body.credential) {
    return Response.json({ error: "Invalid authentication response" }, { status: 400 });
  }
  await connectDatabase();
  const [challenge, passkey] = await Promise.all([
    VaultPasskeyChallenge.findOne({
      nonce: body.nonce,
      accountId: session.user.id,
      type: "authentication",
    }),
    VaultPasskey.findOne({
      credentialId: body.credential.id,
      accountId: session.user.id,
      status: { $in: ["active", "pending"] },
    }),
  ]);
  if (!challenge || challenge.expiresAt < new Date() || !passkey) {
    return Response.json({ error: "Passkey not found or challenge expired" }, { status: 404 });
  }
  const { rpId, origin } = getAccountsWebAuthnConfig();
  const verification = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransport[],
    },
  });
  if (!verification.verified) {
    return Response.json({ error: "Passkey verification failed" }, { status: 400 });
  }
  const suppliedEnvelope = body.envelope;
  const suppliedParams = suppliedEnvelope?.kdfParams;
  if (passkey.status === "active" && suppliedEnvelope) {
    return Response.json(
      { error: "Active passkeys cannot replace their envelope" },
      { status: 409 },
    );
  }
  if (
    passkey.status === "pending" &&
    (!suppliedEnvelope ||
      !isAccountEnvelope(suppliedEnvelope, session.user.id, "device") ||
      suppliedEnvelope.keyId !== passkey.envelopeKeyId ||
      suppliedParams?.algorithm !== "webauthn-prf-hkdf-sha256" ||
      suppliedParams.prfInput !== passkey.prfInput ||
      suppliedParams.hkdfSalt !== passkey.hkdfSalt)
  ) {
    return Response.json(
      { error: "Passkey activation envelope required" },
      { status: 400 },
    );
  }
  const vault =
    passkey.status === "active"
      ? await UserVault.findOne({ accountId: session.user.id }).lean()
      : null;
  const envelope =
    suppliedEnvelope ??
    vault?.deviceEnvelopes.find(
      (value) =>
        value &&
        typeof value === "object" &&
        "keyId" in value &&
        value.keyId === passkey.envelopeKeyId,
    );
  if (!envelope) {
    return Response.json({ error: "Passkey envelope not found" }, { status: 404 });
  }
  passkey.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date();
  if (passkey.status === "pending") passkey.status = "active";
  await Promise.all([passkey.save(), challenge.deleteOne()]);
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.passkey.unlocked",
    metadata: {},
  }).catch(() => undefined);
  return Response.json({
    envelope,
    wrapping: {
      prfInput: passkey.prfInput,
      hkdfSalt: passkey.hkdfSalt,
    },
  });
}
