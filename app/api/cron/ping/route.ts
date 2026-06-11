import { NextRequest, NextResponse } from "next/server";

/**
 * Cron health-check endpoint — use this to verify the cron sidecar is alive
 * and can reach the app container over the internal Docker network.
 *
 * Returns the current server time and environment so you can confirm:
 *  - The cron container is firing jobs
 *  - The CRON_SECRET is correct (otherwise you get 401)
 *  - The app container is reachable at http://app:3000
 *
 * Once cron is confirmed working in production, remove this from the schedule
 * (or keep it — it's harmless, just a lightweight ping).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  console.log(`[Cron] ping at ${now.toISOString()}`);

  return NextResponse.json({
    ok: true,
    message: "Cron sidecar is working ✓",
    serverTime: now.toISOString(),
    environment: process.env.NODE_ENV,
  });
}
