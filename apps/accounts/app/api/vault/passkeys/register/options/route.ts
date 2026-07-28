import { randomBytes } from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  VaultPasskey,
  VaultPasskeyChallenge,
  connectDatabase,
} from "@xenode/database";
import { encodeBase64Url } from "@xenode/crypto-core";
import { getAccountsAuth } from "@/lib/auth";
import { getAccountsWebAuthnConfig } from "@/lib/passkey-rp";

export async function POST(request: Request) {
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const existing = await VaultPasskey.find({
    accountId: session.user.id,
    status: "active",
  }).lean();
  const { rpId, rpName } = getAccountsWebAuthnConfig();
  const prfInput = encodeBase64Url(randomBytes(32));
  const hkdfSalt = encodeBase64Url(randomBytes(32));
  const options = await generateRegistrationOptions({
    rpID: rpId,
    rpName,
    userID: Buffer.from(session.user.id),
    userName: session.user.email,
    userDisplayName: session.user.name || session.user.email,
    attestationType: "none",
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    extensions: {
      prf: { eval: { first: prfInput } },
    } as never,
  });
  const nonce = encodeBase64Url(randomBytes(32));
  await VaultPasskeyChallenge.create({
    nonce,
    accountId: session.user.id,
    challenge: options.challenge,
    type: "registration",
    prfInput,
    hkdfSalt,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  return Response.json({ options, nonce, prfInput, hkdfSalt });
}
