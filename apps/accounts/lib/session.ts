import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountsAuth } from "@/lib/auth";

export async function getAccountsSession(request?: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({
    headers: request?.headers ?? (await headers()),
  });
}

export async function requireAccountsPageSession() {
  const session = await getAccountsSession();
  if (!session) redirect("/login");
  return session;
}
