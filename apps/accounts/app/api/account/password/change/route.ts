import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { AuditEvent, TrustedSecondFactor, UserVault } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { needsSecondFactor } from "@/lib/second-factor-state";
import {
  requireSameOrigin,
  revokeProductSessions,
} from "@/lib/logout-coordinator";

/** Change sign-in credentials only; this endpoint never accepts a Vault wrap. */
export async function POST(request: Request) {
  const denied = await authorizeAccountsApiRequest(request);
  if (denied) return denied;
  try {
    requireSameOrigin(
      request,
      new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
        .origin,
    );
  } catch (response) {
    return response as Response;
  }
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (needsSecondFactor(session))
    return Response.json({ error: "Second factor required" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !body ||
    Object.keys(body).some(
      (key) =>
        !["currentPassword", "newPassword", "revokeOtherSessions"].includes(
          key,
        ),
    ) ||
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string" ||
    body.newPassword.length < 12 ||
    body.newPassword.length > 128 ||
    (body.revokeOtherSessions !== undefined &&
      typeof body.revokeOtherSessions !== "boolean")
  ) {
    return Response.json(
      { error: "Invalid sign-in password change" },
      { status: 400 },
    );
  }
  if (
    !(await UserVault.exists({
      accountId: session.user.id,
      passwordMode: "separate",
    }))
  ) {
    return Response.json(
      {
        error:
          "Separate your Vault password before changing your sign-in password.",
        code: "vault_password_migration_required",
      },
      { status: 409 },
    );
  }
  let result;
  try {
    result = await auth.api.changePassword({
      headers: request.headers,
      returnHeaders: true,
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: body.revokeOtherSessions === true,
      },
    });
  } catch {
    return Response.json(
      { error: "The sign-in password could not be changed." },
      { status: 400 },
    );
  }
  if (body.revokeOtherSessions) {
    await revokeProductSessions({
      accountId: session.user.id,
      exceptIssuerSessionId: session.session.id,
      action: "password_changed",
    });
    await TrustedSecondFactor.updateMany(
      { accountId: session.user.id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
  }
  await AuditEvent.create({
    accountId: session.user.id,
    action: "account.password.changed",
    metadata: { revokedOtherDevices: body.revokeOtherSessions === true },
  }).catch(() => undefined);
  const headers = new Headers(result.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { headers });
}

/** Old clients must reload; staged credential/envelope coupling is retired. */
export function PUT() {
  return Response.json(
    { error: "Reload Xenode to use separate sign-in and Vault passwords." },
    { status: 410 },
  );
}
export const DELETE = PUT;
