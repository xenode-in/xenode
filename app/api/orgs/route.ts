import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import {
  assertOrganizationsEnabled,
  type OrganizationRecord,
} from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

type MemberRecord = {
  id?: string;
  organizationId: string;
  userId: string;
  role?: string | null;
  createdAt?: Date;
};

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "organization";
}

function newPluginId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function serializeOrg(
  org: OrganizationRecord,
  member: MemberRecord,
  activeOrgId?: string | null,
) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug ?? null,
    logo: org.logo ?? null,
    role: member.role ?? "member",
    isActive: activeOrgId === org.id,
    createdAt: org.createdAt ?? null,
    updatedAt: org.updatedAt ?? null,
  };
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function normalizeSlug(value: unknown, fallback: string): string {
  return slugify(typeof value === "string" && value.trim() ? value : fallback);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    await dbConnect();

    const members = await mongoose.connection
      .collection<MemberRecord>("member")
      .find({ userId: ctx.userId })
      .sort({ createdAt: -1 })
      .toArray();
    const orgIds = members.map((member) => member.organizationId);

    if (orgIds.length === 0) {
      return NextResponse.json({ organizations: [] });
    }

    const orgs = await mongoose.connection
      .collection<OrganizationRecord>("organization")
      .find({ id: { $in: orgIds } })
      .toArray();
    const orgById = new Map(orgs.map((org) => [org.id, org]));
    const activeOrgId = (ctx.session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId;

    return NextResponse.json({
      organizations: members
        .map((member) => {
          const org = orgById.get(member.organizationId);
          return org ? serializeOrg(org, member, activeOrgId) : null;
        })
        .filter(Boolean),
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list organizations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const body = await request.json().catch(() => ({}));
    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 },
      );
    }

    const slug = normalizeSlug(body.slug, name);
    const ownerWrappedSpaceKey =
      typeof body.ownerWrappedSpaceKey === "string"
        ? body.ownerWrappedSpaceKey.trim()
        : "";
    const keyVersion = Number.isInteger(Number(body.keyVersion))
      ? Number(body.keyVersion)
      : 1;

    if (ownerWrappedSpaceKey && keyVersion < 1) {
      return NextResponse.json(
        { error: "keyVersion must be a positive integer" },
        { status: 400 },
      );
    }

    await dbConnect();
    const organizations = mongoose.connection.collection<OrganizationRecord>(
      "organization",
    );
    const members = mongoose.connection.collection<MemberRecord>("member");

    const existing = await organizations.findOne({ slug });
    if (existing) {
      return NextResponse.json(
        { error: "Organization slug is already taken" },
        { status: 409 },
      );
    }

    const now = new Date();
    const org: OrganizationRecord = {
      id: newPluginId("org"),
      name,
      slug,
      logo: null,
      createdAt: now,
      updatedAt: now,
    };
    const member: MemberRecord = {
      id: newPluginId("mem"),
      organizationId: org.id,
      userId: ctx.userId,
      role: "owner",
      createdAt: now,
    };

    try {
      await organizations.insertOne(org);
      await members.insertOne(member);
      if (ownerWrappedSpaceKey) {
        await OrgKeyGrant.create({
          orgId: org.id,
          teamId: null,
          memberUserId: ctx.userId,
          wrappedSpaceKey: ownerWrappedSpaceKey,
          keyVersion,
          wrappedByUserId: ctx.userId,
          createdBy: ctx.userId,
          rotationReason: "initial",
        });
      }
    } catch (error) {
      await organizations.deleteOne({ id: org.id }).catch(() => {});
      await members
        .deleteOne({ organizationId: org.id, userId: ctx.userId })
        .catch(() => {});
      throw error;
    }

    return NextResponse.json(
      {
        organization: serializeOrg(org, member, null),
        spaceKeyReady: !!ownerWrappedSpaceKey,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to create organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
