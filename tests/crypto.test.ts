import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
  buildAad, 
  encryptFile, 
  decryptFile, 
  encryptFileChunked, 
  decryptFileChunkedCombined,
  encryptMetadataString,
  decryptMetadataString
} from "../lib/crypto/fileEncryption";
import { setupUserKeyVault, unlockVault } from "../lib/crypto/keySetup";
import { CRYPTO_VERSION, toB64, fromB64 } from "../lib/crypto/utils";

// Mocking fetch for API calls in keySetup
global.fetch = vi.fn();

describe("E2EE Hardening Verification", () => {
  const masterPassword = "strong-password-123";
  const recoveryWords = "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12";
  const userId = "user-123";
  const bucketId = "bucket-456";
  const objectKey = "file-uuid-789";

  describe("Vault Integrity (V2)", () => {
    it("should detect vault tampering using HMAC bound to userId", async () => {
      // 1. Setup vault
      const mockVaultResponse = { ok: true, json: async () => ({}) };
      (global.fetch as any).mockResolvedValue(mockVaultResponse);

      const keys = await setupUserKeyVault(userId, masterPassword, recoveryWords);
      
      // Capture what was SENT to the server
      const setupCall = (global.fetch as any).mock.calls[0];
      const setupBody = JSON.parse(setupCall[1].body);

      // Simulating server storage
      const storedVault = {
        publicKey: setupBody.publicKey,
        encryptedPrivateKey: setupBody.encryptedPrivateKey,
        vaultVersion: setupBody.vaultVersion,
        vaultHmac: setupBody.vaultHmac,
        pbkdf2Salt: setupBody.pbkdf2Salt,
        iv: setupBody.iv,
        encryptedRecoveryWords: setupBody.encryptedRecoveryWords,
        recoveryIv: setupBody.recoveryIv,
        recoverySalt: setupBody.recoverySalt,
      };

      // 2. Mock GET vault for unlock
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => storedVault
      });

      // 3. Successful unlock
      const unlockedKeys = await unlockVault(userId, masterPassword);
      expect(unlockedKeys.privateKey).toBeDefined();

      // 4. TAMPER: Modify encryptedPrivateKey
      const tamperedVault = { ...storedVault, encryptedPrivateKey: toB64(new Uint8Array(32)) };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => tamperedVault
      });

      // 5. Unlock should fail
      await expect(unlockVault(userId, masterPassword)).rejects.toThrow();

      // 6. REPLAY: Same vault data, DIFFERENT userId
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => storedVault
      });
      await expect(unlockVault("wrong-user", masterPassword)).rejects.toThrow();
    });

    it("should use HKDF for metadataKey to ensure domain isolation", async () => {
      const mockVaultResponse = { ok: true, json: async () => ({}) };
      (global.fetch as any).mockResolvedValue(mockVaultResponse);

      const keys1 = await setupUserKeyVault("user-1", masterPassword, recoveryWords);
      const keys2 = await setupUserKeyVault("user-2", masterPassword, recoveryWords);

      // Verify domain separation: keys from different users for SAME input MUST different.
      const aad = buildAad({ userId: "user-1", bucketId: "b", objectKey: "o", version: CRYPTO_VERSION });
      const encrypted = await encryptMetadataString("secret", keys1.metadataKey, aad);
      
      await expect(decryptMetadataString(encrypted, keys2.metadataKey, aad)).rejects.toThrow();
    });
  });

  describe("AAD Binding & Authenticated Manifests", () => {
    it("should fail decryption if AAD (userId) mismatch", async () => {
      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["encrypt", "decrypt"]
      );

      const fileContent = new TextEncoder().encode("sensitive data");
      const file = new File([fileContent], "test.txt", { type: "text/plain" });
      
      const aad1 = buildAad({ userId: "user1", bucketId, objectKey, chunkIndex: 0, totalChunks: 1 });
      const aad2 = buildAad({ userId: "user2", bucketId, objectKey, chunkIndex: 0, totalChunks: 1 });

      const enc = await encryptFile(file, publicKey, aad1);
      const ciphertext = await enc.ciphertext.arrayBuffer();

      // Decrypt with correct AAD
      const dec1 = await decryptFile(ciphertext, enc.encryptedDEK, enc.iv, privateKey, aad1, "text/plain");
      expect(new TextDecoder().decode(await dec1.arrayBuffer())).toBe("sensitive data");

      // Decrypt with WRONG AAD (userId exchange attack)
      await expect(decryptFile(ciphertext, enc.encryptedDEK, enc.iv, privateKey, aad2, "text/plain"))
        .rejects.toThrow();
    });

    it("should protect chunked files via authenticated manifest", async () => {
      const metadataKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
      );
      const aad = buildAad({ userId, bucketId, objectKey, version: CRYPTO_VERSION });
      
      const manifest = { chunkCount: 3, chunkSize: 1024, chunkIvs: ["iv1", "iv2", "iv3"] };
      const encryptedManifest = await encryptMetadataString(JSON.stringify(manifest), metadataKey, aad);

      // Verify legitimate reveal
      const decrypted = await decryptMetadataString(encryptedManifest, metadataKey, aad);
      expect(JSON.parse(decrypted)).toEqual(manifest);

      // Verify tampering detection
      const tamperedAad = buildAad({ userId: "attacker", bucketId, objectKey, version: CRYPTO_VERSION });
      await expect(decryptMetadataString(encryptedManifest, metadataKey, tamperedAad)).rejects.toThrow();
    });
  });

  describe("Chunk Integrity", () => {
    it("should detect chunk swapping in chunked uploads", async () => {
      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["encrypt", "decrypt"]
      );

      const content = new Uint8Array(2 * 1024 * 1024); // 2MB
      for (let i = 0; i < content.length; i += 65536) {
        crypto.getRandomValues(content.subarray(i, Math.min(i + 65536, content.length)));
      }
      const file = new File([content], "test.dat");
      const chunkSize = 1024 * 1024; // 1MB chunks

      const aadBase = { userId, bucketId, objectKey };
      const enc = await encryptFileChunked(file, publicKey, aadBase, chunkSize);
      const combinedCiphertext = await enc.ciphertext.arrayBuffer();

      // TAMPER: Swap chunk 0 and chunk 1
      const tampered = new Uint8Array(combinedCiphertext);
      const cipherChunkSize = chunkSize + 16;
      const chunk0 = tampered.slice(0, cipherChunkSize);
      const chunk1 = tampered.slice(cipherChunkSize, 2 * cipherChunkSize);
      tampered.set(chunk1, 0);
      tampered.set(chunk0, cipherChunkSize);

      await expect(decryptFileChunkedCombined(
        tampered.buffer, enc.encryptedDEK, JSON.stringify(enc.chunkIvs), 
        chunkSize, enc.chunkCount, privateKey, aadBase, "application/octet-stream"
      )).rejects.toThrow();
    });
  });
});
