import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { fetchHandoffResponse } from "@xenode/key-handoff";

let server: Server, productOrigin: string, accountsOrigin: string;
let ready = false, consumed = 0;
const binding = {
  transactionId: "synthetic-transaction", accountId: "synthetic-account",
  clientId: "xenode-drive-web", productId: "drive", spaceId: "synthetic-space",
  destinationOrigin: "", state: "synthetic-bound-state", nonce: "synthetic-bound-nonce",
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.url === "/product") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
      return res.end(`<!doctype html><title>Isolated handoff consumer</title>
        <a href="${accountsOrigin}/broker" target="_blank" rel="noopener noreferrer">Unlock in Accounts</a>
        <p role="status">Locked</p><script>
        const fetchHandoffResponse = ${fetchHandoffResponse.toString()};
        document.querySelector('a').onclick = async () => {
          try {
            const response = await fetchHandoffResponse(${JSON.stringify(binding)}, {waitForCreation:true});
            if (!response.ok || (await response.json()).ciphertext !== 'synthetic-sealed-bundle') throw Error('Bad handoff');
            document.querySelector('[role=status]').textContent = 'Unlocked';
          } catch (error) { document.querySelector('[role=status]').textContent = error.message; }
        };</script>`);
    }
    if (req.url === "/broker") {
      res.writeHead(200, {"Content-Type": "text/html"});
      return res.end(`<!doctype html><title>Synthetic Accounts broker</title>
        <button>Approve synthetic key</button><script>
        document.querySelector('button').onclick = async () => { await fetch('/approve', {method:'POST'}); };
        </script>`);
    }
    if (req.url === "/approve" && req.method === "POST") {
      ready = true;
      res.writeHead(204);
      return res.end();
    }
    if (req.url === "/api/key-handoffs/synthetic-transaction/consume" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        if (!req.headers.cookie?.includes("synthetic-product=authorized")) {
          res.writeHead(401); return res.end();
        }
        if (!ready || body !== JSON.stringify(binding) || consumed) {
          res.writeHead(410); return res.end();
        }
        consumed++;
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({ciphertext:"synthetic-sealed-bundle"}));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  productOrigin = `http://127.0.0.1:${address.port}`;
  accountsOrigin = `http://localhost:${address.port}`;
  binding.destinationOrigin = productOrigin;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("an isolated product consumes once when its Accounts tab has no opener", async ({page, context}) => {
  ready = false; consumed = 0;
  await context.addCookies([{name:"synthetic-product", value:"authorized", url:productOrigin, sameSite:"Lax"}]);
  await page.goto(`${productOrigin}/product`);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", {name:"Unlock in Accounts",exact:true}).click();
  const popup = await popupPromise;
  await popup.getByRole("button", {name:"Approve synthetic key",exact:true}).waitFor();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.getByRole("button", {name:"Approve synthetic key",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Unlocked");
  expect(consumed).toBe(1);
  const replay = await page.request.post(`${productOrigin}/api/key-handoffs/synthetic-transaction/consume`, {data:JSON.stringify(binding)});
  expect(replay.status()).toBe(410);
  expect(consumed).toBe(1);
});
