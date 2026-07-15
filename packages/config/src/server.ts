import { z } from "zod";

const productionSecret = z.string().min(32);
const mandatoryIndependentSecret = z.string().min(32);

function hasValidOrigins(value: string): boolean {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) return false;
  return origins.every((origin) => {
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.origin === origin;
    } catch {
      return false;
    }
  });
}

const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    MONGODB_URI: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    ADMIN_JWT_SECRET: z.string().min(1),
    REALTIME_TICKET_SECRET: mandatoryIndependentSecret,
    CDN_SIGNING_SECRET: mandatoryIndependentSecret,
    REALTIME_ALLOWED_ORIGIN: z.string().refine(hasValidOrigins, {
      message: "REALTIME_ALLOWED_ORIGIN must contain exact http(s) origins",
    }),
    CRON_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    const independentSecrets = [
      ["REALTIME_TICKET_SECRET", env.REALTIME_TICKET_SECRET],
      ["CDN_SIGNING_SECRET", env.CDN_SIGNING_SECRET],
    ] as const;
    for (const [key, value] of independentSecrets) {
      if (value === env.BETTER_AUTH_SECRET) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must not reuse BETTER_AUTH_SECRET`,
        });
      }
    }
    if (env.REALTIME_TICKET_SECRET === env.CDN_SIGNING_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["CDN_SIGNING_SECRET"],
        message: "CDN_SIGNING_SECRET must not reuse REALTIME_TICKET_SECRET",
      });
    }

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
