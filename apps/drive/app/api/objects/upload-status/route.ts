import { NextRequest, NextResponse } from "next/server";
import { bucketOwnershipClause, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import UploadSession from "@/models/UploadSession";
import StorageObject from "@/models/StorageObject";
import { getObjectMetadata } from "@/lib/b2/objects";
import { spaceStorageRoot } from "@/lib/storage/folders";

export const dynamic = "force-dynamic";
const PAGE_KEYS = 128;

/** Exact reservation status; no caller-controlled storage prefix or broad listing. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const query = new URL(request.url).searchParams;
    const bucketId = query.get("bucketId");
    const sessionId = query.get("sessionId");
    const offset = Number(query.get("offset") ?? 0);
    if (!bucketId || !/^[a-f0-9]{24}$/iu.test(bucketId) || !sessionId || !/^[a-f0-9]{24}$/iu.test(sessionId) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 4099) {
      return NextResponse.json({ error: "Valid bucketId, sessionId and offset are required" }, { status: 400 });
    }
    await dbConnect();
    const bucket = await Bucket.findOne({ _id: bucketId, ...bucketOwnershipClause(ctx) }).lean();
    if (!bucket) return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    const reservation = await UploadSession.findOne({
      _id: sessionId, userId: ctx.accountId, spaceId: ctx.spaceId, bucketId: bucket._id, purpose: "create",
    }).lean();
    if (!reservation || !reservation.fileId.startsWith(spaceStorageRoot(ctx))) {
      return NextResponse.json({ error: "Upload reservation not found" }, { status: 404 });
    }
    const identity = { sessionId, bucketId, fileId: reservation.fileId, spaceId: ctx.spaceId };
    if (reservation.status === "completed") {
      const exists = await StorageObject.exists({ _id: reservation._id, key: reservation.fileId,
        spaceId: ctx.spaceId, bucketId: bucket._id, productId: "drive", createdByAccountId: ctx.accountId, deletedAt: null });
      if (!exists) return NextResponse.json({ error: "Completed upload is no longer available" }, { status: 409 });
      return NextResponse.json({ ...identity, completed: true, objects: [], nextOffset: null });
    }
    if (reservation.status !== "pending" || reservation.expiresAt <= new Date() ||
      reservation.cleanupState !== "pending") {
      return NextResponse.json({ error: "Upload is no longer pending" }, { status: 409 });
    }
    const keys = [...new Set(reservation.keys)];
    if (!keys.length || keys.length > 4099 || keys.some((key) => !key.startsWith(spaceStorageRoot(ctx))) || offset > keys.length) {
      return NextResponse.json({ error: "Invalid reservation manifest" }, { status: 409 });
    }
    const page = keys.slice(offset, offset + PAGE_KEYS);
    const objects: Array<{ key: string; size: number }> = [];
    let next = 0;
    const head = async () => {
      while (next < page.length) {
        const key = page[next++];
        try {
          const metadata = await getObjectMetadata(bucket.b2BucketId, key);
          if (!Number.isSafeInteger(metadata.size) || metadata.size < 1) throw new Error("Invalid ciphertext length");
          objects.push({ key, size: metadata.size });
        } catch (error) {
          const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
          if (failure.name !== "NoSuchKey" && failure.name !== "NotFound" && failure.$metadata?.httpStatusCode !== 404) throw error;
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(4, page.length) }, head)); }
    catch { return NextResponse.json({ error: "Ciphertext availability could not be verified" }, { status: 502 }); }
    return NextResponse.json({ ...identity, completed: false, objects,
      nextOffset: offset + page.length < keys.length ? offset + page.length : null });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    return NextResponse.json({ error: "Could not read upload status" }, { status: 500 });
  }
}
