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

  constructor(readonly productId: string) {}

  set(spaceId: string, key: CryptoKey): void {
    if (key.extractable) {
      throw new Error("ProductSpaceKey CryptoKey must be non-extractable");
    }
    this.keys.set(spaceId, key);
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
    this.keys.delete(spaceId);
  }

  clear(): void {
    this.keys.clear();
  }
}
