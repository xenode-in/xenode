"use client";

import { getPublicProductOrigin } from "@xenode/config/client";

export async function startPhotosLogout(): Promise<void> {
  const accountsOrigin =
    getPublicProductOrigin("accounts");
  let logoutUrl = `${accountsOrigin}/logout`;
  try {
    const response = await fetch("/auth/logout/start", {
      method: "POST",
      credentials: "include",
    });
    const payload = (await response.json().catch(() => null)) as
      | { logoutUrl?: string }
      | null;
    logoutUrl = payload?.logoutUrl ?? logoutUrl;
  } finally {
    window.location.assign(logoutUrl);
  }
}
