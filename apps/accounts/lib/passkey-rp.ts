import { getServerProductOrigin } from "@xenode/config";
export function getAccountsWebAuthnConfig() {
  const origin = getServerProductOrigin("accounts");
  const parsed = new URL(origin);
  return {
    origin: parsed.origin,
    rpId: parsed.hostname,
    rpName: "Xenode Accounts",
  };
}
