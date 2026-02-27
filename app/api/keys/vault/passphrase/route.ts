import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/keys/vault/passphrase
 * Add (or replace) the passphrase layer on an existing PRF vault.
 * Called when a PRF-only user sets a passphrase backup.
 * vaultType becomes 'both'.
 *
 * Body: { encryptedPrivKeyPassphrase, passphraseIv, pbkdf2Salt }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const { encryptedPrivKeyPassphrase, passphraseIv, pbkdf2Salt } = await request.json();

    if (!encryptedPrivKeyPassphrase || !passphraseIv || !pbkdf2Salt) {
      return NextResponse.json(
        { error: "encryptedPrivKeyPassphrase, passphraseIv, pbkdf2Salt are required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const vault = await UserKeyVault.findOne({ userId });
    if (!vault) {
      return NextResponse.json(
        { error: "No vault found." },
        { status: 404 },
      );
    }

    await UserKeyVault.findOneAndUpdate(
      { userId },
      {
        encryptedPrivKeyPassphrase,
        passphraseIv,
        pbkdf2Salt,
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
