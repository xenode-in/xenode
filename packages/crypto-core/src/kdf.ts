import { decodeBase64Url } from "./encoding";
import type { Argon2idDeriver, Argon2idParams } from "./types";

const MIN_MEMORY_KIB = 19 * 1024;
const MAX_MEMORY_KIB = 256 * 1024;

export function validateArgon2idParams(params: Argon2idParams): void {
  if (
    params.algorithm !== "argon2id" ||
    params.outputLength !== 32 ||
    !Number.isInteger(params.memoryKiB) ||
    params.memoryKiB < MIN_MEMORY_KIB ||
    params.memoryKiB > MAX_MEMORY_KIB ||
    !Number.isInteger(params.iterations) ||
    params.iterations < 2 ||
    params.iterations > 10 ||
    !Number.isInteger(params.parallelism) ||
    params.parallelism < 1 ||
    params.parallelism > 8 ||
    decodeBase64Url(params.salt).length < 16
  ) {
    throw new Error("Unsupported Argon2id parameters");
  }
}

export async function derivePasswordWrappingKey(
  password: string,
  params: Argon2idParams,
  deriveArgon2id: Argon2idDeriver,
): Promise<Uint8Array> {
  validateArgon2idParams(params);
  const result = await deriveArgon2id(new TextEncoder().encode(password), params);
  if (result.length !== 32) throw new Error("Argon2id must return 32 bytes");
  return new Uint8Array(result);
}
