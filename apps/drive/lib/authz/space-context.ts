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
import { resolveContextStorageRegion } from "@/lib/storage/region";
import type { StorageRegion } from "@xenode/config/storage";
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
  /** Immutable storage region for this caller — pick the physical bucket/client with it. */
  region: StorageRegion;
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
    const base = {
      userId: accountId,
      accountId,
      spaceId,
      productId: "drive" as const,
      role: access.role,
      spaceType: access.space.type,
      organizationId: access.space.organizationId,
      teamId: access.space.teamId,
      session,
    };
    // Resolve the caller's immutable storage region and carry it on the context.
    // Threaded explicitly (not via AsyncLocalStorage) because enterWith() set in
    // this callee does not survive the route handler's later awaits.
    const region = await resolveContextStorageRegion(base);
    return { ...base, region };
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
