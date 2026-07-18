import { type NextRequest } from "next/server";
import { resolveSpaceAccess } from "@xenode/spaces";
import { getServerSession } from "@/lib/auth/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const session = await getServerSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const driveOrigin = new URL(
    process.env.DRIVE_ORIGIN ?? "https://drive.xenode.in",
  ).origin;
  if (
    !body ||
    body.accountId !== session.user.id ||
    body.clientId !== "xenode-drive-web" ||
    body.productId !== "drive" ||
    body.destinationOrigin !== driveOrigin ||
    typeof body.spaceId !== "string" ||
    typeof body.state !== "string" ||
    typeof body.nonce !== "string"
  ) {
    return Response.json({ error: "Invalid handoff binding" }, { status: 400 });
  }
  try {
    await resolveSpaceAccess({
      accountId: session.user.id,
      spaceId: body.spaceId as never,
      productId: "drive",
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
        authorization: `Bearer ${session.session.id}`,
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
