import { NextRequest, NextResponse } from "next/server";
import { getServerProductOrigin } from "@xenode/config";
import { isCrossOriginProductRequest } from "@xenode/identity-core";
/** Same-site hostile runtimes cannot spend the Photos browser session. */
export function proxy(request: NextRequest) {
  if (isCrossOriginProductRequest(request, getServerProductOrigin("photos")))
    return NextResponse.json(
      { error: "Cross-origin Photos API requests are forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*"] };
