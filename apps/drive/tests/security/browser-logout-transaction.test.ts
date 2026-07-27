import { describe, expect, it } from "vitest";
import {
  BrowserLogoutTransaction,
  consumeBrowserLogoutCleanupTicket,
  createBrowserLogoutTransaction,
  deriveBrowserLogoutCleanupToken,
  findBrowserLogoutTransaction,
} from "@xenode/database";

describe("browser logout transactions", () => {
  it("stores only hashes and consumes each product cleanup ticket once", async () => {
    const transaction = await createBrowserLogoutTransaction({
      accountId: "acct_1",
      issuerSessionId: "accounts_session_1",
      initiatingProduct: "drive",
    });
    const stored = await BrowserLogoutTransaction.findOne().lean();
    expect(stored?.transactionIdHash).not.toContain(transaction.token);
    expect(
      stored?.cleanupTickets.every(
        (ticket) => !ticket.tokenHash.includes(transaction.token),
      ),
    ).toBe(true);

    await expect(
      findBrowserLogoutTransaction(transaction.token),
    ).resolves.toMatchObject({
      accountId: "acct_1",
      issuerSessionId: "accounts_session_1",
    });
    const driveTicket = deriveBrowserLogoutCleanupToken(
      transaction.token,
      "drive",
    );
    await expect(
      consumeBrowserLogoutCleanupTicket(driveTicket, "drive"),
    ).resolves.toMatchObject({ accountId: "acct_1" });
    await expect(
      consumeBrowserLogoutCleanupTicket(driveTicket, "drive"),
    ).resolves.toBeNull();
    await expect(
      consumeBrowserLogoutCleanupTicket(driveTicket, "photos"),
    ).resolves.toBeNull();
  });
});
