import { z } from "zod";
import { createProductRegistry } from "./registry";

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
