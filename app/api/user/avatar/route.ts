import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { uploadObject } from "@/lib/b2/objects";
import { getPublicB2Url, getSignedFileUrl } from "@/lib/b2/cdn";
import { getPublicS3Client } from "@/lib/b2/client";

const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";

export async function POST(req: NextRequest) {
  // Check if user is authenticated (using Better Auth)
  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: req.headers,
  });

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

    // Save under 'avatars/custom'
    const filename = `${session.user.id}-${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const key = `avatars/custom/${filename}`;

    // Upload to Public Storage
    await uploadObject(
      PUBLIC_BUCKET_NAME,
      key,
      buffer,
      file.type || "application/octet-stream",
      file.size,
      getPublicS3Client(),
    );

    // Generate a direct proxy URL
    // We use a long expiration (e.g., 10 years) for user profile images since the proxy handles it
    const url = getSignedFileUrl(PUBLIC_BUCKET_NAME, key, 315360000);

    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("[POST /api/user/avatar]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
