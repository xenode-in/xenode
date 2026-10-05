import { getServerProductOrigin } from "@xenode/config";
import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { TrustedSecondFactor, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { TRUSTED_SECOND_FACTOR_COOKIE } from "@/lib/trusted-second-factor";

function accountsOrigin() {
  return new URL(
    getServerProductOrigin("accounts"),
  ).origin;
}

export async function DELETE(request: Request) {
  const denied = await authorizeAccountsApiRequest(request);
  if (denied) return denied;
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  await TrustedSecondFactor.updateMany(
    {
      accountId: session.user.id,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );
  const response = Response.json({ ok: true });
  response.headers.append(
    "set-cookie",
    `${TRUSTED_SECOND_FACTOR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
      accountsOrigin().startsWith("https://") ? "; Secure" : ""
    }`,
  );
  return response;
}
