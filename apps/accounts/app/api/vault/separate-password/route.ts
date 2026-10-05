import { getServerProductOrigin } from "@xenode/config";
import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { ACCOUNTS_RATE_LIMITS } from "@/lib/sensitive-actions";
import { AuditEvent, UserVault, connectDatabase } from "@xenode/database";
import { getAccountsSession } from "@/lib/session";
import { needsSecondFactor } from "@/lib/second-factor-state";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { isPasswordEnvelope } from "@/lib/vault-validation";

/** Replace only the password envelope. The ARK and all other key wraps stay put. */
export async function PUT(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { recentAuth: true, rateLimit: ACCOUNTS_RATE_LIMITS.vaultWrite });
  if (denied) return denied;
  try {
    requireSameOrigin(
      request,
      new URL(getServerProductOrigin("accounts"))
        .origin,
    );
  } catch (response) {
    return response as Response;
  }
  const session = await getAccountsSession(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (needsSecondFactor(session))
    return Response.json({ error: "Second factor required" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const mutationId = request.headers.get("idempotency-key");
  if (
    !body ||
    Object.keys(body).some(
      (key) => !["expectedVaultRevision", "passwordEnvelope"].includes(key),
    ) ||
    !mutationId ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(mutationId) ||
    !Number.isInteger(body.expectedVaultRevision) ||
    Number(body.expectedVaultRevision) < 1 ||
    !isPasswordEnvelope(body.passwordEnvelope, session.user.id)
  ) {
    return Response.json(
      { error: "Invalid encrypted Vault password update" },
      { status: 400 },
    );
  }
  await connectDatabase();
  const update = await UserVault.findOneAndUpdate(
    {
      accountId: session.user.id,
      vaultRevision: Number(body.expectedVaultRevision),
    },
    {
      $set: {
        passwordEnvelope: body.passwordEnvelope,
        passwordMode: "separate",
        lastMutationId: mutationId,
      },
      $unset: {
        pendingPasswordEnvelope: 1,
        pendingPasswordMutationId: 1,
        pendingPasswordExpiresAt: 1,
      },
      $inc: { vaultRevision: 1 },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!update) {
    const prior = await UserVault.findOne({
      accountId: session.user.id,
      passwordMode: "separate",
      lastMutationId: mutationId,
      "passwordEnvelope.ciphertext": body.passwordEnvelope.ciphertext,
      "passwordEnvelope.iv": body.passwordEnvelope.iv,
    })
      .select("vaultRevision")
      .lean();
    if (prior)
      return Response.json({
        vaultRevision: prior.vaultRevision,
        idempotent: true,
      });
    return Response.json(
      {
        error: "Vault changed. Reload and try again.",
        code: "vault_revision_conflict",
      },
      { status: 409 },
    );
  }
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.password.updated",
    metadata: { revision: update.vaultRevision, passwordMode: "separate" },
  }).catch(() => undefined);
  return Response.json({ vaultRevision: update.vaultRevision });
}
