import dbConnect from "@/lib/mongodb";
import { sanitize } from "@/lib/audit/sanitize";
import Notification, {
  type NotificationType,
} from "@/models/Notification";

/**
 * In-app notification emitter. Fire-and-forget: never throws out of the caller
 * (a failed notification must not break the surrounding op). Metadata is
 * PII-stripped via the shared sanitizer.
 */
export interface EmitNotificationArgs {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function emitNotification(args: EmitNotificationArgs): Promise<void> {
  try {
    await dbConnect();
    await Notification.create({
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body ?? null,
      orgId: args.orgId ?? null,
      metadata: sanitize(args.metadata ?? {}),
    });
  } catch (error) {
    console.error("[Notification] emit failed", {
      userId: args.userId,
      type: args.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Emit the same notification to many recipients (e.g. all org admins). */
export async function emitNotificationToMany(
  userIds: string[],
  args: Omit<EmitNotificationArgs, "userId">,
): Promise<void> {
  await Promise.all(
    Array.from(new Set(userIds)).map((userId) =>
      emitNotification({ ...args, userId }),
    ),
  );
}
