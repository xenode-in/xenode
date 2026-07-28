import { AuditEvent, UserVault, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { isAccountEnvelope, isVaultEnvelope } from "@/lib/vault-validation";

const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

async function sessionFor(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const vault = await UserVault.findOne({ accountId: session.user.id }).lean();
  return Response.json({ accountId: session.user.id, vault: vault ?? null });
}

export async function PUT(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const authenticatedAt = new Date(session.session.createdAt).getTime();
  if (
    !Number.isFinite(authenticatedAt) ||
    Date.now() - authenticatedAt > RECENT_AUTH_WINDOW_MS
  ) {
    return Response.json(
      { error: "Recent authentication required", code: "recent_auth_required" },
      { status: 403 },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/u.test(idempotencyKey)) {
    return Response.json(
      { error: "A valid Idempotency-Key is required" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        expectedVaultRevision?: unknown;
        passwordEnvelope?: unknown;
        recoveryEnvelope?: unknown;
        deviceEnvelopes?: unknown;
        sharingPublicKey?: unknown;
        wrappedSharingPrivateKey?: unknown;
      }
    | null;
  if (
    !body ||
    !Number.isInteger(body.expectedVaultRevision) ||
    Number(body.expectedVaultRevision) < 0 ||
    (body.passwordEnvelope !== null &&
      body.passwordEnvelope !== undefined &&
      !isVaultEnvelope(body.passwordEnvelope)) ||
    !isVaultEnvelope(body.recoveryEnvelope) ||
    !Array.isArray(body.deviceEnvelopes) ||
    !body.deviceEnvelopes.every(isVaultEnvelope) ||
    body.deviceEnvelopes.length > 50 ||
    typeof body.sharingPublicKey !== "string" ||
    body.sharingPublicKey.length < 100 ||
    !isVaultEnvelope(body.wrappedSharingPrivateKey)
  ) {
    return Response.json({ error: "Invalid Vault v2 payload" }, { status: 400 });
  }

  await connectDatabase();
  const accountId = session.user.id;
  if (
    (body.passwordEnvelope &&
      !isAccountEnvelope(body.passwordEnvelope, accountId, "password")) ||
    !isAccountEnvelope(body.recoveryEnvelope, accountId, "recovery") ||
    !body.deviceEnvelopes.every((envelope) =>
      isAccountEnvelope(envelope, accountId, "device"),
    ) ||
    !isAccountEnvelope(
      body.wrappedSharingPrivateKey,
      accountId,
      "sharing-private-key",
    )
  ) {
    return Response.json(
      { error: "Vault envelope context mismatch" },
      { status: 400 },
    );
  }
  const expectedRevision = Number(body.expectedVaultRevision);
  const payload = {
    passwordEnvelope: body.passwordEnvelope,
    recoveryEnvelope: body.recoveryEnvelope,
    deviceEnvelopes: body.deviceEnvelopes,
    sharingPublicKey: body.sharingPublicKey,
    wrappedSharingPrivateKey: body.wrappedSharingPrivateKey,
    formatVersion: 2 as const,
    lastMutationId: idempotencyKey,
  };

  const prior = await UserVault.findOne({ accountId }).lean();
  if (prior?.lastMutationId === idempotencyKey) {
    return Response.json({ vault: prior, idempotent: true });
  }

  let vault;
  if (expectedRevision === 0 && !prior) {
    try {
      vault = await UserVault.create({
        accountId,
        vaultRevision: 1,
        ...payload,
      });
    } catch {
      vault = null;
    }
  } else {
    vault = await UserVault.findOneAndUpdate(
      { accountId, vaultRevision: expectedRevision },
      { $set: payload, $inc: { vaultRevision: 1 } },
      { new: true, runValidators: true },
    );
  }

  if (!vault) {
    return Response.json(
      { error: "Vault revision conflict", code: "vault_revision_conflict" },
      { status: 409 },
    );
  }

  await AuditEvent.create({
    accountId,
    action: expectedRevision === 0 ? "vault.created" : "vault.updated",
    metadata: {
      revision: vault.vaultRevision,
      deviceEnvelopeCount: body.deviceEnvelopes.length,
    },
  }).catch(() => undefined);

  return Response.json({ vault }, { status: expectedRevision === 0 ? 201 : 200 });
}
