import { assertSpaceAction, personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { queuePhotoUploadAbort } from "@xenode/database";

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { uploadId?: unknown } | null;
  if (typeof body?.uploadId !== "string" || !body.uploadId) {
    return Response.json({ error: "uploadId required" }, { status: 400 });
  }
  try {
    const spaceId = personalSpaceId(session.accountId);
    const access = await resolveSpaceAccess({
      accountId: session.accountId, spaceId, productId: "photos",
    });
    assertSpaceAction(access, "write");
    const result = await queuePhotoUploadAbort({
      uploadId: body.uploadId, accountId: session.accountId, spaceId,
    });
    if (result.status !== "queued") {
      return Response.json(
        { error: result.status === "blocked"
          ? "Upload is referenced by a stored object"
          : "Photo upload is no longer abortable" },
        { status: 409 },
      );
    }
    return Response.json({ cancelled: true, cleanupPending: true, cleanupAfter: result.cleanupAfter.toISOString() }, { status: 202 });
  } catch {
    return Response.json({ error: "Photo upload could not be aborted" }, { status: 500 });
  }
}
