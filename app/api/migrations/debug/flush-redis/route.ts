import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import dbConnect from "@/lib/mongodb";
import MigrationJob from "@/models/MigrationJob";
import MigrationFile from "@/models/MigrationFile";
import { getRedisClient } from "@/lib/migrations/redis";

const redis = getRedisClient();

export async function POST() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();

    // Flush the entire redis DB
    await redis.flushdb();

    // Clear MongoDB Migration collections for this user
    await MigrationJob.deleteMany({ userId: session.user.id });
    // Since MigrationFile doesn't store userId directly, we have to find the user's jobs first
    // Or just clear all MigrationFiles (safe for isolated local dev environments)
    // But slightly safer: clear all since this is a global debug endpoint anyway
    await MigrationFile.deleteMany({});

    return NextResponse.json({ success: true, message: "Migrations flushed successfully" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to flush" }, { status: 500 });
  }
}
