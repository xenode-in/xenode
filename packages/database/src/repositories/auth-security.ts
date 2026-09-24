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
  return {
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
            authMethod: "totp",
            twoFactorVerifiedAt: verifiedAt,
            updatedAt: verifiedAt,
          },
        },
      );
      return result.matchedCount === 1;
    },
  };
}
