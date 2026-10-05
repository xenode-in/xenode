import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import { deleteObjects } from "@/lib/b2/objects";
import {
  beginOrganizationRetirement,
  finishOrganizationRetirement,
  finishPersonalRetirement,
  finishTeamRetirement,
  processRetiringSpace,
} from "@xenode/database/repositories";
import { teamSpaceId } from "@xenode/spaces/ids";

export const dynamic = "force-dynamic";
const MAX_ORGS_PER_RUN = 50;
const MAX_STANDALONE_TEAMS_PER_RUN = 50;
const MAX_SPACE_STEPS_PER_RUN = 100;

async function sweepTeam(orgId: string, teamId: string, now: Date) {
  const spaceId = teamSpaceId(orgId, teamId);
  const step = await processRetiringSpace({ spaceId, now, deleteBlobs: deleteObjects });
  const finished = step.complete && await finishTeamRetirement({ orgId, teamId, spaceId });
  if (!finished) await mongoose.connection.db!.collection("team").updateOne({ id: teamId, organizationId: orgId, purgeState: "pending" }, { $set: { purgeSweepAt: now } });
  return { ...step, finished };
}

/** Retire child ciphertext and quota before deleting a parent Space or organization. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const now = new Date();
    const db = mongoose.connection.db!;
    const organizations = db.collection("organization");
    let purgedOrgs = 0, purgedTeams = 0, purgedObjects = 0, failedObjects = 0;
    let spaceSteps = 0;

    // A team deletion initiated by its owner must progress even when its org is active.
    const standaloneTeams = await db.collection("team").find({ purgeState: "pending" })
      .sort({ purgeSweepAt: 1, _id: 1 }).limit(MAX_STANDALONE_TEAMS_PER_RUN).project({ id: 1, organizationId: 1 }).toArray();
    for (const team of standaloneTeams) {
      const step = await sweepTeam(team.organizationId as string, team.id as string, now);
      spaceSteps++;
      purgedObjects += step.deleted;
      failedObjects += step.failed;
      if (step.finished) purgedTeams++;
    }

    const expired = await organizations.find({ deletedAt: { $type: "date" }, scheduledPurgeAt: { $lte: now } })
      .sort({ purgeSweepAt: 1, scheduledPurgeAt: 1, _id: 1 }).limit(MAX_ORGS_PER_RUN).project({ id: 1 }).toArray();
    for (const org of expired) {
      if (spaceSteps >= MAX_SPACE_STEPS_PER_RUN) break;
      const orgId = org.id as string;
      if (!await beginOrganizationRetirement({ orgId, now })) continue;
      const teams = await db.collection("team").find({ organizationId: orgId, purgeState: "pending" })
        .sort({ purgeSweepAt: 1, _id: 1 }).limit(MAX_SPACE_STEPS_PER_RUN - spaceSteps).project({ id: 1 }).toArray();
      for (const team of teams) {
        const step = await sweepTeam(orgId, team.id as string, now);
        spaceSteps++;
        purgedObjects += step.deleted;
        failedObjects += step.failed;
        if (step.finished) purgedTeams++;
      }
      const orgSpaces = await db.collection<{ _id: string }>("spaces").find({ organizationId: orgId, type: "organization" })
        .limit(MAX_SPACE_STEPS_PER_RUN - spaceSteps).project({ _id: 1 }).toArray();
      for (const space of orgSpaces) {
        const step = await processRetiringSpace({ spaceId: space._id, now, deleteBlobs: deleteObjects });
        spaceSteps++;
        purgedObjects += step.deleted;
        failedObjects += step.failed;
      }
      if (await finishOrganizationRetirement({ orgId })) purgedOrgs++;
      else await organizations.updateOne({ id: orgId, purgeState: "pending" }, { $set: { purgeSweepAt: now } });
    }

    // Deleted accounts: purge each closed personal Space, then its quota record.
    let purgedAccounts = 0;
    const personalSpaces = await db.collection<{ _id: string }>("spaces").find({ type: "personal", status: "deleted" })
      .sort({ updatedAt: 1, _id: 1 }).limit(Math.max(0, MAX_SPACE_STEPS_PER_RUN - spaceSteps)).project({ _id: 1 }).toArray();
    for (const space of personalSpaces) {
      const step = await processRetiringSpace({ spaceId: space._id, now, deleteBlobs: deleteObjects });
      spaceSteps++;
      purgedObjects += step.deleted;
      failedObjects += step.failed;
      if (step.complete && await finishPersonalRetirement({ spaceId: space._id })) purgedAccounts++;
    }

    return NextResponse.json({
      success: failedObjects === 0, purgedOrgs, purgedTeams, purgedAccounts, purgedObjects, failedObjects,
      processedAt: now.toISOString(),
    }, { status: failedObjects ? 500 : 200 });
  } catch (error) {
    console.error("[Cron] purge-orgs error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
