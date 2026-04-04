import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import MigrationJob from "@/models/MigrationJob";
import MigrationFile from "@/models/MigrationFile";
import { getRedisClient } from "@/lib/migrations/redis";
import { requireSuperAdminSession } from "@/lib/admin/session";

const redis = getRedisClient();

export async function POST() {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await requireSuperAdminSession();

    await dbConnect();

    // Flush the entire redis DB
    await redis.flushdb();

    // This route is intentionally restricted to non-production super admins.
    await MigrationJob.deleteMany({});
    await MigrationFile.deleteMany({});

    return NextResponse.json({ success: true, message: "Migrations flushed successfully" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to flush" }, { status: 500 });
  }
}
