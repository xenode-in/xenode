import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Notification, { type INotification } from "@/models/Notification";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function serialize(n: INotification) {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    orgId: n.orgId ?? null,
    metadata: n.metadata ?? {},
    read: n.read,
    createdAt: n.createdAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    await dbConnect();
    const url = request.nextUrl;
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    );
    const cursor = url.searchParams.get("cursor");
    const unreadOnly = url.searchParams.get("unread") === "true";

    const filter: Record<string, unknown> = { userId };
    if (unreadOnly) filter.read = false;
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const [rows, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<INotification[]>(),
      Notification.countDocuments({ userId, read: false }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      items: page.map(serialize),
      unreadCount,
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load notifications";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown;
      all?: unknown;
    };

    await dbConnect();
    if (body.all === true) {
      await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
      return NextResponse.json({ ok: true, unreadCount: 0 });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter(
          (id): id is string =>
            typeof id === "string" && mongoose.Types.ObjectId.isValid(id),
        )
      : [];
    if (ids.length > 0) {
      await Notification.updateMany(
        { userId, _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { $set: { read: true } },
      );
    }

    const unreadCount = await Notification.countDocuments({ userId, read: false });
    return NextResponse.json({ ok: true, unreadCount });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update notifications";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
