import { getServerProductOrigin } from "@xenode/config";
import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { ACCOUNTS_RATE_LIMITS } from "@/lib/sensitive-actions";
import {
  AccountPasskeyBinding,
  AuditEvent,
  UserVault,
  VaultPasskey,
  connectDatabase,
  getDatabase,
  createAuthSecurityRepository,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { isAccountEnvelope } from "@/lib/vault-validation";
import { ACCOUNT_PASSKEY_PRF_INPUT } from "@/lib/passkey-constants";

function accountsOrigin() {
  return new URL(getServerProductOrigin("accounts"))
    .origin;
}

async function sessionFor(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const denied = await authorizeAccountsApiRequest(request);
  if (denied) return denied;
  const session = await sessionFor(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const credentialId = new URL(request.url).searchParams.get("credentialId");
  if (credentialId) {
    const nativePasskey = await createAuthSecurityRepository(
      getDatabase(),
    ).findPasskeyForUser({ accountId: session.user.id, credentialId });
    if (!nativePasskey)
      return Response.json({ error: "Passkey not found" }, { status: 404 });
    const binding = await AccountPasskeyBinding.findOne({
      accountId: session.user.id,
      credentialId,
      passkeyId: nativePasskey.id,
    }).lean();
    if (!binding) {
      return Response.json(
        { error: "Passkey binding not found" },
        { status: 404 },
      );
    }
    const vault = await UserVault.findOne({ accountId: session.user.id })
      .select("deviceEnvelopes")
      .lean();
    const envelope = vault?.deviceEnvelopes.find(
      (value) =>
        value &&
        typeof value === "object" &&
        "keyId" in value &&
        value.keyId === binding.envelopeKeyId,
    );
    if (!envelope) {
      return Response.json(
        { error: "Passkey envelope not found" },
        { status: 404 },
      );
    }
    return Response.json({
      accountId: session.user.id,
      envelope,
      hkdfSalt: binding.hkdfSalt,
    });
  }

  const [passkeys, bindings, legacy] = await Promise.all([
    createAuthSecurityRepository(getDatabase()).listPasskeysForUser(
      session.user.id,
    ),
    AccountPasskeyBinding.find({ accountId: session.user.id }).lean(),
    VaultPasskey.find({
      accountId: session.user.id,
      status: "active",
    })
      .select("credentialId name createdAt lastUsedAt")
      .lean(),
  ]);
  const byPasskey = new Map(
    bindings.map((binding) => [binding.passkeyId, binding]),
  );
  return Response.json({
    passkeys: passkeys.flatMap((passkey) => {
      const binding = byPasskey.get(passkey.id);
      return binding
        ? [
            {
              id: passkey.id,
              name: passkey.name ?? "Passkey",
              credentialId: passkey.credentialID,
              createdAt: passkey.createdAt ?? binding.createdAt,
              aaguid: passkey.aaguid ?? null,
            },
          ]
        : [];
    }),
    legacy: legacy.map((passkey) => ({
      id: passkey.credentialId,
      name: passkey.name ?? "Older Vault passkey",
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { recentAuth: true, rateLimit: ACCOUNTS_RATE_LIMITS.credentials });
  if (denied) return denied;
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const session = await sessionFor(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    passkeyId?: unknown;
    credentialId?: unknown;
    expectedVaultRevision?: unknown;
    envelope?: unknown;
    prfInput?: unknown;
    hkdfSalt?: unknown;
  } | null;
  if (
    !body ||
    typeof body.passkeyId !== "string" ||
    typeof body.credentialId !== "string" ||
    !Number.isInteger(body.expectedVaultRevision) ||
    body.prfInput !== ACCOUNT_PASSKEY_PRF_INPUT ||
    typeof body.hkdfSalt !== "string" ||
    !isAccountEnvelope(body.envelope, session.user.id, "device") ||
    !body.envelope.keyId.startsWith("ark:account-passkey:") ||
    !body.envelope.kdfParams ||
    typeof body.envelope.kdfParams !== "object"
  ) {
    return Response.json({ error: "Invalid passkey binding" }, { status: 400 });
  }
  await connectDatabase();
  const passkey = await createAuthSecurityRepository(
    getDatabase(),
  ).findPasskeyForUser({
    passkeyId: body.passkeyId,
    accountId: session.user.id,
    credentialId: body.credentialId,
  });
  if (!passkey) {
    return Response.json({ error: "Passkey not found" }, { status: 404 });
  }
  let createdBindingId: string | undefined;
  try {
    const createdBinding = await AccountPasskeyBinding.create({
      accountId: session.user.id,
      passkeyId: body.passkeyId,
      credentialId: body.credentialId,
      envelopeKeyId: body.envelope.keyId,
      prfInput: body.prfInput,
      hkdfSalt: body.hkdfSalt,
    });
    createdBindingId = String(createdBinding._id);
    const vault = await UserVault.findOneAndUpdate(
      {
        accountId: session.user.id,
        vaultRevision: Number(body.expectedVaultRevision),
        "deviceEnvelopes.keyId": { $ne: body.envelope.keyId },
      },
      {
        $push: { deviceEnvelopes: body.envelope },
        $inc: { vaultRevision: 1 },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!vault) throw new Error("Vault revision conflict");
    await AuditEvent.create({
      accountId: session.user.id,
      action: "account.passkey.enrolled",
      metadata: { vaultRevision: vault.vaultRevision },
    }).catch(() => undefined);
    return Response.json({ ok: true, vaultRevision: vault.vaultRevision });
  } catch (error) {
    // A duplicate request must not compensate by deleting the winning binding.
    if (createdBindingId)
      await AccountPasskeyBinding.deleteOne({
        _id: createdBindingId,
        accountId: session.user.id,
      }).catch(() => undefined);
    return Response.json(
      {
        error:
          error instanceof Error && error.message.includes("revision")
            ? "Vault changed while the passkey was being added. Try again."
            : "Could not bind the passkey to the Vault.",
      },
      { status: 409 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { recentAuth: true, rateLimit: ACCOUNTS_RATE_LIMITS.credentials });
  if (denied) return denied;
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const session = await sessionFor(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return Response.json({ error: "Passkey ID required" }, { status: 400 });
  await connectDatabase();
  const binding = await AccountPasskeyBinding.findOne({
    accountId: session.user.id,
    passkeyId: id,
  }).lean();
  if (!binding) {
    return Response.json({ error: "Passkey not found" }, { status: 404 });
  }
  const auth = await getAccountsAuth();
  await auth.api.deletePasskey({
    body: { id },
    headers: request.headers,
  });
  await Promise.all([
    AccountPasskeyBinding.deleteOne({ _id: binding._id }),
    UserVault.updateOne(
      { accountId: session.user.id },
      {
        $pull: { deviceEnvelopes: { keyId: binding.envelopeKeyId } },
        $inc: { vaultRevision: 1 },
      },
    ),
  ]);
  await AuditEvent.create({
    accountId: session.user.id,
    action: "account.passkey.revoked",
    metadata: {},
  }).catch(() => undefined);
  return Response.json({ ok: true });
}
