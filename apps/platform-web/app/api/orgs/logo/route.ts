import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { uploadObject } from "@/lib/b2/objects";
import { getPublicS3Client } from "@/lib/b2/client";

const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export async function POST(req: NextRequest) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Logo must be a PNG, JPEG, WebP, or SVG image" },
        { status: 400 },
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        { error: "Logo must be 2 MB or smaller" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const suffix = randomBytes(8).toString("hex");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-40);
    const key = `org-logos/${session.user.id}-${suffix}-${safeName}`;

    await uploadObject(
      PUBLIC_BUCKET_NAME,
      key,
      buffer,
      file.type || "application/octet-stream",
      file.size,
      getPublicS3Client(),
    );

    const s3Endpoint = process.env.S3_ENDPOINT || "https://idr01.zata.ai";
    const endpointDomain = s3Endpoint.replace(/^https?:\/\//, "");
    const url = `https://${PUBLIC_BUCKET_NAME}.${endpointDomain}/${key}`;

    return NextResponse.json({ url });
  } catch (error: unknown) {
    console.error("[POST /api/orgs/logo]", error);
    const message =
      error instanceof Error ? error.message : "Failed to upload logo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
