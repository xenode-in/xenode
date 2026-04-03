import { NextRequest, NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { requireAuth } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req)
    const userId = session.user.id

    const { credential, encryptedVaultKey, vaultKeyIV } = await req.json()

    if (!credential || !encryptedVaultKey || !vaultKeyIV) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    await dbConnect()

    // 1. Get and delete challenge
    const challengeObj = await PasskeyChallenge.findOne({
      userId: userId,
      type: "registration",
    }).sort({ createdAt: -1 })

    if (!challengeObj || challengeObj.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge not found or expired" }, { status: 400 })
    }

    // 2. Verify registration response
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeObj.challenge,
      expectedOrigin: req.nextUrl.origin,
      expectedRPID: req.nextUrl.hostname,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    // 3. Save new passkey
    const { credential: regCred } = verification.registrationInfo

    await Passkey.create({
      userId: userId,
      credentialId: Buffer.from(regCred.id).toString("base64url"),
      publicKey: Buffer.from(regCred.publicKey),
      counter: regCred.counter,
      transports: regCred.transports || [],
      encryptedVaultKey,
      vaultKeyIV,
      name: credential.authenticatorAttachment === 'platform' ? 'Biometrics' : 'Security Key',
    })

    // 4. Cleanup challenge
    await PasskeyChallenge.deleteOne({ _id: challengeObj._id })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("Register finish error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: err.message === "Unauthorized" ? 401 : 500 })
  }
}
