import { z } from "zod";

export const createBucketSchema = z.object({
  name: z
    .string()
    .min(3, "Bucket name must be at least 3 characters")
    .max(63, "Bucket name must be at most 63 characters")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      "Bucket name must start and end with alphanumeric, only lowercase letters, numbers, and hyphens allowed",
    ),
});

export const deleteObjectSchema = z.object({
  objectId: z.string().min(1, "Object ID is required"),
});

export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, "Key name is required")
    .max(100, "Key name must be at most 100 characters"),
  expiresIn: z.enum(["never", "30d", "90d", "1y"]).optional().default("never"),
});

export type CreateBucketInput = z.infer<typeof createBucketSchema>;
export type DeleteObjectInput = z.infer<typeof deleteObjectSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
