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
import { listUserOrgs } from "@/lib/orgs/listUserOrgs";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";
import OrgKeyGrant from "@/models/OrgKeyGrant";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";

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

const ORG_TYPES = [
  "company",
  "startup",
  "agency",
  "nonprofit",
  "education",
  "government",
  "personal",
  "other",
] as const;
const TEAM_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

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
    orgType: org.orgType ?? null,
    teamSize: org.teamSize ?? null,
    website: org.website ?? null,
    role: member.role ?? "member",
    isActive: activeOrgId === org.id,
    createdAt: org.createdAt ?? null,
    updatedAt: org.updatedAt ?? null,
  };
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Accepts an http(s) URL only (used for uploaded logo URLs); returns it or null. */
function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().slice(0, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Accepts a bare domain or full URL; returns a normalized https URL or null. */
function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().slice(0, 200);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSlug(value: unknown, fallback: string): string {
  return slugify(typeof value === "string" && value.trim() ? value : fallback);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();

    const activeOrgId = (ctx.session.session as {
      activeOrganizationId?: string | null;
    }).activeOrganizationId;
    const organizations = await listUserOrgs(ctx.userId, activeOrgId);

    return NextResponse.json({ organizations });
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
    const orgType = normalizeEnum(body.orgType, ORG_TYPES);
    if (!orgType) {
      return NextResponse.json(
        { error: "Organization type is required" },
        { status: 400 },
      );
    }
    const teamSize = normalizeEnum(body.teamSize, TEAM_SIZES);
    if (!teamSize) {
      return NextResponse.json(
        { error: "Team size is required" },
        { status: 400 },
      );
    }
    const website = normalizeWebsite(body.website);
    const logo = normalizeHttpUrl(body.logo);
    if (typeof body.logo === "string" && body.logo.trim() && !logo) {
      return NextResponse.json(
        { error: "Logo must be a valid URL" },
        { status: 400 },
      );
    }
    if (
      typeof body.website === "string" &&
      body.website.trim() &&
      !website
    ) {
      return NextResponse.json(
        { error: "Website must be a valid URL" },
        { status: 400 },
      );
    }
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
      logo,
      orgType,
      teamSize,
      website,
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
      await ensureOrganizationSpace({
        accountId: ctx.accountId,
        organizationId: org.id,
      });
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
      await ensureSystemWorkspaceBucketRecord("ORGANIZATION");
    } catch (error) {
      await organizations.deleteOne({ id: org.id }).catch(() => {});
      await members
        .deleteOne({ organizationId: org.id, userId: ctx.userId })
        .catch(() => {});
      throw error;
    }

    await emitActivity({
      orgId: org.id,
      action: ActivityAction.ORG_CREATED,
      actorUserId: ctx.userId,
      target: { type: "organization", id: org.id },
      metadata: { slug: org.slug },
    });

    return NextResponse.json(
      {
        organization: serializeOrg(org, member, null),
        spaceKeyReady: !!ownerWrappedSpaceKey,
        defaultBucketReady: true,
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
