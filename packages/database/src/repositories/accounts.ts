import { mongo } from "mongoose";
import { getDatabase, withTransaction } from "../connection";

export interface ExternalAccountRecord {
  _id: unknown;
  userId: unknown;
  accountId?: string;
  providerId?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

/** Better Auth exposes string ids; its Mongo adapter stores native ObjectIds. */
export function possibleUserIds(userId: string): Array<string | mongo.ObjectId> {
  const ids: Array<string | mongo.ObjectId> = [userId];
  if (mongo.ObjectId.isValid(userId)) ids.push(new mongo.ObjectId(userId));
  return ids;
}

/** Accounts-owned identity records keyed by the string account id. */
const ACCOUNT_OWNED_COLLECTIONS = [
  "userVaults",
  "vaultPasskeys",
  "vaultPasskeyChallenges",
  "accountPasskeyBindings",
  "trustedSecondFactors",
  "accountProfiles",
  "productSessions",
  "keyHandoffs",
  "browserLogoutTransactions",
] as const;

/**
 * Remove an account's identity in one transaction: the Better Auth user,
 * sessions, credentials, passkeys and second factor (matched by both id
 * forms), and the Accounts-owned vault, passkey bindings, profile and product
 * sessions. Billing and audit records are retained; product data is retired
 * separately.
 */
export async function deleteAccountIdentity(accountId: string): Promise<void> {
  const ids = possibleUserIds(accountId);
  await withTransaction(async (session) => {
    const db = getDatabase();
    await db.collection<{ _id: string | mongo.ObjectId; id?: string }>("user").deleteMany(
      { $or: [{ _id: { $in: ids } }, { id: accountId }] },
      { session },
    );
    for (const name of ["session", "account", "passkey", "twoFactor"]) {
      await db.collection(name).deleteMany({ userId: { $in: ids } }, { session });
    }
    for (const name of ACCOUNT_OWNED_COLLECTIONS) {
      await db.collection(name).deleteMany({ accountId }, { session });
    }
  });
}

export function createAccountRepository(database: Pick<mongo.Db, "collection">) {
  const collection = database.collection<ExternalAccountRecord>("account");

  return {
    async listForUser(userId: string): Promise<ExternalAccountRecord[]> {
      return collection
        .find({ userId: { $in: possibleUserIds(userId) } })
        .toArray();
    },
  };
}
