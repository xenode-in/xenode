import { resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const photosOrigin = new URL(
    process.env.PHOTOS_ORIGIN ?? "https://photos.xenode.in",
  ).origin;
  if (
    !body ||
    body.accountId !== session.accountId ||
    body.clientId !== "xenode-photos-web" ||
    body.productId !== "photos" ||
    body.destinationOrigin !== photosOrigin ||
    typeof body.spaceId !== "string" ||
    typeof body.state !== "string" ||
    typeof body.nonce !== "string"
  ) {
    return Response.json({ error: "Invalid handoff binding" }, { status: 400 });
  }
  try {
    await resolveSpaceAccess({
      accountId: session.accountId,
      spaceId: body.spaceId as never,
      productId: "photos",
    });
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }

  const { transactionId } = await params;
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  const upstream = await fetch(
    new URL(
      `/api/key-handoffs/${encodeURIComponent(transactionId)}/consume`,
      accountsOrigin,
    ),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.sessionId}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
