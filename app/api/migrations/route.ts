import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import MigrationJob, {
  MigrationStatus,
  ProviderType,
} from "@/models/MigrationJob";
import Bucket from "@/models/Bucket";
import dbConnect from "@/lib/mongodb";
import { scanQueue } from "@/lib/migrations/queues";

export async function POST(req: NextRequest) {
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

    const {
      provider,
      providerAccountId,
      destinationBucketId,
      sourceFolderId,
      destinationPath,
    } = await req.json();

    if (
      !provider ||
      !providerAccountId ||
      !destinationBucketId ||
      !sourceFolderId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify bucket exists and belongs to user
    const bucket = await Bucket.findOne({ _id: destinationBucketId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Create Migration Job
    const migration = new MigrationJob({
      userId: session.user.id,
      provider: provider as ProviderType,
      providerAccountId,
      destinationBucketId,
      destinationPath: destinationPath || "",
      sourceFolderId,
      status: MigrationStatus.CREATED,
    });

    await migration.save();

    // Push initial scan job
    await scanQueue.add("scan-folder", {
      migrationId: migration._id.toString(),
      folderId: sourceFolderId,
      currentPath: "",
    });

    return NextResponse.json(migration, { status: 201 });
  } catch (error: any) {
    console.error("Migration creation error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
