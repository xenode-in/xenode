import { NextRequest, NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { requireAuth } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req)
    const userId = session.user.id
    const userEmail = session.user.email

    await dbConnect()

    // 1. Get existing passkeys to exclude them
    const existingPasskeys = await Passkey.find({ userId })

    // 2. Generate registration options
    const options = await generateRegistrationOptions({
      rpName: "Xenode",
      rpID: req.nextUrl.hostname,
      userID: Buffer.from(userId),
      userName: userEmail,
      userDisplayName: session.user.name || userEmail,
      attestationType: "none",
      excludeCredentials: existingPasskeys.map(p => ({
        id: p.credentialId,
        type: "public-key",
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
      extensions: {
        prf: {},
      } as any,
    })

    // 3. Save challenge
    await PasskeyChallenge.create({
      challenge: options.challenge,
      userId: userId,
      type: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    })

    return NextResponse.json(options)
  } catch (err: any) {
    console.error("Register start error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: err.message === "Unauthorized" ? 401 : 500 })
  }
}
