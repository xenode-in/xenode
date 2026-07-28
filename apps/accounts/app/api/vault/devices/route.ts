import { AuditEvent, UserVault, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { isAccountEnvelope } from "@/lib/vault-validation";

async function sessionFor(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function POST(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/u.test(idempotencyKey)) {
    return Response.json({ error: "Invalid idempotency key" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    expectedVaultRevision?: unknown;
    envelope?: unknown;
  } | null;
  const envelope = body?.envelope;
  if (
    !body ||
    !Number.isInteger(body.expectedVaultRevision) ||
    !isAccountEnvelope(envelope, session.user.id, "device") ||
    !envelope.keyId.startsWith("ark:device:")
  ) {
    return Response.json({ error: "Invalid device envelope" }, { status: 400 });
  }

  await connectDatabase();
  const prior = await UserVault.findOne({ accountId: session.user.id }).lean();
  if (!prior) return Response.json({ error: "Vault not found" }, { status: 404 });
  const duplicate = prior.deviceEnvelopes.some(
    (value) =>
      value &&
      typeof value === "object" &&
      "keyId" in value &&
      value.keyId === envelope.keyId,
  );
  if (duplicate) {
    return Response.json({ vaultRevision: prior.vaultRevision, idempotent: true });
  }
  if (prior.deviceEnvelopes.length >= 50) {
    return Response.json({ error: "Device limit reached" }, { status: 409 });
  }
  const vault = await UserVault.findOneAndUpdate(
    {
      accountId: session.user.id,
      vaultRevision: Number(body.expectedVaultRevision),
    },
    {
      $push: { deviceEnvelopes: envelope },
      $inc: { vaultRevision: 1 },
      $set: { lastMutationId: idempotencyKey },
    },
    { new: true, runValidators: true },
  );
  if (!vault) {
    return Response.json(
      { error: "Vault revision conflict", code: "vault_revision_conflict" },
      { status: 409 },
    );
  }
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.device.enrolled",
    metadata: { revision: vault.vaultRevision },
  }).catch(() => undefined);
  return Response.json({ vaultRevision: vault.vaultRevision }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const keyId = new URL(request.url).searchParams.get("keyId");
  if (!keyId?.startsWith("ark:device:")) {
    return Response.json({ error: "Invalid device key" }, { status: 400 });
  }
  await connectDatabase();
  const vault = await UserVault.findOneAndUpdate(
    { accountId: session.user.id },
    { $pull: { deviceEnvelopes: { keyId } }, $inc: { vaultRevision: 1 } },
    { new: true },
  );
  if (!vault) return Response.json({ error: "Vault not found" }, { status: 404 });
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.device.revoked",
    metadata: { revision: vault.vaultRevision },
  }).catch(() => undefined);
  return Response.json({ vaultRevision: vault.vaultRevision });
}
