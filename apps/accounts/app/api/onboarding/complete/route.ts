import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { ACCOUNTS_RATE_LIMITS } from "@/lib/sensitive-actions";
import {
  AccountProfile,
  AuditEvent,
  connectDatabase,
  getDatabase,
  withTransaction,
} from "@xenode/database";
import { enabledStorageRegions, isStorageRegion } from "@xenode/config/storage";
import { normalizeUsername, validateUsername } from "@xenode/identity-core";
import { getAccountsSession } from "@/lib/session";
import { userFilter } from "@/lib/hub-data";
import { isValidProfileImage } from "@/lib/profile-image";

/**
 * Finalize onboarding: mark the account onboarded and persist the chosen theme,
 * default-encrypt preference, and avatar image. The vault itself is created
 * client-side (E2EE) before this call; here we only record account preferences.
 */
export async function POST(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { rateLimit: ACCOUNTS_RATE_LIMITS.profile });
  if (denied) return denied;
  const session = await getAccountsSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    theme?: unknown;
    defaultEncrypt?: unknown;
    image?: unknown;
    region?: unknown;
    username?: unknown;
  };
  const theme =
    body.theme === "light" || body.theme === "dark" || body.theme === "system"
      ? body.theme
      : undefined;
  const defaultEncrypt =
    typeof body.defaultEncrypt === "boolean" ? body.defaultEncrypt : undefined;
  const image = isValidProfileImage(body.image) ? body.image : null;
  const region = isStorageRegion(body.region) ? body.region : undefined;
  if (!region || !enabledStorageRegions().includes(region)) {
    return Response.json({ error: "Choose an enabled storage pool" }, { status: 400 });
  }
  const username =
    typeof body.username === "string"
      ? normalizeUsername(body.username)
      : undefined;
  if (username && !validateUsername(username)) {
    return Response.json({ error: "Invalid username" }, { status: 400 });
  }

  await connectDatabase();
  await AccountProfile.init();
  try {
    return await withTransaction(async (transaction) => {
      const existing = await AccountProfile.findOne({ accountId: session.user.id }).session(transaction).lean();
      const currentUser = await getDatabase().collection<{ username?: string }>("user")
        .findOne(userFilter(session.user.id), { session: transaction });
      if (!currentUser) return Response.json({ error: "Account is unavailable" }, { status: 409 });
      if (!currentUser.username && !username) return Response.json({ error: "Choose a username" }, { status: 400 });
      if (existing?.storageRegion && existing.storageRegion !== region) {
        return Response.json({ error: "The storage pool is already locked" }, { status: 409 });
      }
      const update: Record<string, unknown> = {};
      if (image) update.image = image;
      if (username) { update.username = username; update.displayUsername = username; }
      if (Object.keys(update).length) {
        await getDatabase().collection("user").updateOne(
          userFilter(session.user.id), { $set: { ...update, updatedAt: new Date() } }, { session: transaction },
        );
      }
      const set: Record<string, unknown> = { onboarded: true, storageRegion: region };
      if (theme) set.theme = theme;
      if (defaultEncrypt !== undefined) set.defaultEncrypt = defaultEncrypt;
      await AccountProfile.updateOne(
        { accountId: session.user.id }, { $set: set }, { upsert: true, session: transaction },
      );
      await AuditEvent.create([{
        accountId: session.user.id, action: "account.onboarding.completed",
        metadata: { theme: theme ?? null, hasAvatar: Boolean(image), storageRegion: region,
          regionLocked: Boolean(existing?.storageRegion) },
      }], { session: transaction });
      return Response.json({ ok: true, storageRegion: region });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return Response.json({ error: "Onboarding details changed or the username is already in use; retry" }, { status: 409 });
    }
    throw error;
  }
}
