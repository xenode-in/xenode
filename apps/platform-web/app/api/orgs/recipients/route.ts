import { NextRequest, NextResponse } from "next/server";
import { UserVault } from "@xenode/database";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { assertOrganizationsEnabled } from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

interface UserLookup {
  _id?: unknown;
  id?: string;
  email?: string;
  name?: string;
}

function authUserId(user: UserLookup): string {
  return user.id || String(user._id ?? "");
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const { emails } = await request.json().catch(() => ({}));

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: "At least one email is required" },
        { status: 400 },
      );
    }

    const normalized = Array.from(
      new Set(
        emails
          .map((email) => String(email).trim().toLowerCase())
          .filter(Boolean),
      ),
    ).slice(0, 25);

    await dbConnect();
    const users = await User.find({ email: { $in: normalized } })
      .select("_id id email name")
      .lean<UserLookup[]>();
    const userIds = users.map(authUserId).filter(Boolean);
    const vaults = await UserVault.find({ accountId: { $in: userIds } })
      .select("accountId sharingPublicKey")
      .lean<Array<{ accountId: string; sharingPublicKey: string }>>();

    const vaultByUserId = new Map(
      vaults.map((vault) => [vault.accountId, vault.sharingPublicKey]),
    );
    const userByEmail = new Map(
      users.map((user) => [String(user.email).toLowerCase(), user]),
    );

    const recipients: Array<{
      userId: string;
      email: string;
      name: string | null;
      publicKey: string;
    }> = [];
    const unavailable: Array<{ email: string; reason: string }> = [];
    const currentEmail = String(ctx.session.user.email || "").toLowerCase();

    for (const email of normalized) {
      if (email === currentEmail) {
        unavailable.push({
          email,
          reason: "You cannot invite your own account",
        });
        continue;
      }

      const user = userByEmail.get(email);
      const userId = user ? authUserId(user) : "";
      if (!user || !userId) {
        unavailable.push({
          email,
          reason: "No Xenode account found for this email",
        });
        continue;
      }

      const publicKey = vaultByUserId.get(userId);
      if (!publicKey) {
        unavailable.push({
          email,
          reason: "Recipient has not set up their encryption vault yet",
        });
        continue;
      }

      recipients.push({
        userId,
        email: String(user.email).toLowerCase(),
        name: user.name ?? null,
        publicKey,
      });
    }

    return NextResponse.json({ recipients, unavailable });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
