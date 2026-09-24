import {
  connectDatabase,
  getDatabase,
  createAuthSecurityRepository,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import {
  TRUSTED_SECOND_FACTOR_COOKIE,
  TRUSTED_SECOND_FACTOR_MAX_AGE,
  createTrustedSecondFactor,
} from "@/lib/trusted-second-factor";

function accountsOrigin() {
  return new URL(process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in")
    .origin;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
    trustDevice?: unknown;
    method?: unknown;
  } | null;
  if (
    !body ||
    typeof body.code !== "string" ||
    body.code.length < 6 ||
    typeof body.trustDevice !== "boolean" ||
    (body.method !== "totp" && body.method !== "backup")
  ) {
    return Response.json(
      { error: "Invalid verification code" },
      { status: 400 },
    );
  }
  const auth = await getAccountsAuth();
  const existing = await auth.api.getSession({ headers: request.headers });
  try {
    const result =
      body.method === "backup"
        ? await auth.api.verifyBackupCode({
            body: {
              code: body.code,
              trustDevice: body.trustDevice,
              disableSession: false,
            },
            headers: request.headers,
            returnHeaders: true,
          })
        : await auth.api.verifyTOTP({
            body: { code: body.code, trustDevice: body.trustDevice },
            headers: request.headers,
            returnHeaders: true,
          });
    if (existing) {
      await connectDatabase();
      const updated = await createAuthSecurityRepository(
        getDatabase(),
      ).markSecondFactorVerified({
        accountId: existing.user.id,
        sessionId: existing.session.id,
      });
      if (!updated)
        return Response.json(
          { error: "Session expired. Sign in again." },
          { status: 401 },
        );
    }
    const headers = new Headers(result.headers);
    if (body.trustDevice && existing) {
      const token = await createTrustedSecondFactor(existing.user.id);
      headers.append(
        "set-cookie",
        `${TRUSTED_SECOND_FACTOR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TRUSTED_SECOND_FACTOR_MAX_AGE}${
          accountsOrigin().startsWith("https://") ? "; Secure" : ""
        }`,
      );
    }
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch {
    return Response.json(
      { error: "That code is invalid or has expired." },
      { status: 401 },
    );
  }
}
