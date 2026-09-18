export interface GeneratedAvatar {
  id: string;
  url: string;
}

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function loreleiAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/10.x/lorelei/svg?${new URLSearchParams({
    seed,
  })}`;
}

/** A fresh batch of random, non-identifying Lorelei avatars. */
export function generateAvatarBatch(count = 8): GeneratedAvatar[] {
  return Array.from({ length: count }, () => {
    const id = randomSeed();
    return { id, url: loreleiAvatarUrl(id) };
  });
}
