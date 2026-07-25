import { AuditEvent, UserVault, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";

const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

type Envelope = {
  accountId: string;
  spaceId?: string;
  productId?: string;
  type: string;
  formatVersion: number;
  algorithm: string;
  keyId: string;
  keyVersion: number;
  ciphertext: string;
  iv: string;
  aadVersion: number;
  createdAt: string;
  status: string;
  kdfParams?: unknown;
};

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<Envelope>;
  return (
    // Context fields — must be present so they persist and pass the
    // crypto-core `sameContext` check when the envelope is later opened.
    typeof envelope.accountId === "string" &&
    envelope.accountId.length > 0 &&
    typeof envelope.type === "string" &&
    envelope.type.length > 0 &&
    (envelope.spaceId === undefined || typeof envelope.spaceId === "string") &&
    (envelope.productId === undefined ||
      typeof envelope.productId === "string") &&
    envelope.formatVersion === 2 &&
    envelope.algorithm === "AES-256-GCM" &&
    typeof envelope.keyId === "string" &&
    Number.isInteger(envelope.keyVersion) &&
    Number(envelope.keyVersion) > 0 &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length > 16 &&
    typeof envelope.iv === "string" &&
    envelope.iv.length >= 16 &&
    envelope.aadVersion === 1 &&
    typeof envelope.createdAt === "string" &&
    !Number.isNaN(new Date(envelope.createdAt).getTime()) &&
    (envelope.status === "active" ||
      envelope.status === "retired" ||
      envelope.status === "revoked")
  );
}

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
    !isEnvelope(body.passwordEnvelope) ||
    !isEnvelope(body.recoveryEnvelope) ||
    !Array.isArray(body.deviceEnvelopes) ||
    !body.deviceEnvelopes.every(isEnvelope) ||
    body.deviceEnvelopes.length > 50 ||
    typeof body.sharingPublicKey !== "string" ||
    body.sharingPublicKey.length < 100 ||
    !isEnvelope(body.wrappedSharingPrivateKey)
  ) {
    return Response.json({ error: "Invalid Vault v2 payload" }, { status: 400 });
  }

  await connectDatabase();
  const accountId = session.user.id;
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
