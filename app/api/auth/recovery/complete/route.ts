import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import crypto from "node:crypto";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import UserKeyVault from "@/models/UserKeyVault";
import {
  hashRecoveryProof,
  verifyRecoveryToken,
} from "@/lib/auth/recovery-proof";

/**
 * app/api/auth/recovery/complete/route.ts
 * Atomic update of vault and credentials after recovery keywords verified.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      // Main Vault
      encryptedPrivateKeyB64,
      ivB64,
      passwordSaltB64,
      // Keywords Layer
      encryptedRecoveryWordsB64,
      recoveryIvB64,
      recoverySaltB64,
      // Backup Record
      encryptedPrivateKeyRecoveryB64,
      recoveryWordSaltB64,
      recoveryWordIvB64,
      // Auth
      authVerifierHex,
      authSaltB64,
      newPassword,
      recoveryToken,
      recoveryProofB64,
    } = body;

    if (
      !encryptedPrivateKeyB64 ||
      !authVerifierHex ||
      !recoveryToken ||
      !recoveryProofB64
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const recoveryPayload = verifyRecoveryToken(recoveryToken);
    if (
      !recoveryPayload ||
      hashRecoveryProof(recoveryProofB64) !== recoveryPayload.challengeHash
    ) {
      return NextResponse.json(
        { error: "Invalid or expired recovery proof" },
        { status: 401 },
      );
    }

    const userId = recoveryPayload.userId;

    await dbConnect();

    // 1. Generate Better-Auth compatible hash if newPassword is provided
    let hashedPassword = "";
    if (newPassword) {
      const salt = crypto.randomBytes(16).toString("hex");
      const normalizedPassword = newPassword.normalize("NFKC");
      const hash = crypto.scryptSync(normalizedPassword, salt, 64, {
        N: 16384,
        r: 16,
        p: 1,
        maxmem: 128 * 16384 * 16 * 2,
      });
      hashedPassword = `${salt}:${hash.toString("hex")}`;
    }

    const session = await mongoose.startSession();
    let success = false;

    try {
      await session.withTransaction(async () => {
        const now = new Date();
        const credentialEpoch = now;

        // 2. Update Vault (ALL THREE LAYERS)
        const vaultResult = await UserKeyVault.updateOne(
          { userId: userId },
          {
            $set: {
              // Main Vault
              encryptedPrivateKey: encryptedPrivateKeyB64,
              pbkdf2Salt: passwordSaltB64,
              iv: ivB64,
              // Keywords Layer
              encryptedRecoveryWords: encryptedRecoveryWordsB64,
              recoveryIv: recoveryIvB64,
              recoverySalt: recoverySaltB64,
              // Backup Record (Keywords-only)
              encryptedPrivateKeyRecovery: encryptedPrivateKeyRecoveryB64,
              recoveryWordSalt: recoveryWordSaltB64,
              recoveryWordIv: recoveryWordIvB64,
              updatedAt: now,
            },
          },
          { session },
        );
        if (vaultResult.matchedCount !== 1) {
          throw new Error("Recovery vault not found");
        }

        // 3. Update User (Auth verifiers and Session invalidation epoch)
        const userResult = await User.updateOne(
          { _id: new mongoose.Types.ObjectId(userId) },
          {
            $set: {
              authVerifier: authVerifierHex,
              authSalt: authSaltB64,
              passwordChangedAt: now,
              credentialEpoch: credentialEpoch,
            },
          },
          { session },
        );
        if (userResult.matchedCount !== 1) {
          throw new Error("User not found");
        }

        // 4. Update Account (Better-Auth Login)
        if (hashedPassword) {
          await mongoose.connection.db?.collection("account").updateOne(
            {
              userId: new mongoose.Types.ObjectId(userId),
              providerId: "credential",
            },
            {
              $set: {
                password: hashedPassword,
                updatedAt: now,
              },
            },
            { session },
          );
        }

        // 5. Invalidate Sessions
        await mongoose.connection.db
          ?.collection("session")
          .deleteMany(
            { userId: new mongoose.Types.ObjectId(userId) },
            { session },
          );
      });
      success = true;
    } catch (err) {
      console.error("Transaction failed:", err);
      throw err;
    } finally {
      session.endSession();
    }
    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }
  } catch (err) {
    console.error("Recovery complete error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
