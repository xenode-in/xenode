/**
 * GET /api/cron/purge-orgs
 *
 * Permanently removes organizations whose 30-day soft-delete window has elapsed
 * (scheduledPurgeAt <= now). For each org it deletes the encrypted B2 blobs for
 * every org + team object, then hard-deletes all org-scoped documents.
 *
 * Secured with the shared CRON_SECRET (same pattern as purge-bin). Register in
 * vercel.json:  { "path": "/api/cron/purge-orgs", "schedule": "0 3 * * *" }
 *
 * Billing is already cancelled at soft-delete time; this only reclaims storage
 * and rows. Processes a bounded number of orgs per run.
 */
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { Space, SpaceProductKey } from "@xenode/database/models";
import OrgUsage from "@/models/OrgUsage";
import OrganizationPolicy from "@/models/OrganizationPolicy";
import OrgDomain from "@/models/OrgDomain";
import { deleteObjects as deleteB2Objects } from "@/lib/b2/objects";
import { collectVersionB2Keys } from "@/lib/storage/versions";
import type { IStorageObjectVersion } from "@/models/StorageObject";

export const dynamic = "force-dynamic";

const MAX_ORGS_PER_RUN = 50;

type OrgObjectDoc = {
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  versions?: IStorageObjectVersion[];
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const now = new Date();
    const organizations = mongoose.connection.collection("organization");

    const expired = await organizations
      .find({ deletedAt: { $exists: true }, scheduledPurgeAt: { $lte: now } })
      .limit(MAX_ORGS_PER_RUN)
      .toArray();

    let purgedOrgs = 0;
    let purgedObjects = 0;

    for (const org of expired) {
      const orgId = org.id as string;

      // 1. Delete encrypted blobs for every org + team object, grouped by the
      //    physical B2 bucket they live in.
      const spaces = await Space.find({ organizationId: orgId })
        .select("_id")
        .lean<Array<{ _id: string }>>();
      const spaceIds = spaces.map((space) => space._id);
      const objects = await StorageObject.find({ spaceId: { $in: spaceIds } })
        .select("key thumbnail optimizedKey versions bucketId")
        .lean<(OrgObjectDoc & { bucketId: mongoose.Types.ObjectId })[]>();

      if (objects.length > 0) {
        const bucketIds = Array.from(
          new Set(objects.map((o) => o.bucketId.toString())),
        );
        const buckets = await Bucket.find({ _id: { $in: bucketIds } })
          .select("_id b2BucketId")
          .lean<{ _id: mongoose.Types.ObjectId; b2BucketId: string }[]>();
        const b2ByBucket = new Map(
          buckets.map((b) => [b._id.toString(), b.b2BucketId]),
        );

        const keysByB2 = new Map<string, string[]>();
        for (const obj of objects) {
          const b2 = b2ByBucket.get(obj.bucketId.toString());
          if (!b2) continue;
          const arr = keysByB2.get(b2) ?? [];
          if (obj.key) arr.push(obj.key);
          if (obj.thumbnail) arr.push(obj.thumbnail);
          if (obj.optimizedKey) arr.push(obj.optimizedKey);
          for (const v of obj.versions ?? []) arr.push(...collectVersionB2Keys(v));
          keysByB2.set(b2, arr);
        }
        for (const [b2, keys] of keysByB2) {
          await deleteB2Objects(b2, keys);
        }
      }

      // 2. Hard-delete all org-scoped documents.
      const teams = await mongoose.connection
        .collection("team")
        .find({ organizationId: orgId })
        .toArray();
      const teamIds = teams.map((t) => t.id as string);

      await StorageObject.deleteMany({ spaceId: { $in: spaceIds } });
      await SpaceProductKey.deleteMany({ spaceId: { $in: spaceIds } });
      await Space.deleteMany({ _id: { $in: spaceIds } });
      await OrgUsage.deleteMany({ orgId });
      await OrganizationPolicy.deleteMany({ orgId });
      await OrgDomain.deleteMany({ orgId });
      await mongoose.connection
        .collection("member")
        .deleteMany({ organizationId: orgId });
      await mongoose.connection
        .collection("invitation")
        .deleteMany({ organizationId: orgId });
      await mongoose.connection
        .collection("team")
        .deleteMany({ organizationId: orgId });
      if (teamIds.length > 0) {
        await mongoose.connection
          .collection("teamMember")
          .deleteMany({ teamId: { $in: teamIds } });
      }
      await organizations.deleteOne({ id: orgId });

      purgedOrgs += 1;
      purgedObjects += objects.length;
    }

    return NextResponse.json({
      success: true,
      purgedOrgs,
      purgedObjects,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] purge-orgs error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
