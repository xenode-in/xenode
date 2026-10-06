// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@xenode/crypto-react", () => ({
  useProductCrypto: () => ({ withProductKey: vi.fn() }),
}));
import { SelectionController } from "../app/components/SelectionController";
import { Timeline } from "../app/components/Timeline";

const PAGE = 180;
const PAGES = 4;
// Newest first; four photos per day so date headers interleave with rows.
const library = Array.from({ length: PAGE * PAGES }, (_, index) => ({
  assetId: `asset-${String(index).padStart(4, "0")}`,
  spaceId: "space_personal_owner",
  mediaType: "image",
  takenAt: new Date(Date.UTC(2026, 8, 30) - Math.floor(index / 4) * 86_400_000).toISOString(),
}));

let root: Root;
let host: HTMLElement;
const requests: URL[] = [];

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
const mountedTiles = () => [...host.querySelectorAll("article")];
const mountedIds = () =>
  mountedTiles().map((tile) => tile.querySelector("button[aria-label^='Select']")?.getAttribute("aria-label"));

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), window.location.origin);
    requests.push(url);
    const start = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Number(url.searchParams.get("limit"));
    const items = library.slice(start, start + limit);
    const next = start + limit < library.length ? String(start + limit) : null;
    return Response.json({ items, nextCursor: next });
  }));
  window.scrollTo(0, 0);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(SelectionController, null,
        createElement(Timeline, { spaceId: "space_personal_owner", query: "", onOpen() {} })),
    );
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// Bottom of the grid, as a browser clamps scrolling to the document end.
function gridBottom() {
  const grid = host.querySelector<HTMLElement>("div.relative.min-w-0");
  return parseFloat(grid!.style.height) - window.innerHeight;
}

async function scrollTo(y: number) {
  await act(async () => {
    window.scrollTo(0, y);
    window.dispatchEvent(new Event("scroll"));
  });
  await settle();
}

describe("virtualized Photos timeline", () => {
  it("mounts a bounded set of tiles while every page loads on scroll", async () => {
    expect(requests).toHaveLength(1);
    const firstWindow = mountedIds();
    expect(firstWindow.length).toBeGreaterThan(0);
    expect(firstWindow.length).toBeLessThanOrEqual(40);
    expect(firstWindow[0]).toBe("Select asset-0000");

    // Each scroll to the bottom reveals the end of the grid and loads one page.
    for (let page = 2; page <= PAGES; page++) {
      await scrollTo(gridBottom());
      expect(requests).toHaveLength(page);
      expect(requests.at(-1)?.searchParams.get("cursor")).toBe(String((page - 1) * PAGE));
      expect(mountedTiles().length).toBeLessThanOrEqual(40);
    }
    await scrollTo(gridBottom());
    expect(requests).toHaveLength(PAGES); // no cursor left: no further request

    expect(host.textContent).toContain(`${PAGE * PAGES} items`);
    const lastWindow = mountedIds();
    expect(lastWindow).not.toContain("Select asset-0000");
    expect(lastWindow).toContain(`Select asset-${String(PAGE * PAGES - 1).padStart(4, "0")}`);
    expect(lastWindow.length).toBeLessThanOrEqual(40);

    await scrollTo(0);
    expect(mountedIds()[0]).toBe("Select asset-0000");
  });
});
