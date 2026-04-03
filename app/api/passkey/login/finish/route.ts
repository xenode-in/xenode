import { NextRequest, NextResponse } from "next/server"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import { getAuth } from "@/lib/auth"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"
import UserKeyVault from "@/models/UserKeyVault"

export async function POST(req: NextRequest) {
  try {
    const { credential, nonce } = await req.json()

    if (!credential || !nonce) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    await dbConnect()

    // 1. Get challenge by nonce
    const challengeObj = await PasskeyChallenge.findOne({
      nonce: nonce,
      type: "authentication",
    })

    if (!challengeObj || challengeObj.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge not found or expired" }, { status: 400 })
    }

    // 2. Find passkey by credentialId
    const passkey = await Passkey.findOne({ credentialId: credential.id })
    if (!passkey) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 })
    }

    // 3. Verify authentication response
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeObj.challenge,
      expectedOrigin: req.nextUrl.origin,
      expectedRPID: req.nextUrl.hostname,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
      },
    })

    if (!verification.verified) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    // 4. Update counter
    passkey.counter = verification.authenticationInfo.newCounter
    await passkey.save()

    // 5. Create Better Auth session (Manually)
    const auth = getAuth()
    const ctx = await auth.$context
    
    // Create session using internal adapter
    const session = await ctx.internalAdapter.createSession(passkey.userId, false, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    })

    if (!session) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    // 6. Get vault info to return
    const vault = await UserKeyVault.findOne({ userId: passkey.userId })
    
    const response = NextResponse.json({
      success: true,
      hasVault: !!vault,
      encryptedVaultKey: passkey.encryptedVaultKey,
      vaultKeyIV: passkey.vaultKeyIV,
      publicKey: vault?.publicKey,
    })

    // Set cookie from Better Auth session
    const cookie = session.token
    response.headers.set('Set-Cookie', `better-auth.session-token=${cookie}; Path=/; HttpOnly; SameSite=Lax; Secure`)

    // 7. Cleanup challenge
    await PasskeyChallenge.deleteOne({ _id: challengeObj._id })

    return response
  } catch (err: any) {
    console.error("Login finish error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
