import { getServerProductOrigin } from "@xenode/config";
export function GET() {
  return Response.json({
    ok: true,
    product: "accounts",
    issuer: getServerProductOrigin("accounts"),
  });
}
