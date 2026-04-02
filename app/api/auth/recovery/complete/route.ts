import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import crypto from "node:crypto";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import UserKeyVault from "@/models/UserKeyVault";

/**
 * app/api/auth/recovery/complete/route.ts
 * Atomic update of vault and credentials after recovery keywords verified.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      userId,
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
    } = body;

    if (!userId || !encryptedPrivateKeyB64 || !authVerifierHex) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

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
        await UserKeyVault.updateOne(
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

        // 3. Update User (Auth verifiers and Session invalidation epoch)
        await User.updateOne(
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
