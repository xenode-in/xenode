import { z } from "zod";
import { createProductRegistry } from "./registry";
import { resolveProductOrigin, type WebProductId } from "./origins";

export function getPublicProductOrigin(product: WebProductId): string {
  // Next.js substitutes only literal NEXT_PUBLIC_* accesses in client bundles.
  const origins = {
    accounts: process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN,
    drive: process.env.NEXT_PUBLIC_DRIVE_ORIGIN,
    photos: process.env.NEXT_PUBLIC_PHOTOS_ORIGIN,
  };
  return resolveProductOrigin(
    product,
    origins[product],
    process.env.NODE_ENV,
    `NEXT_PUBLIC_${product.toUpperCase()}_ORIGIN`,
  );
}

export function getPublicRealtimeOrigin(): string {
  return resolveProductOrigin(
    "drive",
    process.env.NEXT_PUBLIC_REALTIME_ORIGIN ?? process.env.NEXT_PUBLIC_DRIVE_ORIGIN,
    process.env.NODE_ENV,
    "NEXT_PUBLIC_REALTIME_ORIGIN or NEXT_PUBLIC_DRIVE_ORIGIN",
  );
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_ACCOUNTS_ORIGIN: z.url().optional(),
  NEXT_PUBLIC_DRIVE_ORIGIN: z.url().optional(),
  NEXT_PUBLIC_PHOTOS_ORIGIN: z.url().optional(),
  NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: z.url().optional(),
  NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN: z.url().optional(),
});

export function parsePublicEnv(env: Record<string, string | undefined>) {
  return publicEnvSchema.parse(env);
}

export function getPublicProductRegistry(
  env: Record<string, string | undefined>,
) {
  const parsed = parsePublicEnv(env);
  return createProductRegistry({
    accounts: parsed.NEXT_PUBLIC_ACCOUNTS_ORIGIN,
    drive: parsed.NEXT_PUBLIC_DRIVE_ORIGIN,
    photos: parsed.NEXT_PUBLIC_PHOTOS_ORIGIN,
    "office-editor":
      parsed.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN ??
      parsed.NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN,
  });
}
