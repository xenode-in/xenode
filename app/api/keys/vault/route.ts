import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/vault
 * Returns the full vault including encrypted recovery words.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    await dbConnect();

    const vault = await UserKeyVault.findOne({ userId });
    if (!vault) {
      return NextResponse.json({ error: "Vault not found" }, { status: 404 });
    }

    return NextResponse.json({
      publicKey: vault.publicKey,
      encryptedPrivateKey: vault.encryptedPrivateKey,
      pbkdf2Salt: vault.pbkdf2Salt,
      iv: vault.iv,
      encryptedRecoveryWords: vault.encryptedRecoveryWords,
      recoveryIv: vault.recoveryIv,
      recoverySalt: vault.recoverySalt,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/keys/vault
 * Create or replace the vault.
 * Body: { publicKey, encryptedPrivateKey, pbkdf2Salt, iv, encryptedRecoveryWords, recoveryIv, recoverySalt }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const {
      publicKey,
      encryptedPrivateKey,
      pbkdf2Salt,
      iv,
      encryptedRecoveryWords,
      recoveryIv,
      recoverySalt,
    } = await request.json();

    if (!publicKey || !encryptedPrivateKey || !pbkdf2Salt || !iv || !encryptedRecoveryWords || !recoveryIv || !recoverySalt) {
      return NextResponse.json(
        { error: "Missing required vault fields" },
        { status: 400 },
      );
    }

    await dbConnect();

    await UserKeyVault.findOneAndUpdate(
      { userId },
      { userId, publicKey, encryptedPrivateKey, pbkdf2Salt, iv, encryptedRecoveryWords, recoveryIv, recoverySalt },
      { upsert: true, new: true },
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
