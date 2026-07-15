import { toNextJsHandler } from "better-auth/next-js";
import { getAccountsAuth } from "@/lib/auth";

export async function GET(request: Request) {
  return toNextJsHandler(await getAccountsAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(await getAccountsAuth()).POST(request);
}
