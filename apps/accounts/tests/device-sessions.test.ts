import { describe, expect, it } from "vitest";
import {
  describeUserAgent,
  groupAccountDevices,
} from "../lib/device-sessions";

describe("Accounts device presentation", () => {
  it("recognizes common desktop and mobile user agents", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
      ),
    ).toEqual({
      title: "Windows computer",
      platform: "Windows",
      browser: "Microsoft Edge",
      kind: "desktop",
    });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 16; Pixel 9 Build/BP2A) AppleWebKit/537.36 Chrome/150.0 Mobile Safari/537.36",
      ),
    ).toMatchObject({
      title: "Pixel 9",
      platform: "Android",
      browser: "Google Chrome",
      kind: "mobile",
    });
  });

  it("groups Drive and Photos access under the issuing browser session", () => {
    const devices = groupAccountDevices({
      currentSessionId: "accounts-session-1",
      now: new Date("2026-07-28T12:00:00.000Z"),
      browserSessions: [
        {
          id: "accounts-session-1",
          createdAt: new Date("2026-07-27T10:00:00.000Z"),
          updatedAt: new Date("2026-07-28T11:00:00.000Z"),
          expiresAt: new Date("2026-08-04T10:00:00.000Z"),
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36",
        },
      ],
      productSessions: [
        {
          sessionId: "drive-session",
          issuerSessionId: "accounts-session-1",
          productId: "drive",
          authenticatedAt: new Date("2026-07-28T09:00:00.000Z"),
          expiresAt: new Date("2026-08-04T09:00:00.000Z"),
        },
        {
          sessionId: "photos-session",
          issuerSessionId: "accounts-session-1",
          productId: "photos",
          authenticatedAt: new Date("2026-07-28T10:00:00.000Z"),
          expiresAt: new Date("2026-08-04T10:00:00.000Z"),
        },
      ],
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      deviceId: "accounts-session-1",
      isCurrent: true,
      title: "Windows computer",
    });
    expect(devices[0]?.productAccess.map((item) => item.productId)).toEqual([
      "photos",
      "drive",
    ]);
  });

  it("keeps legacy product sessions visible when the browser session is gone", () => {
    const devices = groupAccountDevices({
      currentSessionId: "current",
      now: new Date("2026-07-28T12:00:00.000Z"),
      browserSessions: [],
      productSessions: [
        {
          sessionId: "drive-session",
          issuerSessionId: "old-browser-session",
          productId: "drive",
          authenticatedAt: new Date("2026-07-28T09:00:00.000Z"),
          expiresAt: new Date("2026-08-04T09:00:00.000Z"),
        },
      ],
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      deviceId: "old-browser-session",
      title: "Unknown device",
      isActive: true,
    });
  });
});
