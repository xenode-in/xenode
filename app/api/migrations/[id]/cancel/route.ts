import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import MigrationJob, { MigrationStatus } from "@/models/MigrationJob";
import dbConnect from "@/lib/mongodb";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await dbConnect();
    
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const migration = await MigrationJob.findOne({ _id: id, userId: session.user.id });
    if (!migration) {
      return NextResponse.json({ error: "Migration not found" }, { status: 404 });
    }

    if (migration.status === MigrationStatus.COMPLETED || migration.status === MigrationStatus.FAILED) {
      return NextResponse.json({ error: "Migration already finished" }, { status: 400 });
    }

    migration.status = MigrationStatus.CANCELLED;
    await migration.save();

    return NextResponse.json({ success: true, migration });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
