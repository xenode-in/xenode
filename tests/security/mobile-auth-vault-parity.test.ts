import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { recoverPassword as recoverMobilePassword } from "../../../xenode-expo/src/lib/crypto/forgotPassword";
import { buildVaultPassphrase } from "@/lib/crypto/keySetup";
import { deriveKey, fromB64, toB64 } from "@/lib/crypto/utils";

const mobileRoot = path.resolve(__dirname, "../../../xenode-expo");
const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

describe("Android Authentication & Vault parity", () => {
  it(
    "rewraps a recovery vault that Web can unlock without changing the private key",
    async () => {
      const keys = await crypto.subtle.generateKey(RSA_PARAMS, true, [
        "encrypt",
        "decrypt",
      ]);
      const privateKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
      const words = "one two three four five six seven eight nine ten eleven twelve".split(" ");
      const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
      const recoveryIv = crypto.getRandomValues(new Uint8Array(12));
      const recoveryKey = await deriveKey(words.join(" "), recoverySalt);
      const recoveryEnvelope = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: recoveryIv },
        recoveryKey,
        privateKey,
      );
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const encryptedChallenge = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        keys.publicKey,
        challenge,
      );

      const result = await recoverMobilePassword({
        recoveryKeywords: words,
        recoverySaltB64: toB64(recoverySalt),
        recoveryWordIvB64: toB64(recoveryIv),
        encryptedPrivateKeyB64: toB64(recoveryEnvelope),
        encryptedChallengeB64: toB64(encryptedChallenge),
        newPassword: "new-master-password",
      });

      expect(fromB64(result.recoveryProofB64!)).toEqual(challenge);

      const webVaultKey = await deriveKey(
        buildVaultPassphrase("new-master-password", words.join(" ")),
        fromB64(result.passwordSaltB64),
      );
      const recoveredPrivateKey = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(result.ivB64) },
        webVaultKey,
        fromB64(result.encryptedPrivateKeyB64),
      );
      expect(new Uint8Array(recoveredPrivateKey)).toEqual(new Uint8Array(privateKey));
    },
    30_000,
  );

  it("keeps recovery and explicit vault lock actions reachable in Android UI", () => {
    const login = readFileSync(path.join(mobileRoot, "src/app/(auth)/login.tsx"), "utf8");
    const recovery = readFileSync(path.join(mobileRoot, "src/app/(auth)/recover.tsx"), "utf8");
    const profile = readFileSync(path.join(mobileRoot, "src/app/(drive)/(tabs)/profile.tsx"), "utf8");

    expect(login).toContain('router.push("/(auth)/recover"');
    expect(recovery).toContain("bootstrapRecovery(email)");
    expect(recovery).toContain("completeRecovery(newPassword");
    expect(profile).toContain("Lock Vault");
    expect(profile).toContain("await unlock(unlockPassword)");
  });
});
