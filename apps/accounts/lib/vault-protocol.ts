/** Compatibility fence for the retired login/Vault password coupling. */
export const VAULT_CLIENT_HEADER = "x-xenode-vault-client";
export const VAULT_CLIENT_VERSION = "separate-password-v1";
export const VAULT_CLIENT_HEADERS = {
  [VAULT_CLIENT_HEADER]: VAULT_CLIENT_VERSION,
} as const;
