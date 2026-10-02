import { mongo } from "mongoose";

/** Better Auth exposes string IDs, but its Mongo adapter stores native _ids. */
function storedIds(id: string): Array<string | mongo.ObjectId> {
  return mongo.ObjectId.isValid(id) ? [id, new mongo.ObjectId(id)] : [id];
}

interface StoredPasskey {
  _id: string | mongo.ObjectId;
  userId: string | mongo.ObjectId;
  credentialID: string;
  name?: string;
  createdAt?: Date;
  aaguid?: string;
}

interface StoredSession {
  _id: string | mongo.ObjectId;
  userId: string | mongo.ObjectId;
  expiresAt: Date;
  authMethod?: string;
  twoFactorVerifiedAt?: Date;
  updatedAt?: Date;
}

interface StoredUser {
  _id: string | mongo.ObjectId;
  twoFactorEnabled?: boolean | null;
}

/** Better Auth two-factor row; its lockout fields are shared with native sign-in. */
interface StoredTwoFactor {
  _id: string | mongo.ObjectId;
  userId: string | mongo.ObjectId;
  verified?: boolean | null;
  failedVerificationCount?: number | null;
  lockedUntil?: Date | null;
}

export type SecondFactorAttemptReservation =
  | { status: "reserved" }
  | { status: "locked"; lockedUntil: Date | null }
  | { status: "not_enrolled" };

export interface SecondFactorLockoutPolicy {
  maxFailedAttempts: number;
  lockDurationMs: number;
}

export interface AccountPasskeySummary {
  id: string;
  credentialID: string;
  name?: string;
  createdAt?: Date;
  aaguid?: string;
}

const passkeyProjection = {
  _id: 1,
  userId: 1,
  credentialID: 1,
  name: 1,
  createdAt: 1,
  aaguid: 1,
};

function summarize(record: StoredPasskey): AccountPasskeySummary {
  return {
    id: String(record._id),
    credentialID: record.credentialID,
    name: record.name,
    createdAt: record.createdAt,
    aaguid: record.aaguid,
  };
}

/** Uses the shared connection; every operation is explicitly account-scoped. */
export function createAuthSecurityRepository(
  database: Pick<mongo.Db, "collection">,
) {
  const passkeys = database.collection<StoredPasskey>("passkey");
  const sessions = database.collection<StoredSession>("session");
  const users = database.collection<StoredUser>("user");
  const twoFactors = database.collection<StoredTwoFactor>("twoFactor");
  const enrolledTwoFactor = (accountId: string) => ({
    userId: { $in: storedIds(accountId) },
    verified: { $ne: false },
  });
  return {
    async isTwoFactorEnabled(accountId: string): Promise<boolean> {
      const user = await users.findOne(
        { _id: { $in: storedIds(accountId) } },
        { projection: { twoFactorEnabled: 1 } },
      );
      return user?.twoFactorEnabled === true;
    },

    /**
     * Atomically spend one attempt from the account's consecutive-failure
     * budget before a code is checked, so parallel guesses cannot exceed it.
     * An expired lock restarts the budget, matching Better Auth's lockout.
     */
    async reserveSecondFactorAttempt(
      args: { accountId: string; now?: Date } & Pick<
        SecondFactorLockoutPolicy,
        "maxFailedAttempts"
      >,
    ): Promise<SecondFactorAttemptReservation> {
      const now = args.now ?? new Date();
      const enrolled = enrolledTwoFactor(args.accountId);
      await twoFactors.updateMany(
        { ...enrolled, lockedUntil: { $lte: now } },
        { $set: { failedVerificationCount: 0, lockedUntil: null } },
      );
      const reserved = await twoFactors.findOneAndUpdate(
        {
          ...enrolled,
          lockedUntil: null,
          $or: [
            { failedVerificationCount: null },
            { failedVerificationCount: { $lt: args.maxFailedAttempts } },
          ],
        },
        [
          {
            $set: {
              failedVerificationCount: {
                $add: [{ $ifNull: ["$failedVerificationCount", 0] }, 1],
              },
            },
          },
        ],
        { returnDocument: "after" },
      );
      if (reserved) return { status: "reserved" };
      const current = await twoFactors.findOne(enrolled, {
        projection: { lockedUntil: 1 },
      });
      if (!current) return { status: "not_enrolled" };
      return { status: "locked", lockedUntil: current.lockedUntil ?? null };
    },

    /** Lock the account once a reserved attempt fails at the budget limit. */
    async recordSecondFactorFailure(
      args: { accountId: string; now?: Date } & SecondFactorLockoutPolicy,
    ): Promise<Date | null> {
      const now = args.now ?? new Date();
      const enrolled = enrolledTwoFactor(args.accountId);
      await twoFactors.updateMany(
        {
          ...enrolled,
          failedVerificationCount: { $gte: args.maxFailedAttempts },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        { $set: { lockedUntil: new Date(now.getTime() + args.lockDurationMs) } },
      );
      const current = await twoFactors.findOne(enrolled, {
        projection: { lockedUntil: 1 },
      });
      return current?.lockedUntil && current.lockedUntil > now
        ? current.lockedUntil
        : null;
    },

    async resetSecondFactorFailures(accountId: string): Promise<void> {
      await twoFactors.updateMany(enrolledTwoFactor(accountId), {
        $set: { failedVerificationCount: 0, lockedUntil: null },
      });
    },

    async listPasskeysForUser(
      accountId: string,
    ): Promise<AccountPasskeySummary[]> {
      const records = await passkeys
        .find(
          { userId: { $in: storedIds(accountId) } },
          { projection: passkeyProjection },
        )
        .sort({ createdAt: -1 })
        .toArray();
      return records.map(summarize);
    },

    async findPasskeyForUser(args: {
      accountId: string;
      credentialId: string;
      passkeyId?: string;
    }): Promise<AccountPasskeySummary | null> {
      const record = await passkeys.findOne(
        {
          userId: { $in: storedIds(args.accountId) },
          credentialID: args.credentialId,
          ...(args.passkeyId === undefined
            ? {}
            : { _id: { $in: storedIds(args.passkeyId) } }),
        },
        { projection: passkeyProjection },
      );
      return record ? summarize(record) : null;
    },

    async markSecondFactorVerified(args: {
      accountId: string;
      sessionId: string;
      verifiedAt?: Date;
      method?: "totp" | "trusted-device";
    }): Promise<boolean> {
      const verifiedAt = args.verifiedAt ?? new Date();
      const result = await sessions.updateOne(
        {
          _id: { $in: storedIds(args.sessionId) },
          userId: { $in: storedIds(args.accountId) },
          expiresAt: { $gt: verifiedAt },
        },
        {
          $set: {
            authMethod: args.method ?? "totp",
            twoFactorVerifiedAt: verifiedAt,
            updatedAt: verifiedAt,
          },
        },
      );
      return result.matchedCount === 1;
    },
  };
}
