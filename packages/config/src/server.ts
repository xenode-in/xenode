import { z } from "zod";

const productionSecret = z.string().min(32);

const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    MONGODB_URI: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    ADMIN_JWT_SECRET: z.string().min(1),
    CRON_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of ["BETTER_AUTH_SECRET", "ADMIN_JWT_SECRET"] as const) {
      if (!productionSecret.safeParse(env[key]).success) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must contain at least 32 characters in production`,
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(
  env: Record<string, string | undefined> = process.env,
): ServerEnv {
  if (env === process.env && cachedServerEnv) return cachedServerEnv;
  const parsed = serverEnvSchema.parse(env);
  if (env === process.env) cachedServerEnv = parsed;
  return parsed;
}

export function clearServerEnvCacheForTests(): void {
  cachedServerEnv = undefined;
}
