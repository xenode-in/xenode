import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  assertObjectAccess,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import { MAX_VERSIONS_PER_OBJECT } from "@/lib/storage/versions";
import type { IStorageObjectVersion } from "@/models/StorageObject";

export const dynamic = "force-dynamic";

/**
 * GET /api/objects/[id]/versions
 * List an object's retained version history (newest first). The current content
 * is NOT included — only prior snapshots. Filenames stay encrypted; the client
 * decrypts as needed. Download a specific version via
 * `GET /api/objects/[id]/content?version=<versionId>`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;

    const object = await assertObjectAccess(ctx, id, "read", { lean: true });
    const versions = (object.versions || []) as IStorageObjectVersion[];

    return NextResponse.json({
      maxVersions: MAX_VERSIONS_PER_OBJECT,
      versions: versions.map((v) => ({
        versionId: v.versionId,
        size: v.size,
        contentType: v.contentType ?? null,
        isEncrypted: !!v.encryptedDEK || !!v.iv,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
        // Wrapped crypto so the owner can decrypt a downloaded version client-
        // side. These are the same encrypted/wrapped values the main object
        // endpoint returns — never plaintext keys.
        encryptedDEK: v.encryptedDEK ?? null,
        iv: v.iv ?? null,
        chunkSize: v.chunkSize ?? null,
        chunkCount: v.chunkCount ?? null,
        chunkIvs: v.chunkIvs ?? null,
      })),
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
