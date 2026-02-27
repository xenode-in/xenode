import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/vault
 * Returns the full vault for the authenticated user.
 * 404 if no vault set up yet.
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
      vaultType: vault.vaultType ?? "passphrase",

      // Passphrase path
      encryptedPrivKeyPassphrase: vault.encryptedPrivKeyPassphrase ?? null,
      passphraseIv: vault.passphraseIv ?? null,
      pbkdf2Salt: vault.pbkdf2Salt,

      // PRF path
      encryptedPrivKeyPRF: vault.encryptedPrivKeyPRF ?? null,
      prfIv: vault.prfIv ?? null,
      prfSalt: vault.prfSalt ?? null,
      credentialId: vault.credentialId ?? null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/keys/vault
 * Create (or replace) a vault.
 *
 * vaultType 'prf'        → requires: publicKey, pbkdf2Salt, encryptedPrivKeyPRF, prfIv, prfSalt, credentialId
 * vaultType 'passphrase' → requires: publicKey, encryptedPrivKeyPassphrase, passphraseIv, pbkdf2Salt
 * vaultType 'both'       → requires all of the above
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const body = await request.json();
    const {
      publicKey,
      pbkdf2Salt,
      // Passphrase path
      encryptedPrivKeyPassphrase,
      passphraseIv,
      // PRF path
      encryptedPrivKeyPRF,
      prfIv,
      prfSalt,
      credentialId,
      vaultType,
    } = body;

    if (!publicKey || !pbkdf2Salt) {
      return NextResponse.json(
        { error: "publicKey and pbkdf2Salt are required" },
        { status: 400 },
      );
    }

    const type = vaultType ?? "passphrase";

    // Validate required fields per vault type
    if (type === "passphrase" || type === "both") {
      if (!encryptedPrivKeyPassphrase || !passphraseIv) {
        return NextResponse.json(
          { error: "encryptedPrivKeyPassphrase and passphraseIv required for passphrase vault" },
          { status: 400 },
        );
      }
    }
    if (type === "prf" || type === "both") {
      if (!encryptedPrivKeyPRF || !prfIv || !prfSalt || !credentialId) {
        return NextResponse.json(
          { error: "encryptedPrivKeyPRF, prfIv, prfSalt, credentialId required for prf vault" },
          { status: 400 },
        );
      }
    }

    await dbConnect();

    await UserKeyVault.findOneAndUpdate(
      { userId },
      {
        userId,
        publicKey,
        pbkdf2Salt,
        vaultType: type,
        ...(encryptedPrivKeyPassphrase && { encryptedPrivKeyPassphrase }),
        ...(passphraseIv && { passphraseIv }),
        ...(encryptedPrivKeyPRF && { encryptedPrivKeyPRF }),
        ...(prfIv && { prfIv }),
        ...(prfSalt && { prfSalt }),
        ...(credentialId && { credentialId }),
      },
      { upsert: true, new: true },
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
