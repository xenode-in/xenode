import {
  AuditEvent,
  UserVault,
  VaultPasskey,
  connectDatabase,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";

async function sessionFor(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const passkeys = await VaultPasskey.find({
    accountId: session.user.id,
    status: "active",
  })
    .select("credentialId name transports createdAt lastUsedAt")
    .lean();
  return Response.json(
    passkeys.map((passkey) => ({
      id: passkey.credentialId,
      name: passkey.name ?? "Passkey",
      transports: passkey.transports,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt ?? null,
    })),
  );
}

export async function DELETE(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const credentialId = new URL(request.url).searchParams.get("credentialId");
  if (!credentialId) {
    return Response.json({ error: "Credential ID required" }, { status: 400 });
  }
  await connectDatabase();
  const passkey = await VaultPasskey.findOne({
    accountId: session.user.id,
    credentialId,
    status: { $in: ["active", "pending"] },
  });
  if (!passkey) return Response.json({ error: "Passkey not found" }, { status: 404 });
  passkey.status = "revoked";
  await Promise.all([
    passkey.save(),
    UserVault.updateOne(
      { accountId: session.user.id },
      {
        $pull: { deviceEnvelopes: { keyId: passkey.envelopeKeyId } },
        $inc: { vaultRevision: 1 },
      },
    ),
  ]);
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.passkey.revoked",
    metadata: {},
  }).catch(() => undefined);
  return Response.json({ ok: true });
}
