import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSpaceAccess } from "@xenode/spaces";
import { getServerSession } from "@/lib/auth/session";
import { POST } from "@/app/api/key-handoffs/[transactionId]/consume/route";

vi.mock("@xenode/spaces", async () => {
  const actual = await vi.importActual<typeof import("@xenode/spaces")>(
    "@xenode/spaces",
  );
  return { ...actual, resolveSpaceAccess: vi.fn() };
});

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedResolveSpaceAccess = vi.mocked(resolveSpaceAccess);

const binding = {
  accountId: "account_1",
  clientId: "xenode-drive-web",
  productId: "drive",
  spaceId: "personal:account_1",
  destinationOrigin: "https://drive.xenode.in",
  state: "state-value-long-enough",
  nonce: "nonce-value-long-enough",
};

function request(body: unknown) {
  return new NextRequest("https://drive.xenode.in/api/key-handoffs/tx/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Drive key handoff proxy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedGetServerSession.mockResolvedValue({
      user: {
        id: "account_1",
        name: "Account",
        email: "account@example.com",
        emailVerified: true,
      },
      session: {
        id: "drive-session",
        token: "drive-session",
        userId: "account_1",
        productId: "drive",
        sessionVersion: 1,
        activeOrganizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockedResolveSpaceAccess.mockResolvedValue({} as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ciphertext: "sealed-only" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("forwards only the bound ciphertext using the Drive ProductSession", async () => {
    const response = await POST(request(binding), {
      params: Promise.resolve({ transactionId: "tx_1" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ciphertext: "sealed-only" });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://accounts.xenode.in/api/key-handoffs/tx_1/consume"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer drive-session",
        }),
        body: JSON.stringify(binding),
      }),
    );
  });

  it("rejects cross-account and wrong-Space requests before contacting Accounts", async () => {
    const crossAccount = await POST(
      request({ ...binding, accountId: "account_2" }),
      { params: Promise.resolve({ transactionId: "tx_1" }) },
    );
    expect(crossAccount.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();

    mockedResolveSpaceAccess.mockRejectedValueOnce(new Error("not found"));
    const wrongSpace = await POST(
      request({ ...binding, spaceId: "personal:account_2" }),
      { params: Promise.resolve({ transactionId: "tx_2" }) },
    );
    expect(wrongSpace.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
