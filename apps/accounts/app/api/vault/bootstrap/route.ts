import { createHash } from "node:crypto";
import { AuditEvent, Space, SpaceProductKey, UserVault, withTransaction } from "@xenode/database";
import { ensurePersonalSpace, personalSpaceId } from "@xenode/spaces";
import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { ACCOUNTS_RATE_LIMITS } from "@/lib/sensitive-actions";
import { getAccountsAuth } from "@/lib/auth";
import { isVaultBootstrapPayload } from "@/lib/vault-bootstrap-payload";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]),
  );
  return value;
}

class BootstrapConflict extends Error {}

export async function POST(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { recentAuth: true, rateLimit: ACCOUNTS_RATE_LIMITS.vaultWrite });
  if (denied) return denied;
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const operationId = request.headers.get("idempotency-key");
  if (!operationId || !/^[A-Za-z0-9_-]{16,128}$/u.test(operationId)) {
    return Response.json({ error: "A valid Idempotency-Key is required" }, { status: 400 });
  }
  const text = await request.text();
  if (text.length > 64 * 1024) return Response.json({ error: "Vault payload is too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const accountId = session.user.id;
  if (!isVaultBootstrapPayload(body, accountId)) {
    return Response.json({ error: "Invalid Vault bootstrap payload" }, { status: 400 });
  }
  const payloadHash = createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
  const spaceId = personalSpaceId(accountId);
  const matches = (vault: { bootstrapOperationId?: string; bootstrapPayloadHash?: string }) =>
    vault.bootstrapOperationId === operationId && vault.bootstrapPayloadHash === payloadHash;
  try {
    const created = await withTransaction(async (transaction) => {
      const prior = await UserVault.findOne({ accountId }).session(transaction).lean();
      if (prior) {
        if (matches(prior)) return false;
        throw new BootstrapConflict();
      }
      // Claim the unique account before touching any of its Space key envelopes.
      const { productEnvelopes, ...vaultPayload } = body;
      await UserVault.create([{
        ...vaultPayload, accountId, vaultRevision: 1, formatVersion: 2,
        bootstrapOperationId: operationId, bootstrapPayloadHash: payloadHash,
        lastMutationId: operationId,
      }], { session: transaction });
      const space = await ensurePersonalSpace(accountId, transaction);
      if (space.type !== "personal" || space.ownerAccountId !== accountId || space.status !== "active") throw new BootstrapConflict();
      const fenced = await Space.updateOne({ _id: spaceId, status: "active", ownerAccountId: accountId },
        { $inc: { storageFenceVersion: 1 } }, { session: transaction });
      if (fenced.modifiedCount !== 1 || await SpaceProductKey.exists({ spaceId }).session(transaction)) throw new BootstrapConflict();
      for (const productId of ["drive", "photos"] as const) {
        const envelope = productEnvelopes[productId];
        await SpaceProductKey.create([{
          _id: `spk:${spaceId}:${productId}:${accountId}:v1`,
          spaceId, productId, memberAccountId: accountId, keyVersion: 1,
          formatVersion: 2, algorithm: envelope.algorithm, ciphertext: envelope.ciphertext,
          iv: envelope.iv, aadVersion: 1, status: "active", rotationReason: "initial", createdByAccountId: accountId,
        }], { session: transaction });
      }
      await AuditEvent.create([{ accountId, action: "vault.created", metadata: { revision: 1, deviceEnvelopeCount: body.deviceEnvelopes.length } }], { session: transaction });
      return true;
    });
    return Response.json({ vault: { vaultRevision: 1 }, idempotent: !created }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof BootstrapConflict || (error && typeof error === "object" && "code" in error && error.code === 11000)) {
      const prior = await UserVault.findOne({ accountId }).lean();
      if (prior && matches(prior)) return Response.json({ vault: { vaultRevision: 1 }, idempotent: true });
      return Response.json({ error: "A Vault or its product keys already exist", code: "vault_bootstrap_conflict" }, { status: 409 });
    }
    // The browser retains this exact sealed attempt for an uncertain-result retry.
    return Response.json({ error: "Vault initialization could not be confirmed", code: "vault_bootstrap_unconfirmed" }, { status: 503 });
  }
}
