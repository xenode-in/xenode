import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import UserKeyVault from "@/models/UserKeyVault";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/vault
 * Returns the authenticated user's encrypted key vault.
 * Returns 404 if no vault has been set up yet (first-time user).
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
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/keys/vault
 * Create or replace the authenticated user's encrypted key vault.
 * Body: { publicKey, encryptedPrivateKey, pbkdf2Salt, iv }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const { publicKey, encryptedPrivateKey, pbkdf2Salt, iv } =
      await request.json();

    if (!publicKey || !encryptedPrivateKey || !pbkdf2Salt || !iv) {
      return NextResponse.json(
        {
          error:
            "publicKey, encryptedPrivateKey, pbkdf2Salt, and iv are required",
        },
        { status: 400 },
      );
    }

    await dbConnect();

    // Upsert — one vault per user
    await UserKeyVault.findOneAndUpdate(
      { userId },
      { userId, publicKey, encryptedPrivateKey, pbkdf2Salt, iv },
      { upsert: true, new: true },
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
