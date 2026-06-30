import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import type { IDirectShareRecipient } from "@/models/DirectShare";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();

    const shares = await DirectShare.find({
      "recipients.recipientUserId": ctx.userId,
      isRevoked: false,
    })
      .populate("objectId", "key size contentType isEncrypted encryptedName thumbnail")
      .sort({ createdAt: -1 })
      .lean();

    const ownerIds = Array.from(new Set(shares.map((share) => share.createdBy)));
    const owners = await User.find({ _id: { $in: ownerIds } })
      .select("_id name email")
      .lean();
    const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]));

    const result = shares.map((share) => ({
      ...share,
      owner: ownerMap.get(String(share.createdBy))
        ? {
            id: String(ownerMap.get(String(share.createdBy))!._id),
            name: ownerMap.get(String(share.createdBy))!.name,
            email: ownerMap.get(String(share.createdBy))!.email,
          }
        : null,
      recipient: ((share.recipients || []) as IDirectShareRecipient[]).find(
        (recipient) => recipient.recipientUserId === ctx.userId,
      ),
    }));

    return NextResponse.json({ directShares: result });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
