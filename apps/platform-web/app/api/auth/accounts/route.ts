import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { listExternalAccountsForUser } from "@xenode/database/repositories";

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use the shared Mongo pool; never open a per-request client.
    const accounts = await listExternalAccountsForUser(session.user.id);

    return NextResponse.json(accounts);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch accounts" }, { status: 500 });
  }
}
