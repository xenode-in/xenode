"use client";

export async function startPhotosLogout(): Promise<void> {
  const accountsOrigin =
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
    "https://accounts.xenode.in";
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
