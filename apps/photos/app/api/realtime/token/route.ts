import { personalSpaceId } from "@xenode/spaces";
import { exactRealtimeOrigin } from "@xenode/realtime";
import { getPhotosProductSession } from "@/lib/session";
import { createPhotosRealtimeToken } from "@/lib/realtime-token";

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Photos authenticates with a cookie only, so every ticket binds the exact
  // page Origin that the socket handshake must repeat.
  const origin = exactRealtimeOrigin(request.headers.get("origin"));
  if (!origin) {
    return Response.json(
      { error: "Realtime tickets require an exact Origin" },
      { status: 403 },
    );
  }
  try {
    return Response.json(
      await createPhotosRealtimeToken({
        accountId: session.accountId,
        spaceId: personalSpaceId(session.accountId),
        sessionId: session.sessionId,
        sessionExpiresAt: new Date(session.expiresAt),
        origin,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Realtime unavailable" }, { status: 503 });
  }
}
