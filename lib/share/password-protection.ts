import bcrypt from "bcryptjs";
import ShareLink from "@/models/ShareLink";

const MAX_FAILED_PASSWORD_ATTEMPTS = 5;
const PASSWORD_LOCK_WINDOW_MS = 15 * 60 * 1000;

export async function verifySharePassword(
  link: {
    _id: unknown;
    isPasswordProtected: boolean;
    passwordHash?: string;
    passwordFailureCount?: number;
    passwordLockedUntil?: Date | null;
  },
  password?: string,
) {
  if (!link.isPasswordProtected) {
    return { ok: true as const };
  }

  const now = new Date();
  if (link.passwordLockedUntil && link.passwordLockedUntil > now) {
    return {
      ok: false as const,
      status: 429,
      error: "Too many incorrect password attempts. Try again later.",
    };
  }

  if (!password) {
    return { ok: false as const, status: 401, error: "Password required" };
  }

  const valid = await bcrypt.compare(password, link.passwordHash ?? "");
  if (!valid) {
    const nextFailures = (link.passwordFailureCount ?? 0) + 1;
    if (nextFailures >= MAX_FAILED_PASSWORD_ATTEMPTS) {
      await ShareLink.updateOne(
        { _id: link._id },
        {
          $set: {
            passwordFailureCount: 0,
            passwordLockedUntil: new Date(
              now.getTime() + PASSWORD_LOCK_WINDOW_MS,
            ),
          },
        },
      );
    } else {
      await ShareLink.updateOne(
        { _id: link._id },
        { $inc: { passwordFailureCount: 1 } },
      );
    }

    return nextFailures >= MAX_FAILED_PASSWORD_ATTEMPTS
      ? {
          ok: false as const,
          status: 429,
          error: "Too many incorrect password attempts. Try again later.",
        }
      : {
          ok: false as const,
          status: 401,
          error: "Incorrect password",
        };
  }

  if ((link.passwordFailureCount ?? 0) > 0 || link.passwordLockedUntil) {
    await ShareLink.updateOne(
      { _id: link._id },
      { $set: { passwordFailureCount: 0, passwordLockedUntil: null } },
    );
  }

  return { ok: true as const };
}
