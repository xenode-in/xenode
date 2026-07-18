import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import {
  assertMemberInOrg,
  assertOrgAdminRole,
  assertOrgMember,
  assertTeamMember,
} from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import { organizationSpaceId, teamSpaceId } from "@xenode/spaces/ids";
import type { SpaceProductKeyRecord } from "@xenode/database/models";
import {
  listMemberProductKeys,
  putMemberProductKey,
  type KeyRotationReason,
} from "@xenode/spaces/product-keys";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

function serializeKey(key: SpaceProductKeyRecord) {
  return {
    _id: String(key._id),
    spaceId: key.spaceId,
    productId: key.productId,
    memberAccountId: key.memberAccountId,
    wrappedKey: key.ciphertext,
    keyVersion: key.keyVersion,
    formatVersion: key.formatVersion,
    algorithm: key.algorithm,
    status: key.status,
    rotationReason: key.rotationReason ?? null,
    createdByAccountId: key.createdByAccountId,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

function normalizeBody(body: Record<string, unknown>) {
  const memberAccountId =
    typeof body.memberAccountId === "string" ? body.memberAccountId.trim() : "";
  const wrappedKey =
    typeof body.wrappedKey === "string" ? body.wrappedKey.trim() : "";
  const keyVersion = Number(body.keyVersion);
  const teamId =
    typeof body.teamId === "string" && body.teamId.trim()
      ? body.teamId.trim()
      : null;
  const rotationReason =
    body.rotationReason === "member_added" ||
    body.rotationReason === "member_removed" ||
    body.rotationReason === "manual" ||
    body.rotationReason === "initial"
      ? (body.rotationReason as KeyRotationReason)
      : undefined;

  return { memberAccountId, wrappedKey, keyVersion, teamId, rotationReason };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const teamId = request.nextUrl.searchParams.get("teamId");

    await assertOrgMember({ userId: ctx.userId, orgId });
    if (teamId) {
      await assertTeamMember({ userId: ctx.userId, orgId, teamId });
    }

    await dbConnect();
    const spaceId = teamId
      ? teamSpaceId(orgId, teamId)
      : organizationSpaceId(orgId);
    const keys = await listMemberProductKeys({
      spaceId,
      productId: "drive",
      memberAccountId: ctx.accountId,
    });

    return NextResponse.json({ keys: keys.map(serializeKey) });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load product keys";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const body = await request.json().catch(() => ({}));
    const { memberAccountId, wrappedKey, keyVersion, teamId, rotationReason } =
      normalizeBody(body);

    if (!memberAccountId || !wrappedKey || !Number.isInteger(keyVersion) || keyVersion < 1) {
      return NextResponse.json(
        {
          error:
            "memberAccountId, wrappedKey, and positive integer keyVersion are required",
        },
        { status: 400 },
      );
    }

    const actorMembership = await assertOrgMember({ userId: ctx.userId, orgId });
    assertOrgAdminRole(actorMembership.role);
    const targetMembership = await assertMemberInOrg({
      userId: memberAccountId,
      orgId,
    });
    if (targetMembership.role === "guest") {
      return NextResponse.json(
        { error: "Guests cannot receive organization product keys" },
        { status: 403 },
      );
    }
    if (teamId) {
      await assertTeamMember({ userId: memberAccountId, orgId, teamId });
    }

    await dbConnect();
    const spaceId = teamId
      ? teamSpaceId(orgId, teamId)
      : organizationSpaceId(orgId);
    const key = await putMemberProductKey({
      spaceId,
      productId: "drive",
      memberAccountId,
      wrappedKey,
      keyVersion,
      createdByAccountId: ctx.accountId,
      rotationReason,
    });

    if (!key) throw new Error("Failed to persist product key");
    return NextResponse.json({ key: serializeKey(key) }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to save product key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
