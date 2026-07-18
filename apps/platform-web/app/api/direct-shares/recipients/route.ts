import { NextRequest, NextResponse } from "next/server";
import { UserVault } from "@xenode/database";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const { emails } = await request.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: "At least one email is required" }, { status: 400 });
    }

    const normalized = Array.from(
      new Set(
        emails
          .map((email) => String(email).trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    await dbConnect();

    const users = await User.find({ email: { $in: normalized } })
      .select("_id email")
      .lean();

    const userIds = users.map((user) => String(user._id));
    const vaults = await UserVault.find({ accountId: { $in: userIds } })
      .select("accountId sharingPublicKey")
      .lean();

    const vaultByUserId = new Map(
      vaults.map((vault) => [vault.accountId, vault.sharingPublicKey]),
    );
    const userByEmail = new Map(
      users.map((user) => [String(user.email).toLowerCase(), user]),
    );

    const recipients: Array<{ userId: string; email: string; publicKey: string }> = [];
    const unavailable: Array<{ email: string; reason: string }> = [];

    for (const email of normalized) {
      if (email === String(ctx.session.user.email || "").toLowerCase()) {
        unavailable.push({ email, reason: "You cannot share a file with your own account" });
        continue;
      }

      const user = userByEmail.get(email);
      if (!user) {
        unavailable.push({ email, reason: "No Xenode account found for this email" });
        continue;
      }

      const publicKey = vaultByUserId.get(String(user._id));
      if (!publicKey) {
        unavailable.push({ email, reason: "Recipient has not set up their encryption vault yet" });
        continue;
      }

      recipients.push({
        userId: String(user._id),
        email: String(user.email).toLowerCase(),
        publicKey,
      });
    }

    return NextResponse.json({ recipients, unavailable });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
