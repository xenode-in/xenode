import { NextResponse } from "next/server";
import OrganizationPolicy from "@/models/OrganizationPolicy";

/**
 * Organization rules for public share links. They apply to edits as well as
 * new links: an edit cannot leave a link the policy would refuse to create.
 */
export async function enforceOrganizationSharePolicy(args: {
  orgId: string;
  hasPassword: boolean;
  hasExpiry: boolean;
}) {
  const policy = await OrganizationPolicy.findOneAndUpdate(
    { orgId: args.orgId },
    { $setOnInsert: { orgId: args.orgId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  if (policy?.allowPublicLinks === false) {
    return NextResponse.json(
      {
        error: "Public share links are disabled for this organization",
        code: "organization_public_links_disabled",
      },
      { status: 403 },
    );
  }

  if (policy?.requirePassword && !args.hasPassword) {
    return NextResponse.json(
      {
        error: "This organization requires a password for public share links",
        code: "organization_share_password_required",
      },
      { status: 400 },
    );
  }

  if (policy?.requireExpiry && !args.hasExpiry) {
    return NextResponse.json(
      {
        error: "This organization requires an expiry for public share links",
        code: "organization_share_expiry_required",
      },
      { status: 400 },
    );
  }

  return null;
}
