import { getRedisClient } from "../lib/migrations/redis";

const redis = getRedisClient();

export class ConcurrencyLock {
  private key: string;
  private workerId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private ttl: number;

  constructor(userId: string, workerId: string, ttlSeconds: number = 60) {
    this.key = `migration:lock:${userId}`;
    this.workerId = workerId;
    this.ttl = ttlSeconds;
  }

  /**
   * Attempts to acquire the lock using SETNX.
   */
  async acquire(): Promise<boolean> {
    const result = await redis.set(this.key, this.workerId, "EX", this.ttl, "NX");
    if (result === "OK") {
      this.startHeartbeat();
      return true;
    }
    // Check if the current worker already owns it (for robustness)
    const currentLock = await redis.get(this.key);
    if (currentLock === this.workerId) {
      this.startHeartbeat();
      return true;
    }
    return false;
  }

  /**
   * Releases the lock using a Lua script to ensure only the owner can release it.
   */
  async release(): Promise<void> {
    this.stopHeartbeat();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, this.key, this.workerId);
  }

  /**
   * Keep the lock alive while processing.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    // Refresh at half the TTL
    const intervalMs = (this.ttl * 1000) / 2;
    this.heartbeatInterval = setInterval(async () => {
      // Extend TTL only if we still own the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, this.key, this.workerId, this.ttl);
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
