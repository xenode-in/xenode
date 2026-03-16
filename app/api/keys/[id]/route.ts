import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import ApiKey from "@/models/ApiKey";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** DELETE /api/keys/[id] - Delete an API key */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    const key = await ApiKey.findOne({ _id: id, userId });
    if (!key) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await ApiKey.findByIdAndDelete(key._id);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
