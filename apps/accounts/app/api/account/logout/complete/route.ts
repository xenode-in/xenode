import { completeBrowserLogoutTransaction } from "@xenode/database";
import { requireSameOrigin } from "@/lib/logout-coordinator";

export async function POST(request: Request) {
  const origin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  try {
    requireSameOrigin(request, new URL(origin).origin);
  } catch (response) {
    return response as Response;
  }
  const body = (await request.json().catch(() => null)) as
    | { transaction?: unknown }
    | null;
  if (body && typeof body.transaction === "string") {
    await completeBrowserLogoutTransaction(body.transaction);
  }
  return Response.json({ ok: true });
}
