import { AuditEvent } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import {
  requireSameOrigin,
  revokeProductSessions,
} from "@/lib/logout-coordinator";
import { getAccountsSession } from "@/lib/session";

export async function DELETE(request: Request) {
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  try {
    requireSameOrigin(request, new URL(accountsOrigin).origin);
  } catch (response) {
    return response as Response;
  }

  const current = await getAccountsSession(request);
  if (!current) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { deviceId?: unknown }
    | null;
  if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return Response.json({ error: "deviceId is required" }, { status: 400 });
  }

  const deviceId = body.deviceId.trim();
  if (deviceId === current.session.id) {
    return Response.json(
      {
        error: "Use normal sign out for the current device.",
        code: "current_device",
      },
      { status: 409 },
    );
  }

  const auth = await getAccountsAuth();
  const browserSessions = await auth.api.listSessions({
    headers: request.headers,
  });
  const target = browserSessions.find((item) => item.id === deviceId);
  const revokedProductSessions = await revokeProductSessions({
    accountId: current.user.id,
    issuerSessionId: deviceId,
    action: "device_revoked",
  });

  if (target) {
    await auth.api.revokeSession({
      headers: request.headers,
      body: { token: target.token },
    });
  }

  if (!target && revokedProductSessions === 0) {
    return Response.json({ error: "Device not found" }, { status: 404 });
  }

  await AuditEvent.create({
    accountId: current.user.id,
    action: "account.device.revoked",
    metadata: {
      browserSessionRevoked: Boolean(target),
      revokedProductSessionCount: revokedProductSessions,
    },
  }).catch(() => undefined);

  return Response.json({
    ok: true,
    deviceId,
    revokedProductSessions,
  });
}
