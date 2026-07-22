import {
  AccountProfile,
  AuditEvent,
  connectDatabase,
  getDatabase,
  getMongoose,
} from "@xenode/database";
import { auditActionLabel } from "@/lib/presentation";

type UserRow = {
  _id?: unknown;
  id?: string;
  name?: string;
  email?: string;
  username?: string;
  displayUsername?: string;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

type MemberRow = {
  organizationId: string;
  userId: unknown;
  role?: string | null;
  createdAt?: Date;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  deletedAt?: Date | null;
  createdAt?: Date;
};

function accountIds(accountId: string): unknown[] {
  const ids: unknown[] = [accountId];
  const mongoose = getMongoose();
  if (mongoose.isValidObjectId(accountId)) ids.push(new mongoose.Types.ObjectId(accountId));
  return ids;
}

function userFilter(accountId: string) {
  const mongoose = getMongoose();
  if (mongoose.isValidObjectId(accountId)) {
    return {
      $or: [
        { _id: new mongoose.Types.ObjectId(accountId) },
        { id: accountId },
      ],
    };
  }
  return { id: accountId };
}

export async function loadProfile(accountId: string) {
  await connectDatabase();
  const [user, preferences] = await Promise.all([
    getDatabase().collection<UserRow>("user").findOne(userFilter(accountId)),
    AccountProfile.findOne({ accountId }).lean(),
  ]);
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    username: user?.username ?? "",
    displayUsername: user?.displayUsername ?? user?.username ?? "",
    emailVerified: user?.emailVerified === true,
    defaultEncrypt: preferences?.defaultEncrypt !== false,
    createdAt: user?.createdAt?.toISOString() ?? null,
  };
}

export async function loadSecurityActivity(accountId: string) {
  await connectDatabase();
  const events = await AuditEvent.find({ accountId })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("action productId spaceId createdAt")
    .lean();
  return events.map((event) => ({
    id: String(event._id),
    action: event.action,
    label: auditActionLabel(event.action),
    productId: event.productId ?? null,
    spaceId: event.spaceId ?? null,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function loadOrganizations(accountId: string) {
  await connectDatabase();
  const database = getDatabase();
  const members = await database
    .collection<MemberRow>("member")
    .find({ userId: { $in: accountIds(accountId) } })
    .sort({ createdAt: -1 })
    .toArray();
  if (members.length === 0) return [];

  const organizations = await database
    .collection<OrganizationRow>("organization")
    .find({ id: { $in: members.map((member) => member.organizationId) } })
    .toArray();
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  return members.flatMap((member) => {
    const organization = byId.get(member.organizationId);
    if (!organization || organization.deletedAt) return [];
    return [{
      id: organization.id,
      name: organization.name,
      slug: organization.slug ?? null,
      role: member.role ?? "member",
      joinedAt: member.createdAt?.toISOString() ?? null,
    }];
  });
}

export async function loadUsage(accountId: string) {
  await connectDatabase();
  const database = getDatabase();
  const now = new Date();
  const [usage, billing, productSessions, organizationCount] = await Promise.all([
    database.collection<{
      userId: string;
      accountId?: string | null;
      totalStorageBytes?: number;
      totalEgressBytes?: number;
      totalObjects?: number;
      totalBuckets?: number;
      storageLimitBytes?: number | null;
      plan?: string;
      uploadCount?: number;
      downloadCount?: number;
      lastActiveAt?: Date | null;
    }>("usages").findOne({
      $or: [{ userId: accountId }, { accountId }],
    }),
    database.collection<{
      accountId: string;
      plan: string;
      status: string;
      expiresAt?: Date;
    }>("billingAccounts").findOne({ accountId }),
    database.collection<{ productId: string }>("productSessions").distinct("productId", {
      accountId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    }),
    database.collection("member").countDocuments({ userId: { $in: accountIds(accountId) } }),
  ]);

  return {
    plan: billing?.plan ?? usage?.plan ?? "free",
    status: billing?.status ?? "active",
    planExpiresAt: billing?.expiresAt?.toISOString() ?? null,
    storageBytes: usage?.totalStorageBytes ?? 0,
    storageLimitBytes: usage?.storageLimitBytes ?? 5 * 1024 ** 3,
    egressBytes: usage?.totalEgressBytes ?? 0,
    objects: usage?.totalObjects ?? 0,
    buckets: usage?.totalBuckets ?? 0,
    uploads: usage?.uploadCount ?? 0,
    downloads: usage?.downloadCount ?? 0,
    lastActiveAt: usage?.lastActiveAt?.toISOString() ?? null,
    activeProducts: productSessions.sort(),
    organizations: organizationCount,
  };
}

export { userFilter };
