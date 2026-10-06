import { queuePhotoAssetPurge } from "@xenode/database";
import { requirePhotoAccess, photoApiError } from "@/lib/api-access";
export async function POST(request: Request) {
  try {
    const ctx = await requirePhotoAccess(request, "manage");
    const body = await request.json().catch(() => null);
    const result = await queuePhotoAssetPurge({
      accountId: ctx.accountId,
      spaceId: ctx.spaceId,
      assetIds: body?.assetIds,
    });
    return Response.json(result, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return photoApiError(error);
  }
}
