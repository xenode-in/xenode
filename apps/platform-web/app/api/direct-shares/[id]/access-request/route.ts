import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import type { IDirectShareRecipient } from "@/models/DirectShare";
import ShareAccessRequest from "@/models/ShareAccessRequest";
import StorageObject from "@/models/StorageObject";
import { Space, type SpaceRecord } from "@xenode/database/models";
import { normalizeShareRole, roleAtLeast } from "@/lib/orgs/shareRoles";
import { emitNotificationToMany } from "@/lib/notifications/emit";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function orgOwnerAdminIds(orgId: string): Promise<string[]> {
  const admins = await mongoose.connection
    .collection("member")
    .find({ organizationId: orgId, role: { $in: ["owner", "admin"] } })
    .toArray();
  return admins.map((m) => m.userId as string);
}

/**
 * POST /api/direct-shares/[id]/access-request — a recipient asks the owner to
 * upgrade their role on this share (viewer → commenter | editor). No key work:
 * approval later just flips `accessType`. Notifies the owner (and org admins for
 * org files). Deduped to one open pending request per recipient per share.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const requestedRole =
      body.requestedRole === "editor" ? "editor" : body.requestedRole === "commenter" ? "commenter" : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    if (!requestedRole) {
      return NextResponse.json(
        { error: "requestedRole must be 'commenter' or 'editor'" },
        { status: 400 },
      );
    }

    await dbConnect();
    const share = await DirectShare.findOne({ _id: id, isRevoked: false })
      .select("objectId createdBy recipients")
      .lean();
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const recipient = (share.recipients as IDirectShareRecipient[] | undefined)?.find(
      (r) => r.recipientUserId === ctx.userId,
    );
    if (!recipient) {
      return NextResponse.json(
        { error: "You are not a recipient of this share" },
        { status: 403 },
      );
    }

    const currentRole = normalizeShareRole(recipient.accessType);
    if (roleAtLeast(currentRole, requestedRole)) {
      return NextResponse.json(
        { error: "You already have this level of access", code: "already_granted" },
        { status: 400 },
      );
    }

    const object = await StorageObject.findById(share.objectId)
      .select("spaceId")
      .lean<{ spaceId: string }>();
    const space = object
      ? await Space.findById(object.spaceId).lean<SpaceRecord>()
      : null;
    const orgId =
      space?.type === "organization" || space?.type === "team"
        ? space.organizationId ?? null
        : null;

    // Dedupe: one open pending request per recipient per share.
    const existing = await ShareAccessRequest.findOne({
      directShareId: id,
      requesterUserId: ctx.userId,
      status: "pending",
    }).lean();
    if (existing) {
      return NextResponse.json(
        {
          request: { id: String(existing._id), status: "pending", requestedRole: existing.requestedRole },
          deduped: true,
        },
        { status: 200 },
      );
    }

    const created = await ShareAccessRequest.create({
      directShareId: id,
      objectId: share.objectId,
      requesterUserId: ctx.userId,
      requesterEmail: ctx.session.user.email ?? null,
      ownerUserId: share.createdBy,
      orgId,
      currentRole,
      requestedRole,
      note,
    });

    // Notify the owner + (for org files) org admins.
    const notifyIds = new Set<string>([share.createdBy]);
    if (orgId) {
      for (const adminId of await orgOwnerAdminIds(orgId)) notifyIds.add(adminId);
    }
    notifyIds.delete(ctx.userId);
    await emitNotificationToMany(Array.from(notifyIds), {
      type: "access_request",
      title: "Access requested",
      body: `${ctx.session.user.email ?? "A recipient"} requested ${requestedRole} access.`,
      orgId: orgId ?? null,
      metadata: { directShareId: id, requestId: String(created._id), requestedRole },
    });

    return NextResponse.json({
      request: {
        id: String(created._id),
        status: "pending",
        requestedRole,
      },
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to request access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
