import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  BrowserLogoutTransaction,
  type BrowserLogoutTransactionRecord,
} from "../models";
import { connectDatabase } from "../connection";

export const BROWSER_LOGOUT_TTL_MS = 2 * 60 * 1000;
export const BROWSER_LOGOUT_PRODUCTS = ["drive", "photos"] as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function cleanupToken(transactionToken: string, productId: string): string {
  return createHmac("sha256", transactionToken)
    .update(`xenode-browser-logout:${productId}`, "utf8")
    .digest("base64url");
}

export function deriveBrowserLogoutCleanupToken(
  transactionToken: string,
  productId: (typeof BROWSER_LOGOUT_PRODUCTS)[number],
): string {
  return cleanupToken(transactionToken, productId);
}

export async function createBrowserLogoutTransaction(args: {
  accountId: string;
  issuerSessionId: string;
  initiatingProduct: string;
}): Promise<{ token: string; expiresAt: Date }> {
  await connectDatabase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + BROWSER_LOGOUT_TTL_MS);
  await BrowserLogoutTransaction.create({
    transactionIdHash: hashToken(token),
    accountId: args.accountId,
    issuerSessionId: args.issuerSessionId,
    initiatingProduct: args.initiatingProduct,
    cleanupTickets: BROWSER_LOGOUT_PRODUCTS.map((productId) => ({
      productId,
      tokenHash: hashToken(cleanupToken(token, productId)),
    })),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function findBrowserLogoutTransaction(
  token: string,
): Promise<BrowserLogoutTransactionRecord | null> {
  await connectDatabase();
  return BrowserLogoutTransaction.findOne({
    transactionIdHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();
}

export async function consumeBrowserLogoutCleanupTicket(
  token: string,
  productId: (typeof BROWSER_LOGOUT_PRODUCTS)[number],
): Promise<BrowserLogoutTransactionRecord | null> {
  await connectDatabase();
  const now = new Date();
  return BrowserLogoutTransaction.findOneAndUpdate(
    {
      expiresAt: { $gt: now },
      cleanupTickets: {
        $elemMatch: {
          productId,
          tokenHash: hashToken(token),
          consumedAt: { $exists: false },
        },
      },
    },
    { $set: { "cleanupTickets.$.consumedAt": now } },
    { returnDocument: "after" },
  ).lean();
}

export async function completeBrowserLogoutTransaction(
  token: string,
): Promise<void> {
  await connectDatabase();
  await BrowserLogoutTransaction.updateOne(
    {
      transactionIdHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    },
    { $set: { completedAt: new Date() } },
  );
}
