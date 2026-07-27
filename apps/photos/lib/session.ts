import { cookies } from "next/headers";
import { connectDatabase, ProductSession } from "@xenode/database";
import { parsePhotosSessionCookie } from "@/lib/product-cookie";

export async function getPhotosProductSession() {
  await connectDatabase();
  const value = (await cookies()).get("xenode_photos_session")?.value;
  const credential = value ? await parsePhotosSessionCookie(value) : null;
  if (!credential) return null;
  return ProductSession.findOne({
    sessionId: credential.sessionId,
    productId: "photos",
    sessionVersion: credential.sessionVersion,
    issuerSessionId: { $type: "string" },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
}
