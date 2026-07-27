import { personalSpaceId } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { createPhotosRealtimeToken } from "@/lib/realtime-token";

export async function POST() {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(
      await createPhotosRealtimeToken({
        accountId: session.accountId,
        spaceId: personalSpaceId(session.accountId),
        sessionId: session.sessionId,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Realtime unavailable" }, { status: 503 });
  }
}
