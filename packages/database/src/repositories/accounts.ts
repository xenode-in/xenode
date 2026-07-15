import { mongo } from "mongoose";

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

function possibleUserIds(userId: string): Array<string | mongo.ObjectId> {
  const ids: Array<string | mongo.ObjectId> = [userId];
  if (mongo.ObjectId.isValid(userId)) ids.push(new mongo.ObjectId(userId));
  return ids;
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
