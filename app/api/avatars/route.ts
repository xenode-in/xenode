import { NextRequest, NextResponse } from "next/server";
import { getSignedFileUrl } from "@/lib/b2/cdn";

// Use the public bucket name, defaulting to xenopublic
const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";
const TOTAL_AVATARS = 1000;
const RETURN_COUNT = 20;

function getRequestOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host");
  if (!host) return req.nextUrl.origin;

  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  try {
    const origin = getRequestOrigin(req);
    // Generate an array of 20 unique random indices between 1 and 1000
    const indices = new Set<number>();
    
    while (indices.size < RETURN_COUNT) {
      const randomIndex = Math.floor(Math.random() * TOTAL_AVATARS) + 1;
      indices.add(randomIndex);
    }
    
    // Construct the proxy URLs for those indices using getSignedFileUrl
    const avatars = Array.from(indices).map((index) => {
      const key = `avatars/avatar-${index}.svg`;
      return getSignedFileUrl(
        PUBLIC_BUCKET_NAME,
        key,
        3600,
        undefined,
        origin,
      );
    });
    
    return NextResponse.json({ avatars });
  } catch (error) {
    console.error("Error fetching random avatars:", error);
    return NextResponse.json(
      { error: "Failed to fetch random avatars" },
      { status: 500 }
    );
  }
}
