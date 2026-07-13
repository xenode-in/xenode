import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  objectFilter,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { getDownloadUrl } from "@/lib/b2/objects";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    await enforceStorageAccess(userId);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const isPreview = searchParams.get("preview") === "true";
    const versionId = searchParams.get("version");

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id));
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    if (!object.isEncrypted) {
      return NextResponse.json(
        { error: "Not an encrypted object" },
        { status: 400 },
      );
    }

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Serve a specific historical version when `?version=` is supplied.
    let keyToServe = isPreview && object.optimizedKey ? object.optimizedKey : object.key;
    if (versionId) {
      const version = (object.versions || []).find((v) => v.versionId === versionId);
      if (!version) {
        return NextResponse.json({ error: "Version not found" }, { status: 404 });
      }
      keyToServe = version.key;
    }

    const signedUrl = await getDownloadUrl(bucket.b2BucketId, keyToServe);
    const upstreamHeaders: Record<string, string> = {};
    const rangeHeader = request.headers.get("Range");
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    const upstream = await fetch(signedUrl, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: "Failed to fetch file from storage" },
        { status: 502 },
      );
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/octet-stream",
    );

    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "private, no-store");

    const status = upstream.status === 206 ? 206 : 200;

    // Stream directly — no arrayBuffer()
    return new NextResponse(upstream.body, { status, headers });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message ? message : "Internal server error" }, { status: 500 });
  }
}
