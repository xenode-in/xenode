import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import {
  assertOrgMember,
  assertOrgMemberRole,
  type OrganizationRecord,
} from "@/lib/orgs/access";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import Subscription from "@/models/Subscription";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const ORG_PURGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function serializeSettings(org: OrganizationRecord) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug ?? null,
    logo: org.logo ?? null,
    primaryColor: org.primaryColor ?? null,
    emailBranding: org.emailBranding ?? null,
    domainJoinPolicy: org.domainJoinPolicy ?? "off",
    autoJoinRequiresApproval: org.autoJoinRequiresApproval ?? true,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    return NextResponse.json({
      organization: serializeSettings(membership.organization),
      role: membership.role,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.name === "string" && body.name.trim()) {
      update.name = body.name.trim().slice(0, 80);
    }
    if (typeof body.logo === "string" || body.logo === null) {
      update.logo = body.logo;
    }
    if (typeof body.primaryColor === "string" || body.primaryColor === null) {
      update.primaryColor = body.primaryColor;
    }
    if (typeof body.emailBranding === "string" || body.emailBranding === null) {
      update.emailBranding = body.emailBranding;
    }
    if (
      body.domainJoinPolicy === "off" ||
      body.domainJoinPolicy === "suggest" ||
      body.domainJoinPolicy === "auto"
    ) {
      update.domainJoinPolicy = body.domainJoinPolicy;
    }
    if (typeof body.autoJoinRequiresApproval === "boolean") {
      update.autoJoinRequiresApproval = body.autoJoinRequiresApproval;
    }

    await dbConnect();
    const organizations =
      mongoose.connection.collection<OrganizationRecord>("organization");
    await organizations.updateOne({ id: orgId }, { $set: update });
    const org = await organizations.findOne({ id: orgId });

    await emitActivity({
      orgId,
      action: ActivityAction.ORG_SETTINGS_UPDATED,
      actorUserId: ctx.userId,
      target: { type: "organization", id: orgId },
      metadata: { fields: Object.keys(update).filter((k) => k !== "updatedAt") },
    });

    return NextResponse.json({
      organization: org ? serializeSettings(org) : null,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    if (membership.role !== "owner") {
      throw new AuthzError(403, "organization_owner_required", "Forbidden");
    }

    await dbConnect();
    const now = new Date();
    const scheduledPurgeAt = new Date(now.getTime() + ORG_PURGE_WINDOW_MS);

    await mongoose.connection
      .collection<OrganizationRecord>("organization")
      .updateOne(
        { id: orgId },
        { $set: { deletedAt: now, scheduledPurgeAt, updatedAt: now } },
      );

    // Best-effort: stop billing now. The 30-day purge cron finishes cleanup.
    const subscription = await Subscription.findOne({
      accountId: orgStorageOwnerId(orgId),
      status: { $in: ["active", "authenticated"] },
    });
    if (subscription?.subscription_id) {
      try {
        await razorpay.subscriptions.cancel(subscription.subscription_id);
      } catch {
        // ignore gateway errors; local state is the source of truth for purge
      }
      subscription.status = "cancelled";
      await subscription.save();
    }

    await emitActivity({
      orgId,
      action: ActivityAction.ORG_DELETED,
      actorUserId: ctx.userId,
      target: { type: "organization", id: orgId },
      metadata: { scheduledPurgeAt: scheduledPurgeAt.toISOString() },
    });

    return NextResponse.json({
      orgId,
      deletedAt: now.toISOString(),
      scheduledPurgeAt: scheduledPurgeAt.toISOString(),
      recoveryWindowDays: 30,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to delete organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
