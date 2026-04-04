import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { makeSignature } from "better-auth/crypto";
import { getAuth } from "@/lib/auth";
import dbConnect from "@/lib/mongodb";
import PasskeyChallenge from "@/models/PasskeyChallenge";
import Passkey from "@/models/Passkey";
import UserKeyVault from "@/models/UserKeyVault";
import {
  fromStoredCredentialId,
  toLegacyStoredCredentialId,
  toStoredCredentialId,
} from "@/lib/passkey-credential-id";

export async function POST(req: NextRequest) {
  try {
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

    const verificationCredentialId = fromStoredCredentialId(
      passkey.credentialId,
    );

    // 3. Verify authentication response
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeObj.challenge,
      expectedOrigin: req.nextUrl.origin,
      expectedRPID: req.nextUrl.hostname,
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

    // 5. Create Better Auth session (Manually)
    const auth = getAuth();
    const ctx = await auth.$context;

    // Create session using internal adapter
    const session = await ctx.internalAdapter.createSession(
      passkey.userId,
      false,
      {
        userAgent: req.headers.get("user-agent") ?? undefined,
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      },
    );

    if (!session) {
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 },
      );
    }

    // 6. Get vault info to return
    const vault = await UserKeyVault.findOne({ userId: passkey.userId });

    const response = NextResponse.json({
      success: true,
      hasVault: !!vault,
      encryptedVaultKey: passkey.encryptedVaultKey,
      vaultKeyIV: passkey.vaultKeyIV,
      publicKey: vault?.publicKey,
    });

    const sessionCookie = ctx.authCookies.sessionToken;
    const signedToken = `${session.token}.${await makeSignature(
      session.token,
      ctx.secret,
    )}`;

    response.cookies.set({
      name: sessionCookie.name,
      value: signedToken,
      httpOnly: sessionCookie.attributes.httpOnly,
      sameSite: sessionCookie.attributes.sameSite?.toLowerCase() as
        | "none"
        | "lax"
        | "strict"
        | undefined,
      secure: sessionCookie.attributes.secure,
      path: sessionCookie.attributes.path,
      domain: sessionCookie.attributes.domain,
    });

    // 7. Cleanup challenge
    await PasskeyChallenge.deleteOne({ _id: challengeObj._id });

    return response;
  } catch (err: unknown) {
    console.error("Login finish error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
