import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/keys/vault/prf
 * Add (or replace) the PRF layer on an existing vault.
 * Called from Settings when user adds a passkey after initial setup.
 * Requires the vault to already exist (POST /api/keys/vault first).
 *
 * Body: { encryptedPrivKeyPRF, prfIv, prfSalt, credentialId }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const { encryptedPrivKeyPRF, prfIv, prfSalt, credentialId } =
      await request.json();

    if (!encryptedPrivKeyPRF || !prfIv || !prfSalt || !credentialId) {
      return NextResponse.json(
        { error: "encryptedPrivKeyPRF, prfIv, prfSalt, credentialId are required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const vault = await UserKeyVault.findOne({ userId });
    if (!vault) {
      return NextResponse.json(
        { error: "No vault found. Set up passphrase vault first." },
        { status: 404 },
      );
    }

    await UserKeyVault.findOneAndUpdate(
      { userId },
      {
        encryptedPrivKeyPRF,
        prfIv,
        prfSalt,
        credentialId,
        vaultType: "both",
      },
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
