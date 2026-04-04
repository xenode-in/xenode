import { NextRequest, NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { requireAuth } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"
import { PRF_DOMAIN_SEP } from "@/lib/passkey-support"
import { randomBytes } from "crypto"
import { fromStoredCredentialId } from "@/lib/passkey-credential-id"

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
        id: fromStoredCredentialId(p.credentialId),
        type: "public-key",
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
      extensions: {
        prf: {
          eval: {
            first: Buffer.from(PRF_DOMAIN_SEP).toString("base64url"),
          },
        },
      } as unknown as Parameters<typeof generateRegistrationOptions>[0]["extensions"],
    })

    // 3. Save challenge with a nonce so finish can verify the exact ceremony
    const nonce = randomBytes(32).toString("hex")
    await PasskeyChallenge.create({
      challenge: options.challenge,
      userId: userId,
      nonce,
      type: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    })

    return NextResponse.json({ ...options, nonce })
  } catch (err: unknown) {
    console.error("Register start error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 })
  }
}
