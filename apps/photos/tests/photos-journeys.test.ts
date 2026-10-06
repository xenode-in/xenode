// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@xenode/crypto-react", () => ({
  useProductCrypto: () => ({ withProductKey: vi.fn(), isUnlocked: () => true }),
}));
vi.mock("../app/components/PhotosKeyAccess", () => ({
  usePhotosMetadataKey: () => null,
}));
vi.mock("@/lib/client-session", () => ({
  getClientPhotosSession: async () => ({
    accountId: "owner",
    spaceId: "space_personal_owner",
    productId: "photos",
    sessionId: "session",
  }),
}));
// Uploading and the full-screen viewer have their own tests.
vi.mock("../app/components/UploadController", () => ({
  UploadController: () => null,
}));
vi.mock("../app/components/Lightbox", () => ({ Lightbox: () => null }));
import { PhotosApp } from "../app/components/PhotosApp";

const asset = (id: string, status = "active") => ({
  assetId: id,
  spaceId: "space_personal_owner",
  mediaType: "image",
  status,
  takenAt: "2026-09-01T10:00:00.000Z",
  trashedAt: "2026-09-02T10:00:00.000Z",
});

let root: Root;
let host: HTMLElement;
let library: string[];
let trash: string[];
const posts: Array<{ path: string; body: unknown }> = [];
const gets: string[] = [];

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
function button(label: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
const tiles = () => host.querySelectorAll("article").length;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  library = ["a1", "a2", "a3"];
  trash = [];
  posts.length = 0;
  gets.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { assetIds: string[] };
        posts.push({ path: url.pathname, body });
        const ids = new Set(body.assetIds);
        if (url.pathname.endsWith("/trash")) {
          library = library.filter((id) => !ids.has(id));
          trash = [...trash, ...body.assetIds];
        } else {
          trash = trash.filter((id) => !ids.has(id));
          if (url.pathname.endsWith("/restore")) library.push(...body.assetIds);
        }
        return Response.json({}, { status: url.pathname.endsWith("/purge") ? 202 : 200 });
      }
      gets.push(url.pathname);
      if (url.pathname === "/api/photos/timeline") {
        return Response.json({ items: library.map((id) => asset(id)), nextCursor: null });
      }
      if (url.pathname === "/api/photos/trash") {
        return Response.json({ items: trash.map((id) => asset(id, "trashed")), nextCursor: null });
      }
      if (url.pathname === "/api/photos/albums") {
        return Response.json({
          albums: [{ albumId: "album-1", encryptedName: "sealed", photoAssetCount: 2, coverPhotoAssetId: "a2" }],
          nextCursor: null,
        });
      }
      if (url.pathname === "/api/photos/albums/album-1") {
        return Response.json({ items: [asset("a2"), asset("a3")], nextCursor: null });
      }
      return Response.json({ error: "Photo not found" }, { status: 404 });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(PhotosApp)));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Photos product journeys", () => {
  it("moves a photo to trash, restores it and deletes another forever", async () => {
    expect(tiles()).toBe(3);
    await click("Select a1");
    await click("Move to trash");
    expect(posts).toEqual([{ path: "/api/photos/assets/trash", body: { assetIds: ["a1"] } }]);
    expect(tiles()).toBe(2); // the timeline reloaded without it

    await click("Trash");
    expect(tiles()).toBe(1);
    await click("Select a1");
    await click("Restore");
    expect(posts.at(-1)).toEqual({ path: "/api/photos/assets/restore", body: { assetIds: ["a1"] } });
    expect(host.textContent).toContain("Trash is empty");

    await click("Photos");
    expect(tiles()).toBe(3);
    await click("Select a3");
    await click("Move to trash");
    await click("Trash");
    await click("Select a3");
    await click("Delete forever"); // opens the confirmation
    expect(posts.at(-1)?.path).toBe("/api/photos/assets/trash");
    const confirm = [...document.querySelectorAll("[role=dialog] button")].find(
      (element) => element.textContent?.trim() === "Delete forever",
    );
    await act(async () => (confirm as HTMLButtonElement).click());
    await settle();
    expect(posts.at(-1)).toEqual({ path: "/api/photos/assets/purge", body: { assetIds: ["a3"] } });
    expect(host.textContent).toContain("Trash is empty");
  });

  it("opens an album to its real photos and offers no placeholder actions", async () => {
    await click("Albums");
    expect(host.textContent).toContain("2 items");
    const card = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Encrypted album"),
    );
    await act(async () => card!.click());
    await settle();
    expect(gets).toContain("/api/photos/albums/album-1");
    expect(tiles()).toBe(2);
    expect(button("Select a2")).toBeTruthy();

    for (const missing of ["Help", "Settings"]) {
      expect(() => button(missing)).toThrow();
    }
    expect(host.textContent).not.toMatch(/Share \d/);
  });
});
