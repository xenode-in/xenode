import type { NextRequest } from "next/server";
import {
  spaceIdSchema,
  type ProductSlug,
  type SpaceId,
  type SpaceRole,
} from "@xenode/contracts";
import {
  ensurePersonalSpace,
  personalSpaceId,
  resolveSpaceAccess,
  SpaceAuthorizationError,
  type SpaceAccess,
} from "@xenode/spaces";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { setActiveRegion } from "@/lib/storage/region-context";
import { resolveContextStorageRegion } from "@/lib/storage/region";
import { AuthzError } from "./errors";

type BetterAuthSession = Awaited<ReturnType<typeof getServerSession>>;


export interface AccessContext {
  userId: string;
  accountId: string;
  spaceId: SpaceId;
  productId: ProductSlug;
  role: SpaceRole;
  spaceType: SpaceAccess["space"]["type"];
  organizationId?: string;
  teamId?: string;
  session: NonNullable<BetterAuthSession>;
}

function requestedSpaceId(
  request: NextRequest | undefined,
  accountId: string,
): SpaceId {
  const raw =
    request?.headers.get("x-xenode-space-id") ??
    request?.nextUrl.searchParams.get("spaceId");
  return raw ? spaceIdSchema.parse(raw) : personalSpaceId(accountId);
}


export async function getAccessContext(
  request?: NextRequest,
): Promise<AccessContext | null> {
  const session = await getServerSession(request);
  if (!session?.user?.id) return null;

  const accountId = session.user.id;
  await dbConnect();

  const spaceId = requestedSpaceId(request, accountId);
  if (spaceId === personalSpaceId(accountId)) {
    await ensurePersonalSpace(accountId);
  }

  try {
    const access = await resolveSpaceAccess({
      accountId,
      spaceId,
      productId: "drive",
    });
    const context: AccessContext = {
      userId: accountId,
      accountId,
      spaceId,
      productId: "drive",
      role: access.role,
      spaceType: access.space.type,
      organizationId: access.space.organizationId,
      teamId: access.space.teamId,
      session,
    };
    // Bind the caller's storage region for the rest of this request so all S3
    // operations target their regional bucket (default region ⇒ unchanged).
    setActiveRegion(await resolveContextStorageRegion(context));
    return context;
  } catch (error) {
    if (error instanceof SpaceAuthorizationError) {
      throw new AuthzError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export async function requireAccessContext(
  request?: NextRequest,
): Promise<AccessContext> {
  const context = await getAccessContext(request);
  if (!context) {
    throw new AuthzError(401, "unauthorized", "Unauthorized");
  }
  return context;
}
