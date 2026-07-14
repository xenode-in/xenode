import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import UserKeyVault from "@/models/UserKeyVault";
import {
  hashRecoveryProof,
  issueRecoveryToken,
} from "@/lib/auth/recovery-proof";

function toPublicKeyPem(publicKeyB64: string) {
  return `-----BEGIN PUBLIC KEY-----\n${(publicKeyB64.match(/.{1,64}/g) || []).join("\n")}\n-----END PUBLIC KEY-----`;
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await dbConnect();

    // 1. Find the user by email
    const user = await User.findOne({ email: normalizedEmail }).lean();

    // 2. Fetch the vault - specifically we need the recovery bits
    const vault = user
      ? await UserKeyVault.findOne({ userId: user._id.toString() }).lean()
      : null;
    if (
      !user ||
      !vault ||
      !vault.encryptedPrivateKeyRecovery ||
      !vault.recoveryWordSalt ||
      !vault.recoveryWordIv ||
      !vault.publicKey
    ) {
      return NextResponse.json(
        { error: "Recovery is not available for this account." },
        { status: 400 }
      );
    }

    const challenge = crypto.randomBytes(32);
    const encryptedChallenge = crypto.publicEncrypt(
      {
        key: toPublicKeyPem(vault.publicKey),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      challenge,
    );
    const recoveryToken = issueRecoveryToken({
      userId: user._id.toString(),
      challengeHash: hashRecoveryProof(challenge.toString("base64")),
    });

    // 3. Return the specific recovery salt and the recovery-encrypted vault
    return NextResponse.json({
      recoverySaltB64: vault.recoveryWordSalt, // Base64 salt for keywords
      recoveryWordIvB64: vault.recoveryWordIv, // IV is stored separately
      encryptedPrivateKeyB64: vault.encryptedPrivateKeyRecovery,
      encryptedChallengeB64: encryptedChallenge.toString("base64"),
      recoveryToken,
    });
  } catch (err) {
    console.error("Recovery bootstrap error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
