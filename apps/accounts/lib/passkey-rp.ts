export function getAccountsWebAuthnConfig() {
  const origin = process.env.ACCOUNTS_ORIGIN ?? "http://localhost:3001";
  const parsed = new URL(origin);
  return {
    origin: parsed.origin,
    rpId: parsed.hostname,
    rpName: "Xenode Accounts",
  };
}
