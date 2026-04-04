import { NextRequest, NextResponse } from "next/server"
import { generateAuthenticationOptions } from "@simplewebauthn/server"
import { getServerSession } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import PasskeyChallenge from "@/models/PasskeyChallenge"
import Passkey from "@/models/Passkey"
import { randomBytes } from "crypto"
import { PRF_DOMAIN_SEP } from "@/lib/passkey-support"
import { fromStoredCredentialId } from "@/lib/passkey-credential-id"

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req)
    const userId = session?.user?.id

    await dbConnect()

    let allowCredentials = undefined
    if (userId) {
      const existingPasskeys = await Passkey.find({ userId })
      allowCredentials = existingPasskeys.map(p => ({
        id: fromStoredCredentialId(p.credentialId),
        type: "public-key" as const,
        transports: p.transports as AuthenticatorTransport[],
      }))
    }

    // 1. Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID: req.nextUrl.hostname,
      allowCredentials,
      userVerification: "preferred",
      extensions: {
        prf: {
          eval: {
            first: Buffer.from(PRF_DOMAIN_SEP).toString("base64url"),
          },
        },
      } as unknown as Parameters<typeof generateAuthenticationOptions>[0]["extensions"],
    })

    // 2. Save challenge with a nonce (to track it for non-logged in users)
    const nonce = randomBytes(32).toString("hex")
    
    await PasskeyChallenge.create({
      challenge: options.challenge,
      userId: userId || undefined,
      nonce: nonce,
      type: "authentication",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    })

    return NextResponse.json({ ...options, nonce })
  } catch (err: unknown) {
    console.error("Login start error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
