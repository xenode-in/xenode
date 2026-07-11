import { NextRequest, NextResponse } from "next/server";
import {
  assertObjectAccess,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { snapshotCurrentAsVersion } from "@/lib/storage/versions";

export const dynamic = "force-dynamic";

/**
 * Pin the closest available source ciphertext as the immutable original.
 *
 * New files point the original entry at the current B2 object without copying
 * bytes or changing metering. Files already edited before this feature pin the
 * oldest retained snapshot, which is the closest source still available.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    const object = await assertObjectAccess(ctx, id, "write");
    const versions = object.versions ?? [];

    const existingOriginal = versions.find((version) => version.isOriginal);
    if (existingOriginal) {
      return NextResponse.json({
        success: true,
        versionId: existingOriginal.versionId,
        alreadyPinned: true,
      });
    }

    if (versions.length > 0) {
      versions[versions.length - 1].isOriginal = true;
      versions[versions.length - 1].sharesCurrentContent =
        versions[versions.length - 1].key === object.key;
      object.versions = versions;
    } else {
      object.versions = [
        snapshotCurrentAsVersion(object, ctx.userId, {
          isOriginal: true,
          sharesCurrentContent: true,
        }),
      ];
    }

    await object.save();
    const original = object.versions?.find((version) => version.isOriginal);
    return NextResponse.json({
      success: true,
      versionId: original?.versionId ?? null,
      alreadyPinned: false,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to protect original";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
