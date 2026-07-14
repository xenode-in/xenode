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
  params: Promise<{ id: string }>;
}

/**
 * GET /api/objects/[id]/comments — E2EE comment threads for a file.
 * Visible to anyone with workspace or share access to the object; the payload
 * is DEK-encrypted client-side, so the server only relays ciphertext.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    await dbConnect();

    const access = await resolveCommentAccess(ctx, id);
    if (!access) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const comments = await FileComment.find({ objectId: id })
      .sort({ createdAt: 1 })
      .limit(1000)
      .lean<IFileComment[]>();

    return NextResponse.json({
      canComment: access.canComment,
      via: access.via,
      role: access.role,
      comments: comments.map((comment) => serializeComment(comment, ctx.userId)),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load comments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/objects/[id]/comments — add a thread or a reply.
 * Body: { ciphertext, parentId? }. Requires comment access (workspace write
 * or share role commenter+). Replies always attach to the thread ROOT.
 */
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
    const access = await resolveCommentAccess(ctx, id);
    if (!access) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!access.canComment) {
      return NextResponse.json(
        { error: "You need comment access to post here", code: "comment_forbidden" },
        { status: 403 },
      );
    }

    let parentId: string | null = null;
    if (body.parentId) {
      const rawParentId = String(body.parentId);
      if (!/^[a-f\d]{24}$/i.test(rawParentId)) {
        return NextResponse.json(
          { error: "Invalid parent comment", code: "invalid_parent" },
          { status: 400 },
        );
      }
      const parent = await FileComment.findOne({ _id: rawParentId, objectId: id })
        .select("_id parentId")
        .lean();
      if (!parent) {
        return NextResponse.json(
          { error: "Invalid parent comment", code: "invalid_parent" },
          { status: 400 },
        );
      }
      // Replies always hang off the thread root (Google-style flat threads).
      parentId = parent.parentId ? String(parent.parentId) : String(parent._id);
    }

    const comment = await FileComment.create({
      objectId: id,
      directShareId: access.directShareId,
      parentId,
      authorUserId: ctx.userId,
      authorEmail: ctx.session.user.email ?? null,
      ciphertext,
      status: "open",
    });

    return NextResponse.json({
      comment: serializeComment(comment, ctx.userId),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to post comment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
