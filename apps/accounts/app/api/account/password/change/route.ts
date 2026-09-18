import {
  AuditEvent,
  ProductSession,
  TrustedSecondFactor,
  UserVault,
  connectDatabase,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import { isAccountEnvelope } from "@/lib/vault-validation";

const PENDING_TTL_MS = 15 * 60 * 1000;

function accountsOrigin() {
  return new URL(
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  ).origin;
}

async function authenticated(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return { response: response as Response };
  }
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { auth, session };
}

export async function POST(request: Request) {
  const context = await authenticated(request);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as
    | {
        currentPassword?: unknown;
        expectedVaultRevision?: unknown;
        passwordEnvelope?: unknown;
        mutationId?: unknown;
      }
    | null;
  if (
    !body ||
    typeof body.currentPassword !== "string" ||
    body.currentPassword.length < 12 ||
    !Number.isInteger(body.expectedVaultRevision) ||
    typeof body.mutationId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(body.mutationId) ||
    !isAccountEnvelope(body.passwordEnvelope, context.session.user.id, "password") ||
    !body.passwordEnvelope.kdfParams ||
    typeof body.passwordEnvelope.kdfParams !== "object"
  ) {
    return Response.json({ error: "Invalid password rotation" }, { status: 400 });
  }
  try {
    await context.auth.api.verifyPassword({
      body: { password: body.currentPassword },
      headers: request.headers,
    });
  } catch {
    return Response.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  await connectDatabase();
  const vault = await UserVault.findOneAndUpdate(
    {
      accountId: context.session.user.id,
      vaultRevision: Number(body.expectedVaultRevision),
    },
    {
      $set: {
        pendingPasswordEnvelope: body.passwordEnvelope,
        pendingPasswordMutationId: body.mutationId,
        pendingPasswordExpiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
      $inc: { vaultRevision: 1 },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!vault) {
    return Response.json({ error: "Vault revision conflict" }, { status: 409 });
  }
  return Response.json({ ok: true, vaultRevision: vault.vaultRevision });
}

export async function PUT(request: Request) {
  const context = await authenticated(request);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as
    | { mutationId?: unknown; revokeProductSessions?: unknown }
    | null;
  if (
    !body ||
    typeof body.mutationId !== "string" ||
    typeof body.revokeProductSessions !== "boolean"
  ) {
    return Response.json({ error: "Invalid password rotation" }, { status: 400 });
  }
  await connectDatabase();
  const vault = await UserVault.findOneAndUpdate(
    {
      accountId: context.session.user.id,
      pendingPasswordMutationId: body.mutationId,
      pendingPasswordExpiresAt: { $gt: new Date() },
      pendingPasswordEnvelope: { $ne: null },
    },
    [
      {
        $set: {
          passwordEnvelope: "$pendingPasswordEnvelope",
          lastMutationId: body.mutationId,
          vaultRevision: { $add: ["$vaultRevision", 1] },
        },
      },
      {
        $unset: [
          "pendingPasswordEnvelope",
          "pendingPasswordMutationId",
          "pendingPasswordExpiresAt",
        ],
      },
    ],
    { new: true },
  ).lean();
  if (!vault) {
    return Response.json({ error: "Password rotation expired" }, { status: 409 });
  }
  if (body.revokeProductSessions) {
    await Promise.all([
      ProductSession.updateMany(
        {
          accountId: context.session.user.id,
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: new Date() } },
      ),
      TrustedSecondFactor.updateMany(
        {
          accountId: context.session.user.id,
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: new Date() } },
      ),
    ]);
  }
  await AuditEvent.create({
    accountId: context.session.user.id,
    action: "account.password.changed",
    metadata: { revokedOtherDevices: body.revokeProductSessions },
  }).catch(() => undefined);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const context = await authenticated(request);
  if ("response" in context) return context.response;
  const mutationId = new URL(request.url).searchParams.get("mutationId");
  if (!mutationId) {
    return Response.json({ error: "Mutation ID required" }, { status: 400 });
  }
  await connectDatabase();
  await UserVault.updateOne(
    {
      accountId: context.session.user.id,
      pendingPasswordMutationId: mutationId,
    },
    {
      $unset: {
        pendingPasswordEnvelope: 1,
        pendingPasswordMutationId: 1,
        pendingPasswordExpiresAt: 1,
      },
    },
  );
  return Response.json({ ok: true });
}
