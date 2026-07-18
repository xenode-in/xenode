import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import type { IDirectShareRecipient } from "@/models/DirectShare";
import FileComment from "@/models/FileComment";
import { canComment, normalizeShareRole } from "@/lib/orgs/shareRoles";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Resolve the caller's relationship to a direct share: are they the owner or a
 * recipient, and (if recipient) at what role. Comments are visible to any
 * participant; posting requires commenter+ (owners may always post).
 */
async function loadShareContext(shareId: string, userId: string) {
  const share = await DirectShare.findOne({ _id: shareId, isRevoked: false })
    .select("objectId createdBy recipients")
    .lean();
  if (!share) return null;
  const recipient = (share.recipients as IDirectShareRecipient[] | undefined)?.find(
    (r) => r.recipientUserId === userId,
  );
  const isOwner = share.createdBy === userId;
  return { share, recipient, isOwner };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    await dbConnect();

    const context = await loadShareContext(id, ctx.userId);
    if (!context) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    if (!context.recipient && !context.isOwner) {
      return NextResponse.json(
        { error: "You do not have access to this share" },
        { status: 403 },
      );
    }

    const comments = await FileComment.find({ directShareId: id })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();

    return NextResponse.json({
      role: context.recipient
        ? normalizeShareRole(context.recipient.accessType)
        : "editor",
      canComment: context.isOwner
        ? true
        : canComment(normalizeShareRole(context.recipient?.accessType)),
      comments: comments.map((c) => ({
        id: String(c._id),
        authorUserId: c.authorUserId,
        authorEmail: c.authorEmail ?? null,
        ciphertext: c.ciphertext,
        createdAt: c.createdAt,
        mine: c.authorUserId === ctx.userId,
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load comments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const ciphertext =
      typeof body.ciphertext === "string" ? body.ciphertext.trim() : "";
    if (!ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 },
      );
    }

    await dbConnect();
    const context = await loadShareContext(id, ctx.userId);
    if (!context) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const allowed =
      context.isOwner ||
      (!!context.recipient &&
        canComment(normalizeShareRole(context.recipient.accessType)));
    if (!allowed) {
      return NextResponse.json(
        { error: "You need comment access to post here", code: "comment_forbidden" },
        { status: 403 },
      );
    }

    const comment = await FileComment.create({
      directShareId: id,
      objectId: context.share.objectId,
      authorUserId: ctx.userId,
      authorEmail: ctx.session.user.email ?? null,
      ciphertext,
    });

    return NextResponse.json({
      comment: {
        id: String(comment._id),
        authorUserId: comment.authorUserId,
        authorEmail: comment.authorEmail ?? null,
        ciphertext: comment.ciphertext,
        createdAt: comment.createdAt,
        mine: true,
      },
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to post comment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
