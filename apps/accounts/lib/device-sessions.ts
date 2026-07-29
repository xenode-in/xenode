export type DeviceKind = "desktop" | "mobile" | "tablet" | "unknown";

export interface DeviceProductAccess {
  sessionId: string;
  productId: string;
  authenticatedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AccountDevice {
  deviceId: string;
  title: string;
  platform: string;
  browser: string;
  kind: DeviceKind;
  isCurrent: boolean;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  productAccess: DeviceProductAccess[];
}

type BrowserSessionInput = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  userAgent?: string | null;
};

type ProductSessionInput = {
  sessionId: string;
  issuerSessionId: string;
  productId: string;
  authenticatedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
};

export function describeUserAgent(userAgent?: string | null): Pick<
  AccountDevice,
  "title" | "platform" | "browser" | "kind"
> {
  if (!userAgent) {
    return {
      title: "Unknown device",
      platform: "Platform unavailable",
      browser: "Browser unavailable",
      kind: "unknown",
    };
  }

  let platform = "Unknown platform";
  let title = "Unknown device";
  let kind: DeviceKind = "unknown";

  if (/iPad/i.test(userAgent)) {
    platform = "iPadOS";
    title = "iPad";
    kind = "tablet";
  } else if (/iPhone|iPod/i.test(userAgent)) {
    platform = "iOS";
    title = "iPhone";
    kind = "mobile";
  } else if (/Android/i.test(userAgent)) {
    platform = "Android";
    kind = /Mobile/i.test(userAgent) ? "mobile" : "tablet";
    const model =
      userAgent.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i)?.[1]
        ?.replace(/^wv$/i, "")
        .trim();
    title = model
      ? model
      : kind === "tablet"
        ? "Android tablet"
        : "Android phone";
  } else if (/Windows NT/i.test(userAgent)) {
    platform = "Windows";
    title = "Windows computer";
    kind = "desktop";
  } else if (/Macintosh|Mac OS X/i.test(userAgent)) {
    platform = "macOS";
    title = "Mac";
    kind = "desktop";
  } else if (/CrOS/i.test(userAgent)) {
    platform = "ChromeOS";
    title = "Chromebook";
    kind = "desktop";
  } else if (/Linux/i.test(userAgent)) {
    platform = "Linux";
    title = "Linux computer";
    kind = "desktop";
  }

  let browser = "Unknown browser";
  if (/EdgA?\//i.test(userAgent)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(userAgent)) browser = "Opera";
  else if (/FxiOS\//i.test(userAgent)) browser = "Firefox";
  else if (/CriOS\//i.test(userAgent)) browser = "Google Chrome";
  else if (/Firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/Chrome\//i.test(userAgent)) browser = "Google Chrome";
  else if (/Safari\//i.test(userAgent)) browser = "Safari";

  return { title, platform, browser, kind };
}

export function groupAccountDevices(args: {
  browserSessions: BrowserSessionInput[];
  productSessions: ProductSessionInput[];
  currentSessionId: string;
  now?: Date;
}): AccountDevice[] {
  const now = args.now ?? new Date();
  const devices = new Map<string, AccountDevice>();

  for (const browserSession of args.browserSessions) {
    const description = describeUserAgent(browserSession.userAgent);
    devices.set(browserSession.id, {
      deviceId: browserSession.id,
      ...description,
      isCurrent: browserSession.id === args.currentSessionId,
      isActive: browserSession.expiresAt > now,
      createdAt: browserSession.createdAt.toISOString(),
      lastActiveAt: browserSession.updatedAt.toISOString(),
      expiresAt: browserSession.expiresAt.toISOString(),
      productAccess: [],
    });
  }

  for (const productSession of args.productSessions) {
    let device = devices.get(productSession.issuerSessionId);
    if (!device) {
      const active =
        !productSession.revokedAt && productSession.expiresAt > now;
      device = {
        deviceId: productSession.issuerSessionId,
        ...describeUserAgent(),
        isCurrent: productSession.issuerSessionId === args.currentSessionId,
        isActive: active,
        createdAt: productSession.authenticatedAt.toISOString(),
        lastActiveAt: productSession.authenticatedAt.toISOString(),
        expiresAt: productSession.expiresAt.toISOString(),
        productAccess: [],
      };
      devices.set(productSession.issuerSessionId, device);
    }

    device.productAccess.push({
      sessionId: productSession.sessionId,
      productId: productSession.productId,
      authenticatedAt: productSession.authenticatedAt.toISOString(),
      expiresAt: productSession.expiresAt.toISOString(),
      revokedAt: productSession.revokedAt?.toISOString() ?? null,
    });
    if (
      productSession.authenticatedAt.getTime() >
      new Date(device.lastActiveAt).getTime()
    ) {
      device.lastActiveAt = productSession.authenticatedAt.toISOString();
    }
  }

  for (const device of devices.values()) {
    device.productAccess.sort(
      (left, right) =>
        new Date(right.authenticatedAt).getTime() -
        new Date(left.authenticatedAt).getTime(),
    );
  }

  return [...devices.values()].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return (
      new Date(right.lastActiveAt).getTime() -
      new Date(left.lastActiveAt).getTime()
    );
  });
}
