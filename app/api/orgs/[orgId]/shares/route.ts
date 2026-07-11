import mongoose, { type Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMember } from "@/lib/orgs/access";
import { orgObjectClause, requireOrgStorageMembership } from "@/lib/orgs/storage";
import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import ShareLink from "@/models/ShareLink";
import { User } from "@/models/User";
import { normalizeShareRole } from "@/lib/orgs/shareRoles";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * GET /api/orgs/[orgId]/shares?scope=shared|with-me
 *
 * Read-only surfacing of existing share records for this org's files:
 *  - `shared`  (non-guest): org files that have an active public link or direct
 *    share — "what's shared out of the org".
 *  - `with-me` (any member, incl. guests): direct shares where the caller is a
 *    recipient — the guest's primary surface. Returns the caller's OWN encrypted
 *    key package (`wrappedShareKey` is RSA-encrypted to them; name/DEK are AES
 *    ciphertext) so the client can decrypt and preview. No plaintext, and never
 *    another recipient's key.
 * The `shared` scope stays metadata-only (ids/counts/type).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const scope = request.nextUrl.searchParams.get("scope") === "with-me" ? "with-me" : "shared";

    if (scope === "shared") {
      await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "read" });
    } else {
      await assertOrgMember({ userId: ctx.userId, orgId });
    }

    await dbConnect();
    const objectIds = (
      await StorageObject.find({ ...orgObjectClause(orgId), deletedAt: { $exists: false } })
        .select("_id")
        .lean<{ _id: Types.ObjectId }[]>()
    ).map((o) => o._id);

    if (objectIds.length === 0) return NextResponse.json({ shares: [] });

    if (scope === "with-me") {
      const direct = await DirectShare.find({
        objectId: { $in: objectIds },
        isRevoked: false,
        "recipients.recipientUserId": ctx.userId,
      })
        .populate(
          "objectId",
          "key size contentType isEncrypted mediaCategory",
        )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      // createdBy may be a better-auth `id` string or an `_id` ObjectId — match
      // both, and never cast a non-ObjectId string (which would throw).
      const ownerIds = Array.from(new Set(direct.map((d) => d.createdBy)));
      const objectIdOwners = ownerIds
        .filter((x) => mongoose.Types.ObjectId.isValid(x))
        .map((x) => new mongoose.Types.ObjectId(x));
      const owners = await User.find({
        $or: [
          { id: { $in: ownerIds } },
          ...(objectIdOwners.length ? [{ _id: { $in: objectIdOwners } }] : []),
        ],
      })
        .select("_id id name email")
        .lean();
      const ownerById = new Map<string, (typeof owners)[number]>();
      for (const o of owners) {
        const idField = (o as { id?: string }).id;
        if (idField) ownerById.set(String(idField), o);
        ownerById.set(String(o._id), o);
      }

      return NextResponse.json({
        shares: direct.map((d) => {
          const mine = d.recipients.find(
            (r) => r.recipientUserId === ctx.userId,
          );
          const object = d.objectId as unknown as {
            _id: unknown;
            key?: string;
            size?: number;
            contentType?: string;
            isEncrypted?: boolean;
            mediaCategory?: string;
          } | null;
          const owner = ownerById.get(String(d.createdBy));
          return {
            id: String(d._id),
            type: "direct" as const,
            role: normalizeShareRole(mine?.accessType),
            createdAt: d.createdAt,
            owner: owner
              ? { name: owner.name ?? null, email: owner.email ?? null }
              : null,
            // Encrypted key package + object metadata for client-side decrypt.
            wrappedShareKey: mine?.wrappedShareKey ?? null,
            shareEncryptedName: d.shareEncryptedName ?? null,
            shareEncryptedContentType: d.shareEncryptedContentType ?? null,
            shareEncryptedDEK: d.shareEncryptedDEK ?? null,
            shareKeyIv: d.shareKeyIv ?? null,
            object: object
              ? {
                  id: String(object._id),
                  key: object.key ?? "",
                  size: object.size ?? 0,
                  contentType: object.contentType ?? "application/octet-stream",
                  isEncrypted: !!object.isEncrypted,
                  mediaCategory: object.mediaCategory ?? null,
                }
              : null,
          };
        }),
      });
    }

    const [links, direct] = await Promise.all([
      ShareLink.find({
        isRevoked: false,
        $or: [
          { objectId: { $in: objectIds } },
          { "bundleItems.objectId": { $in: objectIds } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      DirectShare.find({ objectId: { $in: objectIds }, isRevoked: false })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    const shares = [
      ...links.map((l) => ({
        id: String(l._id),
        objectId: String(l.objectId),
        type: "link" as const,
        isBundle: !!l.isBundle,
        bundleName: l.bundleName ?? null,
        itemCount: l.isBundle ? l.bundleItems?.length ?? 0 : null,
        createdBy: (l as { createdBy?: string }).createdBy ?? null,
        recipientCount: null as number | null,
        createdAt: (l as { createdAt?: Date }).createdAt ?? null,
      })),
      ...direct.map((d) => ({
        id: String(d._id),
        objectId: String(d.objectId),
        type: "direct" as const,
        createdBy: d.createdBy,
        recipientCount: d.recipients.length,
        createdAt: d.createdAt,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );

    return NextResponse.json({ shares });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load shares";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
