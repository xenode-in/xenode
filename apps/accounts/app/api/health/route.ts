export function GET() {
  return Response.json({
    ok: true,
    product: "accounts",
    issuer: process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  });
}
