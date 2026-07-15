import { connectDatabase, getDatabase } from "../connection";
import { createAccountRepository } from "./accounts";

export * from "./accounts";
export * from "./types";

export async function listExternalAccountsForUser(userId: string) {
  await connectDatabase();
  return createAccountRepository(getDatabase()).listForUser(userId);
}
