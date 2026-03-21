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
    it("should detect vault tampering using HMAC", async () => {
      // 1. Setup vault
      const mockVaultResponse = { ok: true, json: async () => ({}) };
      (global.fetch as any).mockResolvedValue(mockVaultResponse);

      const keys = await setupUserKeyVault(masterPassword, recoveryWords);
      
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
      const unlockedKeys = await unlockVault(masterPassword);
      expect(unlockedKeys.privateKey).toBeDefined();

      // 4. TAMPER: Modify encryptedPrivateKey
      const tamperedVault = { ...storedVault, encryptedPrivateKey: toB64(new Uint8Array(32)) };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => tamperedVault
      });

      // 5. Unlock should fail
      await expect(unlockVault(masterPassword)).rejects.toThrow("VAULT_TAMPERED");
    });
  });

  describe("AAD Binding & Metadata Envelopes", () => {
    it("should fail decryption if AAD (userId) mismatch", async () => {
      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
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

    it("should pack and unpack versioned metadata envelopes", async () => {
      const metadataKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
      );
      const filename = "secret_plan.pdf";
      const aad = buildAad({ userId, bucketId, objectKey, version: CRYPTO_VERSION });

      const encrypted = await encryptMetadataString(filename, metadataKey, aad);
      const decoded = fromB64(encrypted);
      expect(decoded[0]).toBe(CRYPTO_VERSION); // Version 2 check

      const decrypted = await decryptMetadataString(encrypted, metadataKey, aad);
      expect(decrypted).toBe(filename);

      // Tamper with metadata aad
      const wrongAad = buildAad({ userId: "attacker", bucketId, objectKey, version: CRYPTO_VERSION });
      await expect(decryptMetadataString(encrypted, metadataKey, wrongAad)).rejects.toThrow();
    });
  });

  describe("Chunk Integrity", () => {
    it("should detect chunk swapping or removal", async () => {
      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["encrypt", "decrypt"]
      );

      const largeContent = new Uint8Array(5 * 1024 * 1024); // 5MB
      // crypto.getRandomValues has a 64KB limit per call in some environments
      for (let i = 0; i < largeContent.length; i += 65536) {
        const chunk = largeContent.subarray(i, Math.min(i + 65536, largeContent.length));
        crypto.getRandomValues(chunk);
      }
      const file = new File([largeContent], "large.dat");
      const chunkSize = 1024 * 1024; // 1MB chunks

      const aadBase = { userId, bucketId, objectKey };
      const enc = await encryptFileChunked(file, publicKey, aadBase, chunkSize);
      const combinedCiphertext = await enc.ciphertext.arrayBuffer();

      // Successful combine
      const dec = await decryptFileChunkedCombined(
        combinedCiphertext, enc.encryptedDEK, JSON.stringify(enc.chunkIvs), 
        chunkSize, enc.chunkCount, privateKey, aadBase, "application/octet-stream"
      );
      expect(new Uint8Array(await dec.arrayBuffer())).toEqual(largeContent);

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
