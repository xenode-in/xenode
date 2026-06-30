import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/albums/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import PhotoAlbum from "@/models/PhotoAlbum";
import StorageObject from "@/models/StorageObject";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "user_1") {
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
      activeOrganizationId: "org_1",
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function createImage(userId: string) {
  const safeUserId = userId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const bucket = await Bucket.create({
    userId,
    name: `album-${safeUserId}`,
    b2BucketId: `b2-${userId}`,
  });

  return StorageObject.create({
    bucketId: bucket._id,
    userId,
    key: `users/${userId}/image`,
    size: 100,
    contentType: "image/jpeg",
    mediaCategory: "image",
    b2FileId: "b2-file",
    isEncrypted: true,
  });
}

describe("organization album route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("keeps album listing scoped to the personal owner", async () => {
    mockSession("user_1");
    await PhotoAlbum.create({
      userId: "user_1",
      name: "Mine",
      slug: "mine",
      objectIds: [],
    });
    await PhotoAlbum.create({
      userId: "user_2",
      name: "Theirs",
      slug: "theirs",
      objectIds: [],
    });

    const response = await GET(new NextRequest("http://localhost/api/albums"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.albums).toHaveLength(1);
    expect(body.albums[0].name).toBe("Mine");
  });

  it("creates albums only with personally owned images", async () => {
    mockSession("user_1");
    const ownImage = await createImage("user_1");
    const foreignImage = await createImage("user_2");

    const response = await POST(
      new NextRequest("http://localhost/api/albums", {
        method: "POST",
        body: JSON.stringify({
          name: "Camera",
          objectIds: [String(ownImage._id), String(foreignImage._id)],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.album.name).toBe("Camera");
    expect(body.album.objectIds).toEqual([String(ownImage._id)]);
  });

  it("fails closed for explicit org album listing until org albums are enabled", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await Bucket.db.collection("member").insertOne({
      userId: "user_1",
      organizationId: "org_1",
      role: "admin",
      createdAt: new Date(),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/albums?scope=organization"),
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      error: "Organization storage is not enabled yet",
      code: "organization_storage_not_ready",
    });
  });
});
