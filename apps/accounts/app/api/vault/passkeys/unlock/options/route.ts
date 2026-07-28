import { randomBytes } from "node:crypto";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
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
  const passkeys = await VaultPasskey.find({
    accountId: session.user.id,
    status: { $in: ["active", "pending"] },
  }).lean();
  if (!passkeys.length) {
    return Response.json({ error: "No passkey enrolled" }, { status: 404 });
  }
  const { rpId } = getAccountsWebAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "required",
    allowCredentials: passkeys.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransport[],
    })),
    extensions: {
      prf: {
        evalByCredential: Object.fromEntries(
          passkeys.map((credential) => [
            credential.credentialId,
            { first: credential.prfInput },
          ]),
        ),
      },
    } as never,
  });
  const nonce = encodeBase64Url(randomBytes(32));
  await VaultPasskeyChallenge.create({
    nonce,
    accountId: session.user.id,
    challenge: options.challenge,
    type: "authentication",
    prfInput: "-",
    hkdfSalt: "-",
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  return Response.json({ options, nonce });
}
