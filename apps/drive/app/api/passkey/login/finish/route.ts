import { NextRequest, NextResponse } from "next/server";
import { UserVault } from "@xenode/database";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PasskeyChallenge from "@/models/PasskeyChallenge";
import Passkey from "@/models/Passkey";
import {
  fromStoredCredentialId,
  toLegacyStoredCredentialId,
  toStoredCredentialId,
} from "@/lib/passkey-credential-id";
import {
  getPasskeyExpectedOrigin,
  getPasskeyRpId,
} from "@/lib/passkey-rp";

/**
 * Complete a passkey (PRF) assertion for VAULT UNLOCK.
 *
 * Post OIDC cutover, Drive no longer mints sessions of any kind — login
 * lives at the Accounts hub. This ceremony now requires an existing Drive
 * ProductSession and only proves possession of a passkey registered to that
 * same account, returning the wrapped vault-key material for client-side
 * unlock.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const { credential, nonce } = await req.json();
    if (!credential || !nonce) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await dbConnect();

    // 1. Get challenge by nonce
    const challengeObj = await PasskeyChallenge.findOne({
      nonce: nonce,
      type: "authentication",
    });

    if (!challengeObj || challengeObj.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Challenge not found or expired" },
        { status: 400 },
      );
    }

    const incomingCredentialId = toStoredCredentialId(credential.id);
    if (!incomingCredentialId) {
      return NextResponse.json(
        { error: "Invalid credential ID" },
        { status: 400 },
      );
    }

    // 2. Find passkey by credentialId, supporting legacy double-encoded records
    const passkey = await Passkey.findOne({
      credentialId: {
        $in: [
          incomingCredentialId,
          toLegacyStoredCredentialId(incomingCredentialId),
        ],
      },
    });

    if (!passkey) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }

    // Vault unlock must not cross accounts: the asserted passkey has to
    // belong to the caller's own Drive session.
    if (passkey.userId !== session.user.id) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }

    const verificationCredentialId = fromStoredCredentialId(
      passkey.credentialId,
    );

    // 3. Verify authentication response
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeObj.challenge,
      expectedOrigin: getPasskeyExpectedOrigin(),
      expectedRPID: getPasskeyRpId(),
      requireUserVerification: false,
      credential: {
        id: verificationCredentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
      },
    });

    if (!verification.verified) {
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 400 },
      );
    }

    // 4. Update counter
    if (passkey.credentialId !== incomingCredentialId) {
      passkey.credentialId = incomingCredentialId;
    }
    passkey.counter = verification.authenticationInfo.newCounter;
    await passkey.save();

    // 5. Return vault-unlock material — no session is minted here.
    const vault = await UserVault.findOne({ accountId: passkey.userId }).lean();

    const response = NextResponse.json({
      success: true,
      hasVault: !!vault,
      encryptedVaultKey: passkey.encryptedVaultKey,
      vaultKeyIV: passkey.vaultKeyIV,
      publicKey: vault?.sharingPublicKey,
    });

    // 6. Cleanup challenge
    await PasskeyChallenge.deleteOne({ _id: challengeObj._id });

    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Passkey unlock finish error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
