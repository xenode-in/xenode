import { NextRequest, NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { requireAuth } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"
import { toStoredCredentialId } from "@/lib/passkey-credential-id"
import {
  getPasskeyExpectedOrigin,
  getPasskeyRpId,
} from "@/lib/passkey-rp"

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req)
    const userId = session.user.id

    const { credential, encryptedVaultKey, vaultKeyIV, nonce } = await req.json()

    if (!credential || !encryptedVaultKey || !vaultKeyIV || !nonce) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    await dbConnect()

    // 1. Get the exact challenge for this registration ceremony
    const challengeObj = await PasskeyChallenge.findOne({
      userId: userId,
      nonce,
      type: "registration",
    })

    if (!challengeObj || challengeObj.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge not found or expired" }, { status: 400 })
    }

    // 2. Verify registration response
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeObj.challenge,
      expectedOrigin: getPasskeyExpectedOrigin(),
      expectedRPID: getPasskeyRpId(),
      requireUserVerification: false,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    // 3. Save new passkey
    const { credential: regCred } = verification.registrationInfo
    const storedCredentialId = toStoredCredentialId(regCred.id)

    if (!storedCredentialId) {
      return NextResponse.json({ error: "Invalid credential ID" }, { status: 400 })
    }

    await Passkey.create({
      userId: userId,
      credentialId: storedCredentialId,
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
  } catch (err: unknown) {
    console.error("Register finish error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 })
  }
}
