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

export async function PUT(request: Request) {
  let keyContext;
  try {
    keyContext = await context(request, new URL(request.url));
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }
  if (!keyContext) return Response.json({ error: "Invalid request" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    body.formatVersion !== 2 ||
    body.algorithm !== "AES-256-GCM" ||
    body.aadVersion !== 1 ||
    body.spaceId !== keyContext.spaceId ||
    body.productId !== keyContext.productId ||
    body.accountId !== keyContext.accountId ||
    body.type !== "product-space-key" ||
    typeof body.keyId !== "string" ||
    body.keyId.length < 1 ||
    !Number.isInteger(body.keyVersion) ||
    Number(body.keyVersion) < 1 ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length < 16 ||
    typeof body.iv !== "string" ||
    body.iv.length < 16
  ) {
    return Response.json({ error: "Invalid product key envelope" }, { status: 400 });
  }

  const keyVersion = Number(body.keyVersion);
  const keyId = [
    "spk",
    keyContext.spaceId,
    keyContext.productId,
    keyContext.accountId,
    `v${keyVersion}`,
  ].join(":");
  const key = await SpaceProductKey.findOneAndUpdate(
    { _id: keyId },
    {
      $set: {
        spaceId: keyContext.spaceId,
        productId: keyContext.productId,
        memberAccountId: keyContext.accountId,
        keyVersion,
        algorithm: "AES-256-GCM",
        ciphertext: body.ciphertext,
        iv: body.iv,
        aadVersion: 1,
        status: "active",
        createdByAccountId: keyContext.accountId,
      },
    },
    { upsert: true, new: true, runValidators: true },
  ).lean();

  return Response.json({ key }, { status: 201 });
}
