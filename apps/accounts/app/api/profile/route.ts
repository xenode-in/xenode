import {
  AccountProfile,
  AuditEvent,
  connectDatabase,
  getDatabase,
} from "@xenode/database";
import { normalizeUsername, validateUsername } from "@xenode/identity-core";
import { getAccountsSession } from "@/lib/session";
import { loadProfile, userFilter } from "@/lib/hub-data";

function parseBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (typeof value.name !== "string" || typeof value.username !== "string" || typeof value.defaultEncrypt !== "boolean") return null;
  const name = value.name.trim();
  const username = normalizeUsername(value.username);
  if (name.length < 1 || name.length > 80 || !validateUsername(username)) return null;
  return { name, username, defaultEncrypt: value.defaultEncrypt };
}

export async function GET(request: Request) {
  const session = await getAccountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await loadProfile(session.user.id));
}

export async function PUT(request: Request) {
  const session = await getAccountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = parseBody(await request.json().catch(() => null));
  if (!body) return Response.json({ error: "Invalid profile values" }, { status: 400 });

  await connectDatabase();
  const users = getDatabase().collection<{
    username?: string;
    displayUsername?: string;
  }>("user");
  const current = await users.findOne(userFilter(session.user.id));
  if (!current) return Response.json({ error: "Account not found" }, { status: 404 });

  const usernameChanged = current.username !== body.username;
  try {
    await users.updateOne(userFilter(session.user.id), {
      $set: {
        name: body.name,
        username: body.username,
        displayUsername: body.username,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return Response.json({ error: "That username is already in use" }, { status: 409 });
    }
    throw error;
  }

  const preferenceUpdate: Record<string, unknown> = {
    $set: { defaultEncrypt: body.defaultEncrypt },
    $setOnInsert: { onboarded: true },
  };
  if (usernameChanged && current.username) {
    preferenceUpdate.$push = {
      usernameHistory: { username: current.username, changedAt: new Date() },
    };
  }
  await AccountProfile.updateOne(
    { accountId: session.user.id },
    preferenceUpdate,
    { upsert: true },
  );
  await AuditEvent.create({
    accountId: session.user.id,
    action: "account.profile.updated",
    metadata: { usernameChanged, defaultEncrypt: body.defaultEncrypt },
  }).catch(() => undefined);

  return Response.json(await loadProfile(session.user.id));
}
