import { argon2idAsync } from "@noble/hashes/argon2.js";
import {
  decodeBase64Url,
  type Argon2idDeriver,
} from "@xenode/crypto-core";

export const deriveArgon2id: Argon2idDeriver = async (password, params) =>
  argon2idAsync(password, decodeBase64Url(params.salt), {
    t: params.iterations,
    m: params.memoryKiB,
    p: params.parallelism,
    dkLen: params.outputLength,
    asyncTick: 10,
  });
