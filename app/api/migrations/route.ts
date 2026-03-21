import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import MigrationJob from "@/models/MigrationJob";
import dbConnect from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    // Auth check
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const migrations = await MigrationJob.find({
      userId: session.user.id,
    }).sort({ createdAt: -1 });
    return NextResponse.json(migrations);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
