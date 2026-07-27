import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { getAccountsAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await getAccountsAuth();
  return oauthProviderOpenIdConfigMetadata(auth)(request);
}
