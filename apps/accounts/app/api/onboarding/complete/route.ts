import {
  AccountProfile,
  AuditEvent,
  connectDatabase,
  getDatabase,
} from "@xenode/database";
import { getAccountsSession } from "@/lib/session";
import { userFilter } from "@/lib/hub-data";

// Cap the stored avatar so a data URI can't bloat the user record.
const MAX_IMAGE_LENGTH = 24_000;

function validImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_IMAGE_LENGTH) return null;
  if (/^https:\/\/[^\s]+$/u.test(value)) return value;
  if (/^data:image\/(svg\+xml|png|jpeg|webp)[,;]/u.test(value)) return value;
  return null;
}

/**
 * Finalize onboarding: mark the account onboarded and persist the chosen theme,
 * default-encrypt preference, and avatar image. The vault itself is created
 * client-side (E2EE) before this call; here we only record account preferences.
 */
export async function POST(request: Request) {
  const session = await getAccountsSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    theme?: unknown;
    defaultEncrypt?: unknown;
    image?: unknown;
  };
  const theme =
    body.theme === "light" || body.theme === "dark" || body.theme === "system"
      ? body.theme
      : undefined;
  const defaultEncrypt =
    typeof body.defaultEncrypt === "boolean" ? body.defaultEncrypt : undefined;
  const image = validImage(body.image);

  await connectDatabase();
  if (image) {
    await getDatabase()
      .collection("user")
      .updateOne(userFilter(session.user.id), {
        $set: { image, updatedAt: new Date() },
      });
  }
  const set: Record<string, unknown> = { onboarded: true };
  if (theme) set.theme = theme;
  if (defaultEncrypt !== undefined) set.defaultEncrypt = defaultEncrypt;
  await AccountProfile.updateOne(
    { accountId: session.user.id },
    { $set: set },
    { upsert: true },
  );
  await AuditEvent.create({
    accountId: session.user.id,
    action: "account.onboarding.completed",
    metadata: { theme: theme ?? null, hasAvatar: Boolean(image) },
  }).catch(() => undefined);

  return Response.json({ ok: true });
}
