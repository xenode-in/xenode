import * as crypto from "crypto";
import { Transform } from "stream";

/** Convert a Buffer to a Base64 string */
export function bufferToB64(buf: Buffer | Uint8Array | ArrayBuffer): string {
  if (Buffer.isBuffer(buf)) {
    return buf.toString("base64");
  } else if (buf instanceof Uint8Array) {
    return Buffer.from(buf).toString("base64");
  } else {
    return Buffer.from(buf as ArrayBuffer).toString("base64");
  }
}

/**
 * Server-side version of encryptFile logic.
 * Takes a stream and returns a custom Transform stream that automatically appends the 
 * GCM AuthTag at the end (which WebCrypto requires for decryption), along with the DEK/IV/Name.
 */
export async function createEncryptedStream(
  userId: string,
  userPublicKeyB64: string,
  originalFilename: string
) {
  // 1. Generate AES-256-GCM DEK
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 2. Create the Cipher stream
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);

  // 2.5 Create a wrapper stream to automatically append the AuthTag at the end
  const encryptStream = new Transform({
    transform(chunk, encoding, callback) {
      const encryptedChunk = cipher.update(chunk);
      this.push(encryptedChunk);
      callback();
    },
    flush(callback) {
      const finalChunk = cipher.final();
      this.push(finalChunk);
      // Append the 16-byte AuthTag at the exact end of the ciphertext!
      const authTag = cipher.getAuthTag();
      this.push(authTag);
      callback();
    }
  });

  // 3. Wrap DEK with User's RSA Public Key (OAEP-SHA256 to match client format)
  // Clean up SPKI format if needed, but it should be standard PEM from DB
  const publicKeyPem = userPublicKeyB64.startsWith("-----BEGIN PUBLIC KEY-----")
    ? userPublicKeyB64
    : `-----BEGIN PUBLIC KEY-----\n${(userPublicKeyB64.match(/.{1,64}/g) || []).join("\n")}\n-----END PUBLIC KEY-----`;

  const wrappedDEK = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256", // Match frontend RSA-OAEP with SHA-256
    },
    dek
  );

  // 4. Encrypt the Filename
  const nameKey = crypto.randomBytes(32);
  const nameIV = crypto.randomBytes(12);
  const nameCipher = crypto.createCipheriv("aes-256-gcm", nameKey, nameIV);
  const nameEnc = Buffer.concat([
    nameCipher.update(Buffer.from(originalFilename, "utf8")),
    nameCipher.final(),
  ]);
  const nameAuthTag = nameCipher.getAuthTag();
  
  // Combine [Key(32)] + [IV(12)] + [Ciphertext] + [AuthTag(16)] for the client to decrypt
  const combinedNameBuf = Buffer.concat([nameKey, nameIV, nameEnc, nameAuthTag]);

  return {
    cipherStream: encryptStream,
    encryptedDEK: bufferToB64(wrappedDEK),
    iv: bufferToB64(iv),
    encryptedName: bufferToB64(combinedNameBuf),
  };
}

