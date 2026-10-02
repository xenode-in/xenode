import { authorizeAccountsApiRequest } from "@/lib/api-session";
import {
  SpaceProductKey,
  connectDatabase,
} from "@xenode/database";
import {
  productSlugSchema,
  spaceIdSchema,
} from "@xenode/contracts";
import {
  ensurePersonalSpace,
  personalSpaceId,
  resolveSpaceAccess,
} from "@xenode/spaces";
import { getAccountsAuth } from "@/lib/auth";

async function context(request: Request, url: URL) {
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;

  const spaceId = spaceIdSchema.safeParse(url.searchParams.get("spaceId"));
  const productId = productSlugSchema.safeParse(url.searchParams.get("productId"));
  if (!spaceId.success || !productId.success || productId.data === "accounts") {
    return null;
  }
  await connectDatabase();
  if (spaceId.data === personalSpaceId(session.user.id)) {
    await ensurePersonalSpace(session.user.id);
  }
  await resolveSpaceAccess({
    accountId: session.user.id,
    spaceId: spaceId.data,
    productId: productId.data,
  });
  return {
    accountId: session.user.id,
    spaceId: spaceId.data,
    productId: productId.data,
  };
}

export async function GET(request: Request) {
  const denied = await authorizeAccountsApiRequest(request);
  if (denied) return denied;
  let keyContext;
  try {
    keyContext = await context(request, new URL(request.url));
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }
  if (!keyContext) return Response.json({ error: "Invalid request" }, { status: 400 });

  const key = await SpaceProductKey.findOne({
    spaceId: keyContext.spaceId,
    productId: keyContext.productId,
    memberAccountId: keyContext.accountId,
    status: "active",
  })
    .sort({ keyVersion: -1 })
    .lean();
  if (!key) return Response.json({ error: "Product key not found" }, { status: 404 });
  return Response.json({ key });
}
