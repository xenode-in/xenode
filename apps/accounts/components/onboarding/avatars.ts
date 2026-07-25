/**
 * Dependency-free avatar generator.
 *
 * Produces compact deterministic gradient/geometric SVG avatars encoded as
 * `data:` URIs. Stored directly in the account's `image` field, they render as
 * an `<img src>` on every product (data URIs are origin-independent, so no
 * public bucket / S3 is needed).
 */

const PALETTES: Array<[string, string]> = [
  ["#003fba", "#3f6fe0"],
  ["#17b8a6", "#0aa0d6"],
  ["#f06fae", "#8b5cf6"],
  ["#f59e0b", "#ef4444"],
  ["#0ea5e9", "#22c55e"],
  ["#6366f1", "#003fba"],
  ["#ec4899", "#f43f5e"],
  ["#14b8a6", "#3b82f6"],
];

function svgFor(seed: number): string {
  const [a, b] = PALETTES[seed % PALETTES.length];
  const shape = seed % 4;
  const cx = 32;
  let motif = "";
  if (shape === 0) {
    motif = `<circle cx="${cx}" cy="26" r="12" fill="#ffffff" opacity="0.9"/><rect x="14" y="40" width="36" height="20" rx="10" fill="#ffffff" opacity="0.9"/>`;
  } else if (shape === 1) {
    motif = `<circle cx="${cx}" cy="32" r="16" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.9"/><circle cx="${cx}" cy="32" r="5" fill="#ffffff"/>`;
  } else if (shape === 2) {
    motif = `<path d="M32 16 L48 48 L16 48 Z" fill="#ffffff" opacity="0.9"/>`;
  } else {
    motif = `<rect x="18" y="18" width="28" height="28" rx="8" fill="#ffffff" opacity="0.9" transform="rotate(45 32 32)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/>${motif}</svg>`;
}

export function avatarDataUri(seed: number): string {
  return `data:image/svg+xml,${encodeURIComponent(svgFor(seed))}`;
}

export interface GeneratedAvatar {
  id: number;
  url: string;
}

/** A fresh batch of `count` avatars starting from a random base seed. */
export function generateAvatarBatch(count = 12): GeneratedAvatar[] {
  const base = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000);
  return Array.from({ length: count }, (_, i) => {
    const id = base + i;
    return { id, url: avatarDataUri(id) };
  });
}
