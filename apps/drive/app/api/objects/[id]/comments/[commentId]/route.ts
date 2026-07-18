import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import FileComment, { IFileComment } from "@/models/FileComment";
import { resolveCommentAccess, serializeComment } from "@/lib/comments/access";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; commentId: string }>;
}

/**
 * PATCH /api/objects/[id]/comments/[commentId] — resolve or reopen a thread.
 * Body: { action: "resolve" | "reopen" }. Anyone with comment access can
 * resolve/reopen (Google Drive semantics). Only thread roots carry status.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id, commentId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "resolve" || body.action === "reopen" ? body.action : null;
    if (!action) {
      return NextResponse.json(
        { error: "action must be resolve or reopen" },
        { status: 400 },
      );
    }

    await dbConnect();
    const access = await resolveCommentAccess(ctx, id);
    if (!access) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!access.canComment) {
      return NextResponse.json(
        { error: "You need comment access to do that", code: "comment_forbidden" },
        { status: 403 },
      );
    }

    const comment = await FileComment.findOne({ _id: commentId, objectId: id });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    if (comment.parentId) {
      return NextResponse.json(
        { error: "Only thread roots can be resolved", code: "not_a_thread_root" },
        { status: 400 },
      );
    }

    comment.status = action === "resolve" ? "resolved" : "open";
    comment.resolvedBy = action === "resolve" ? ctx.userId : null;
    comment.resolvedAt = action === "resolve" ? new Date() : null;
    await comment.save();

    return NextResponse.json({
      comment: serializeComment(comment as IFileComment, ctx.userId),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update comment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
