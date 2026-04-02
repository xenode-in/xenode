import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import UserKeyVault from "@/models/UserKeyVault";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await dbConnect();

    // 1. Find the user by email
    const user = await User.findOne({ email }).lean();
    if (!user) {
      // Security: use generic error or 404
      return NextResponse.json({ error: "Invalid account" }, { status: 404 });
    }

    // 2. Fetch the vault - specifically we need the recovery bits
    const vault = await UserKeyVault.findOne({ userId: user._id.toString() }).lean();
    if (!vault || !vault.encryptedPrivateKeyRecovery) {
      return NextResponse.json(
        { error: "Recovery not configured for this account" },
        { status: 400 }
      );
    }

    // 3. Return the specific recovery salt and the recovery-encrypted vault
    return NextResponse.json({
      userId: user._id.toString(),
      recoverySaltB64: vault.recoveryWordSalt, // Base64 salt for keywords
      recoveryWordIvB64: vault.recoveryWordIv, // IV is stored separately
      encryptedPrivateKeyB64: vault.encryptedPrivateKeyRecovery,
    });
  } catch (err) {
    console.error("Recovery bootstrap error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
