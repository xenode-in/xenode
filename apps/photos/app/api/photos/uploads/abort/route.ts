import { getPhotosProductSession } from "@/lib/session";

/** Abort needs a server-owned upload manifest before any B2 key can be deleted. */
export async function POST(request: Request) {
  void request;
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(
    { error: "Photo upload cleanup requires a reserved upload ID" },
    { status: 409 },
  );
}
