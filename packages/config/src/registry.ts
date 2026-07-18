import type { ProductRegistration, ProductSlug } from "@xenode/contracts";

const defaultOrigins: Record<ProductSlug, string> = {
  accounts: "https://accounts.xenode.in",
  drive: "https://xenode.in",
  photos: "https://photos.xenode.in",
  mobile: "xenode://app",
  "office-editor": "https://edit.xenode.in",
};

const displayNames: Record<ProductSlug, string> = {
  accounts: "Xenode Account",
  drive: "Xenode Drive",
  photos: "Xenode Photos",
  mobile: "Xenode Mobile",
  "office-editor": "Xenode Office Editor",
};

export function createProductRegistry(
  overrides: Partial<Record<ProductSlug, string>> = {},
): Readonly<Record<ProductSlug, ProductRegistration>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(defaultOrigins) as ProductSlug[]).map((id) => [
        id,
        Object.freeze({
          id,
          displayName: displayNames[id],
          origin: new URL(overrides[id] ?? defaultOrigins[id]),
        }),
      ]),
    ) as Record<ProductSlug, ProductRegistration>,
  );
}

export const cookieNames = Object.freeze({
  accountsSession: "__Host-xenode_accounts_session",
  driveSession: "__Host-xenode_drive_session",
  photosSession: "__Host-xenode_photos_session",
  adminSession: "Xenode_admin_session",
});

export const featureFlagNames = [
  "ORGS_ENABLED",
  "SPACE_MODEL_ENABLED",
  "VAULT_V2_ENABLED",
  "ACCOUNTS_APP_ENABLED",
  "USERNAME_LOGIN_ENABLED",
  "OIDC_PRODUCT_SESSIONS_ENABLED",
  "PHOTOS_ASSET_ENABLED",
  "PHOTOS_APP_ENABLED",
] as const;

export type FeatureFlagName = (typeof featureFlagNames)[number];

export function readFeatureFlag(
  name: FeatureFlagName,
  env: Record<string, string | undefined>,
): boolean {
  return env[name] === "true";
}
