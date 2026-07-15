export class ProductKeyStore {
  private readonly keys = new Map<string, Uint8Array>();

  constructor(readonly productId: string) {}

  set(spaceId: string, key: Uint8Array): void {
    if (key.length !== 32) throw new Error("ProductSpaceKey must be 256 bits");
    this.delete(spaceId);
    this.keys.set(spaceId, new Uint8Array(key));
  }

  has(spaceId: string): boolean {
    return this.keys.has(spaceId);
  }

  async withKey<T>(
    spaceId: string,
    operation: (key: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    const stored = this.keys.get(spaceId);
    if (!stored) throw new Error("ProductSpaceKey is locked");
    const ephemeral = new Uint8Array(stored);
    try {
      return await operation(ephemeral);
    } finally {
      ephemeral.fill(0);
    }
  }

  delete(spaceId: string): void {
    const key = this.keys.get(spaceId);
    key?.fill(0);
    this.keys.delete(spaceId);
  }

  clear(): void {
    for (const key of this.keys.values()) key.fill(0);
    this.keys.clear();
  }
}
