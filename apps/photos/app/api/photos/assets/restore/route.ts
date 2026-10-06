import { changePhotoTrash } from "@xenode/database";
import { requirePhotoAccess, photoApiError } from "@/lib/api-access";
export async function POST(request: Request) {
  try {
    const ctx = await requirePhotoAccess(request, "write");
    const body = await request.json().catch(() => null);
    const result = await changePhotoTrash({
      accountId: ctx.accountId,
      spaceId: ctx.spaceId,
      assetIds: body?.assetIds,
      restore: true,
    });
    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return photoApiError(error);
  }
}
