import { AuditEvent, UserVault, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { isAccountEnvelope } from "@/lib/vault-validation";

function accountsOrigin() {
  return new URL(
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  ).origin;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }

  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { expectedVaultRevision?: unknown; passwordEnvelope?: unknown }
    | null;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !body ||
    !idempotencyKey ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(idempotencyKey) ||
    !Number.isInteger(body.expectedVaultRevision) ||
    Number(body.expectedVaultRevision) < 1 ||
    !isAccountEnvelope(
      body.passwordEnvelope,
      session.user.id,
      "password",
    ) ||
    !body.passwordEnvelope.kdfParams ||
    typeof body.passwordEnvelope.kdfParams !== "object"
  ) {
    return Response.json(
      { error: "Invalid password envelope" },
      { status: 400 },
    );
  }

  await connectDatabase();
  const vault = await UserVault.findOneAndUpdate(
    {
      accountId: session.user.id,
      vaultRevision: Number(body.expectedVaultRevision),
      $or: [
        { passwordEnvelope: null },
        { passwordEnvelope: { $exists: false } },
      ],
    },
    {
      $set: {
        passwordEnvelope: body.passwordEnvelope,
        lastMutationId: idempotencyKey,
      },
      $inc: { vaultRevision: 1 },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!vault) {
    const existing = await UserVault.findOne({
      accountId: session.user.id,
    })
      .select("vaultRevision passwordEnvelope lastMutationId")
      .lean();
    if (
      existing?.passwordEnvelope &&
      existing.lastMutationId === idempotencyKey
    ) {
      return Response.json({
        vaultRevision: existing.vaultRevision,
        idempotent: true,
      });
    }
    return Response.json(
      { error: "Vault revision conflict", code: "vault_revision_conflict" },
      { status: 409 },
    );
  }

  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.password-envelope.created",
    metadata: { revision: vault.vaultRevision, source: "oauth-continuation" },
  }).catch(() => undefined);

  return Response.json({ vaultRevision: vault.vaultRevision });
}
