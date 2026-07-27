import { toNextJsHandler } from "better-auth/next-js";
import { getAccountsAuth } from "@/lib/auth";

function rejectsResourceIndicator(request: Request): boolean {
  const url = new URL(request.url);
  return (
    (url.pathname.endsWith("/oauth2/authorize") ||
      url.pathname.endsWith("/oauth2/token")) &&
    url.searchParams.has("resource")
  );
}

export async function GET(request: Request) {
  if (rejectsResourceIndicator(request)) {
    return Response.json(
      { error: "invalid_target", error_description: "resource is unsupported" },
      { status: 400 },
    );
  }
  return toNextJsHandler(await getAccountsAuth()).GET(request);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oauth2/token")) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = new URLSearchParams(await request.clone().text());
      if (body.has("resource")) {
        return Response.json(
          {
            error: "invalid_target",
            error_description: "resource is unsupported",
          },
          { status: 400 },
        );
      }
    }
  }
  return toNextJsHandler(await getAccountsAuth()).POST(request);
}
