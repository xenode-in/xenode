/**
 * In-memory holder for unlocked product-space keys.
 *
 * Keys are NON-EXTRACTABLE AES-GCM `CryptoKey` objects (produced by
 * `importProductKey` in @xenode/crypto-core). Consumers never receive raw bytes;
 * they run an operation with the CryptoKey via `withKey` (e.g. opening a per-file
 * DEK envelope with `openEnvelopeWithKey`).
 */
export class ProductKeyStore {
  private readonly keys = new Map<string, CryptoKey>();
  private generation = 0;

  constructor(readonly productId: string) {}

  set(spaceId: string, key: CryptoKey): void {
    if (key.extractable) {
      throw new Error("ProductSpaceKey CryptoKey must be non-extractable");
    }
    this.keys.set(spaceId, key);
  }

  /** A lock or logout invalidates an in-flight handoff before it can install a key. */
  async unlock(spaceId: string, load: () => Promise<CryptoKey>): Promise<void> {
    const generation = this.generation;
    const key = await load();
    if (generation !== this.generation) {
      throw new Error("ProductSpaceKey was locked during unlock");
    }
    this.set(spaceId, key);
  }

  has(spaceId: string): boolean {
    return this.keys.has(spaceId);
  }

  get(spaceId: string): CryptoKey | undefined {
    return this.keys.get(spaceId);
  }

  async withKey<T>(
    spaceId: string,
    operation: (key: CryptoKey) => Promise<T> | T,
  ): Promise<T> {
    const stored = this.keys.get(spaceId);
    if (!stored) throw new Error("ProductSpaceKey is locked");
    return operation(stored);
  }

  delete(spaceId: string): void {
    this.generation += 1;
    this.keys.delete(spaceId);
  }

  clear(): void {
    this.generation += 1;
    this.keys.clear();
  }
}
