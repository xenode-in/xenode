import { cookies } from "next/headers";
import {
  connectDatabase,
  getAccountOnboardingReadiness,
  ProductSession,
} from "@xenode/database";
import { parsePhotosSessionCookie } from "@/lib/product-cookie";

export async function getPhotosProductSession() {
  const value = (await cookies()).get("xenode_photos_session")?.value;
  const credential = value ? await parsePhotosSessionCookie(value) : null;
  if (!credential) return null;
  await connectDatabase();
  const session = await ProductSession.findOne({
    sessionId: credential.sessionId,
    productId: "photos",
    sessionVersion: credential.sessionVersion,
    issuerSessionId: { $type: "string" },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!session) return null;
  const readiness = await getAccountOnboardingReadiness(session.accountId);
  return readiness.complete ? session : null;
}
