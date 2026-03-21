import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { uploadObject } from "@/lib/b2/objects";
import { getPublicB2Url } from "@/lib/b2/cdn";
import { getPublicS3Client } from "@/lib/b2/client";

const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";

const GLOBAL_BUCKET_NAME = process.env.B2_BUCKET_NAME || "xenode-drive-storage";

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const key = `blog/${filename}`;

    // Upload to Public Storage (Zata.ai)
    await uploadObject(
      PUBLIC_BUCKET_NAME,
      key,
      buffer,
      file.type || "application/octet-stream",
      file.size,
      getPublicS3Client()
    );

    // Generate a direct public URL
    const url = getPublicB2Url(PUBLIC_BUCKET_NAME, key);

    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("[POST /api/admin/upload]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
