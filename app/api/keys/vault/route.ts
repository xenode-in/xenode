import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/** GET /api/keys/vault */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    await dbConnect();

    const vault = await UserKeyVault.findOne({ userId });
    if (!vault) {
      return NextResponse.json({ error: "Vault not found" }, { status: 404 });
    }

    return NextResponse.json({
      publicKey: vault.publicKey,
      encryptedPrivateKey: vault.encryptedPrivateKey,
      vaultVersion: vault.vaultVersion,
      vaultHmac: vault.vaultHmac,
      pbkdf2Salt: vault.pbkdf2Salt,
      iv: vault.iv,
      encryptedRecoveryWords: vault.encryptedRecoveryWords,
      recoveryIv: vault.recoveryIv,
      recoverySalt: vault.recoverySalt,
      encryptedPrivateKeyRecovery: vault.encryptedPrivateKeyRecovery,
      recoveryWordSalt: vault.recoveryWordSalt,
      recoveryWordIv: vault.recoveryWordIv,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/keys/vault - Create or replace the vault */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;

    const {
      publicKey, encryptedPrivateKey, vaultVersion, vaultHmac, pbkdf2Salt, iv,
      encryptedRecoveryWords, recoveryIv, recoverySalt,
      encryptedPrivateKeyRecovery, recoveryWordSalt, recoveryWordIv,
    } = await request.json();

    if (!publicKey || !encryptedPrivateKey || !pbkdf2Salt || !iv || !encryptedRecoveryWords || !recoveryIv || !recoverySalt) {
      return NextResponse.json({ error: "Missing required vault fields" }, { status: 400 });
    }

    await dbConnect();

    await UserKeyVault.findOneAndUpdate(
      { userId },
      { 
        userId, publicKey, encryptedPrivateKey, vaultVersion, vaultHmac, 
        pbkdf2Salt, iv, encryptedRecoveryWords, recoveryIv, recoverySalt, 
        encryptedPrivateKeyRecovery, recoveryWordSalt, recoveryWordIv 
      },
      { upsert: true, new: true },
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
