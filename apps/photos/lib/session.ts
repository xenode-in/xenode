import { cookies } from "next/headers";
import { connectDatabase, ProductSession } from "@xenode/database";

export async function getPhotosProductSession() {
  await connectDatabase();
  const sessionId = (await cookies()).get("xenode_photos_session")?.value;
  if (!sessionId) return null;
  return ProductSession.findOne({
    sessionId,
    productId: "photos",
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
}
