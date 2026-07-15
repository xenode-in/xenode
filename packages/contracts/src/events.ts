import { z } from "zod";
import { accountIdSchema, spaceIdSchema } from "./ids";
import { productSlugSchema } from "./products";

const eventBaseSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  accountId: accountIdSchema,
  productId: productSlugSchema,
  spaceId: spaceIdSchema,
});

export const syncEventSchema = z.discriminatedUnion("type", [
  eventBaseSchema.extend({
    type: z.literal("object.created"),
    objectId: z.string().min(1),
  }),
  eventBaseSchema.extend({
    type: z.literal("object.updated"),
    objectId: z.string().min(1),
  }),
  eventBaseSchema.extend({
    type: z.literal("object.deleted"),
    objectId: z.string().min(1),
  }),
  eventBaseSchema.extend({
    type: z.literal("session.revoked"),
    sessionId: z.string().min(1),
  }),
]);

export type SyncEvent = z.infer<typeof syncEventSchema>;

export const auditEventSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  actorAccountId: accountIdSchema,
  action: z.string().min(1).max(120),
  targetType: z.string().min(1).max(80),
  targetId: z.string().min(1).max(256),
  productId: productSlugSchema.optional(),
  spaceId: spaceIdSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
