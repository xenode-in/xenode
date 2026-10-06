import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { isCrossOriginProductRequest } from "@xenode/identity-core";
let server: Server,
  port: number,
  mutations = 0,
  cookieSeen = false,
  originSeen: string | undefined,
  bodyValid = false;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.host?.startsWith("edit.xenode.test")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        `<form method="post" enctype="text/plain" action="http://photos.xenode.test:${port}/api/photos/assets/trash"><input name='{"assetIds":["asset"],"ignored":"' value='"}'><button>Attempt same-site mutation</button></form>`,
      );
    }
    if (req.method !== "POST") {
      res.writeHead(404);
      return res.end();
    }
    cookieSeen =
      req.headers.cookie?.includes("synthetic-session=authorized") ?? false;
    originSeen = req.headers.origin;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      bodyValid = JSON.parse(body).assetIds[0] === "asset";
      if (
        isCrossOriginProductRequest(
          { headers, method: "POST" },
          `http://photos.xenode.test:${port}`,
        )
      ) {
        res.writeHead(403);
        return res.end("Origin rejected");
      }
      if (!cookieSeen || !bodyValid) {
        res.writeHead(401);
        return res.end();
      }
      mutations++;
      res.writeHead(200);
      res.end("Authorized mutation");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  port = address.port;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test("a hostile same-site form sends the host-only cookie but cannot mutate", async ({
  context,
  page,
}) => {
  const baseline = await fetch(
    `http://127.0.0.1:${port}/api/photos/assets/trash`,
    {
      method: "POST",
      headers: {
        cookie: "synthetic-session=authorized",
        "content-type": "application/json",
      },
      body: '{"assetIds":["asset"]}',
    },
  );
  expect(baseline.status).toBe(200);
  expect(mutations).toBe(1);
  mutations = 0;
  cookieSeen = false;
  await context.addCookies([
    {
      name: "synthetic-session",
      value: "authorized",
      url: `http://photos.xenode.test:${port}`,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`http://edit.xenode.test:${port}`);
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Attempt same-site mutation" }).click(),
  ]);
  expect(cookieSeen).toBe(true);
  expect(originSeen).toBe(`http://edit.xenode.test:${port}`);
  expect(bodyValid).toBe(true);
  expect(response.status()).toBe(403);
  expect(mutations).toBe(0);
});
