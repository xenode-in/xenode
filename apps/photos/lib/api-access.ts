import { getServerProductOrigin } from "@xenode/config";
import { isCrossOriginProductRequest } from "@xenode/identity-core";
import {
  personalSpaceId,
  resolveSpaceAccess,
  assertSpaceAction,
  type SpaceAction,
  SpaceAuthorizationError,
} from "@xenode/spaces";
import {
  connectDatabase,
  PhotoUploadCommitError,
  DriveUploadCommitError,
} from "@xenode/database";
import { spaceIdSchema } from "@xenode/contracts";
import { getPhotosProductSession } from "./session";
export async function requirePhotoAccess(
  request: Request,
  action: SpaceAction = "read",
) {
  if (isCrossOriginProductRequest(request, getServerProductOrigin("photos")))
    throw new PhotoUploadCommitError(
      403,
      "cross_origin",
      "Cross-origin Photos API requests are forbidden",
    );
  const session = await getPhotosProductSession();
  if (!session)
    throw new PhotoUploadCommitError(401, "unauthorized", "Unauthorized");
  const parsed = spaceIdSchema.safeParse(
    new URL(request.url).searchParams.get("spaceId") ??
      personalSpaceId(session.accountId),
  );
  if (!parsed.success)
    throw new PhotoUploadCommitError(
      400,
      "invalid_space",
      "Invalid Photos Space",
    );
  const spaceId = parsed.data;
  await connectDatabase();
  const access = await resolveSpaceAccess({
    accountId: session.accountId,
    spaceId,
    productId: "photos",
  });
  assertSpaceAction(access, action);
  return { session, spaceId, accountId: session.accountId };
}
export function photoApiError(error: unknown) {
  if (
    error instanceof PhotoUploadCommitError ||
    error instanceof DriveUploadCommitError ||
    error instanceof SpaceAuthorizationError
  )
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  return Response.json(
    { error: "Photo operation unavailable" },
    { status: 503 },
  );
}
