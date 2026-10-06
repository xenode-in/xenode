/** Browser APIs trust the exact product page origin, never a same-site sibling. */
export function isCrossOriginProductRequest(
  request: Pick<Request, "headers" | "method">,
  expectedOrigin: string,
): boolean {
  const origin = request.headers.get("origin"),
    site = request.headers.get("sec-fetch-site");
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  return (
    (origin !== null && origin !== expectedOrigin) ||
    site === "same-site" ||
    site === "cross-site" ||
    (mutation && site !== null && origin !== expectedOrigin)
  );
}
