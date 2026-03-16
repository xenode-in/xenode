import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import MigrationJob from "@/models/MigrationJob";
import dbConnect from "@/lib/mongodb";
import { getRedisClient } from "@/lib/migrations/redis";

const redis = getRedisClient();

export async function GET(
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

    // Get real-time progress from Redis
    const realTimeBytes = await redis.hget(`migration:progress:${id}`, "bytes");
    
    // Fallback to DB if Redis is empty
    const currentBytes = realTimeBytes ? parseInt(realTimeBytes, 10) : migration.migratedBytes;

    return NextResponse.json({
      ...migration.toObject(),
      realTimeBytes: currentBytes,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
