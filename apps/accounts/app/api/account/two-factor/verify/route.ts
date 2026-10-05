import { getServerProductOrigin } from "@xenode/config";
import {
  connectDatabase,
  getDatabase,
  createAuthSecurityRepository,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import {
  SECOND_FACTOR_LOCKOUT,
  needsSecondFactor,
} from "@/lib/second-factor-state";
import {
  TRUSTED_SECOND_FACTOR_COOKIE,
  TRUSTED_SECOND_FACTOR_MAX_AGE,
  createTrustedSecondFactor,
} from "@/lib/trusted-second-factor";

type Auth = Awaited<ReturnType<typeof getAccountsAuth>>;
interface VerificationBody {
  code: string;
  trustDevice: boolean;
  method: "totp" | "backup";
}

const TOTP_CODE = /^\d{6}$/u;
const BACKUP_CODE = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/u;

function accountsOrigin() {
  return new URL(getServerProductOrigin("accounts"))
    .origin;
}

function parseBody(value: unknown): VerificationBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.trustDevice !== "boolean") return null;
  if (body.method === "totp" && typeof body.code === "string") {
    return TOTP_CODE.test(body.code)
      ? { code: body.code, trustDevice: body.trustDevice, method: "totp" }
      : null;
  }
  if (body.method === "backup" && typeof body.code === "string") {
    return BACKUP_CODE.test(body.code)
      ? { code: body.code, trustDevice: body.trustDevice, method: "backup" }
      : null;
  }
  return null;
}

function invalidCode() {
  return Response.json(
    { error: "That code is invalid or has expired." },
    { status: 401 },
  );
}

function lockedOut(lockedUntil: Date | null) {
  const retryAfter = lockedUntil
    ? Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000))
    : SECOND_FACTOR_LOCKOUT.lockDurationMs / 1000;
  return Response.json(
    { error: "Too many attempts. Try again later." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}

function verify(auth: Auth, request: Request, body: VerificationBody) {
  return body.method === "backup"
    ? auth.api.verifyBackupCode({
        body: {
          code: body.code,
          trustDevice: body.trustDevice,
          disableSession: false,
        },
        headers: request.headers,
        returnHeaders: true,
      })
    : auth.api.verifyTOTP({
        body: { code: body.code, trustDevice: body.trustDevice },
        headers: request.headers,
        returnHeaders: true,
      });
}

async function success(
  verificationHeaders: Headers,
  trustedAccountId: string | null,
) {
  const headers = new Headers(verificationHeaders);
  if (trustedAccountId) {
    const token = await createTrustedSecondFactor(trustedAccountId);
    headers.append(
      "set-cookie",
      `${TRUSTED_SECOND_FACTOR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TRUSTED_SECOND_FACTOR_MAX_AGE}${
        accountsOrigin().startsWith("https://") ? "; Secure" : ""
      }`,
    );
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { headers });
}

function statusCode(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : null;
}

/**
 * Sign-in challenge (password + two-factor cookie, no session yet). Better
 * Auth enforces its per-challenge and account lockout budgets here.
 */
async function completeSignInChallenge(
  auth: Auth,
  request: Request,
  body: VerificationBody,
) {
  let result: Awaited<ReturnType<typeof verify>>;
  try {
    result = await verify(auth, request, body);
  } catch (error) {
    return statusCode(error) === 429 ? lockedOut(null) : invalidCode();
  }
  const user = (result.response as { user?: { id?: unknown } } | null)?.user;
  return success(
    result.headers,
    body.trustDevice && typeof user?.id === "string" ? user.id : null,
  );
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return Response.json(
      { error: "Invalid verification code" },
      { status: 400 },
    );
  }
  const auth = await getAccountsAuth();
  const existing = await auth.api.getSession({ headers: request.headers });
  if (!existing) return completeSignInChallenge(auth, request, body);
  if (!needsSecondFactor(existing)) return Response.json({ ok: true });

  // Session step-up. Better Auth skips its attempt budget when a session
  // exists, so spend one attempt from the shared account budget before the
  // code is checked; parallel guesses cannot exceed the lockout limit.
  await connectDatabase();
  const accountId = existing.user.id;
  const repository = createAuthSecurityRepository(getDatabase());
  const reservation = await repository.reserveSecondFactorAttempt({
    accountId,
    maxFailedAttempts: SECOND_FACTOR_LOCKOUT.maxFailedAttempts,
  });
  if (reservation.status === "not_enrolled") {
    return Response.json(
      { error: "Two-step verification is not set up." },
      { status: 409 },
    );
  }
  if (reservation.status === "locked") {
    return lockedOut(reservation.lockedUntil);
  }

  let result: Awaited<ReturnType<typeof verify>>;
  try {
    result = await verify(auth, request, body);
  } catch {
    const lockedUntil = await repository.recordSecondFactorFailure({
      accountId,
      ...SECOND_FACTOR_LOCKOUT,
    });
    return lockedUntil ? lockedOut(lockedUntil) : invalidCode();
  }
  await repository.resetSecondFactorFailures(accountId);
  const updated = await repository.markSecondFactorVerified({
    accountId,
    sessionId: existing.session.id,
  });
  if (!updated) {
    return Response.json(
      { error: "Session expired. Sign in again." },
      { status: 401 },
    );
  }
  return success(result.headers, body.trustDevice ? accountId : null);
}
