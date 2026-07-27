import { personalSpaceId } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";

export async function GET() {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    accountId: session.accountId,
    spaceId: personalSpaceId(session.accountId),
    productId: "photos",
    sessionId: session.sessionId,
  });
}
