import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { orgObjectClause, requireOrgStorageMembership } from "@/lib/orgs/storage";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const PROJECTION =
  "size contentType mediaCategory starred createdAt lastAccessedAt bucketId isEncrypted encryptedName";
const MAX = 100;

/**
 * GET /api/orgs/[orgId]/objects/browse?scope=recent|favorites|bin
 *
 * Cross-bucket, read-only object listing for the Recent / Favorites / Bin
 * collaboration screens. `encryptedName` is AES-GCM ciphertext (decryptable only
 * with the org space key the member already holds) — no plaintext leaves the
 * server; crypto keys/DEK are never returned.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "read" });

    const scope = request.nextUrl.searchParams.get("scope") || "recent";
    const bin = scope === "bin";

    const query: Record<string, unknown> = {
      ...orgObjectClause(orgId),
      deletedAt: { $exists: bin },
      isSidecar: { $ne: true },
    };
    if (scope === "favorites") query.starred = true;

    await dbConnect();
    const rows = await StorageObject.find(query)
      .select(bin ? `${PROJECTION} deletedAt` : PROJECTION)
      .sort(scope === "recent" ? { createdAt: -1, _id: -1 } : { _id: -1 })
      .limit(MAX)
      .lean();

    return NextResponse.json({
      objects: rows.map((o) => ({
        id: String(o._id),
        size: o.size ?? 0,
        contentType: o.contentType ?? "application/octet-stream",
        mediaCategory: o.mediaCategory ?? "other",
        starred: !!o.starred,
        createdAt: o.createdAt ?? null,
        isEncrypted: !!o.isEncrypted,
        encryptedName: o.encryptedName ?? null,
        deletedAt: bin ? (o as { deletedAt?: Date }).deletedAt ?? null : null,
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to browse organization objects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
