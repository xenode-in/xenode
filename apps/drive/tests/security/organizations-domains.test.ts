import { NextRequest } from "next/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveTxt } from "dns/promises";
import { GET as domainsGET, POST as domainsPOST } from "@/app/api/orgs/[orgId]/domains/route";
import { POST as verifyPOST } from "@/app/api/orgs/[orgId]/domains/[domainId]/verify/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import OrgDomain from "@/models/OrgDomain";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(),
}));

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedResolveTxt = vi.mocked(resolveTxt);

function mockSession(userId = "admin_1", activeOrganizationId = "org_1") {
  mockedGetServerSession.mockResolvedValue({
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: `session-${userId}`,
      userId,
      token: `token-${userId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      activeOrganizationId,
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function insertOrg(role = "admin", userId = "admin_1") {
  await Bucket.db.collection("organization").insertOne({
    id: "org_1",
    name: "Acme",
    slug: "acme",
    logo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await Bucket.db.collection("member").insertOne({
    id: `mem_${userId}`,
    organizationId: "org_1",
    userId,
    role,
    createdAt: new Date(),
  });
}

function orgParams(orgId = "org_1") {
  return { params: Promise.resolve({ orgId }) };
}

function verifyParams(domainId: string, orgId = "org_1") {
  return { params: Promise.resolve({ orgId, domainId }) };
}

describe("organization domain verification API", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedGetServerSession.mockReset();
    mockedResolveTxt.mockReset();
  });

  it("allows admins to add and list verification domains", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await insertOrg("admin", "admin_1");

    const createResponse = await domainsPOST(
      new NextRequest("http://localhost/api/orgs/org_1/domains", {
        method: "POST",
        body: JSON.stringify({ domain: "https://Example.com/path" }),
        headers: { "content-type": "application/json" },
      }),
      orgParams(),
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.domain.domain).toBe("example.com");
    expect(createBody.domain.verificationToken).toMatch(
      /^xenode-org-verification=/,
    );

    const listResponse = await domainsGET(
      new NextRequest("http://localhost/api/orgs/org_1/domains"),
      orgParams(),
    );
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.domains).toHaveLength(1);
  });

  it("requires owner or admin role to add domains", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await insertOrg("member", "member_1");

    const response = await domainsPOST(
      new NextRequest("http://localhost/api/orgs/org_1/domains", {
        method: "POST",
        body: JSON.stringify({ domain: "example.com" }),
        headers: { "content-type": "application/json" },
      }),
      orgParams(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_role_required",
    });
  });

  it("marks a domain verified only when the DNS TXT token is present", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await insertOrg("owner", "owner_1");
    const domain = await OrgDomain.create({
      orgId: "org_1",
      domain: "example.com",
      verificationToken: "xenode-org-verification=abc123",
      status: "pending",
      method: "dns_txt",
      createdBy: "owner_1",
    });
    mockedResolveTxt.mockResolvedValue([["xenode-org-verification=abc123"]]);

    const response = await verifyPOST(
      new NextRequest(
        `http://localhost/api/orgs/org_1/domains/${domain._id}/verify`,
        { method: "POST" },
      ),
      verifyParams(domain._id.toString()),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.domain.status).toBe("verified");
    await expect(OrgDomain.findById(domain._id).lean()).resolves.toMatchObject({
      status: "verified",
    });
  });
});
