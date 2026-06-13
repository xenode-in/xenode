#!/usr/bin/env node

/**
 * Xenode Internal CLI — Upload files with E2EE encryption.
 *
 * Replicates the UploadContext.tsx flow server-side:
 *   1. Unlock the vault (needs the user's master password)
 *   2. Encrypt the file using AES-256-GCM chunks + RSA-OAEP wrapped DEK
 *   3. Encrypt filename & metadata with the metadataKey
 *   4. Upload encrypted chunks directly to S3
 *   5. Complete the upload in MongoDB
 *
 * Usage:
 *   node scripts/cli-upload.js --file <path> --user <userId> [--bucket <bucketId>] [--password <vaultPassword>]
 *
 * Reads credentials from .env.local automatically.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Load .env.local ─────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  console.log("✓ Loaded .env.local");
} else {
  console.warn("⚠ .env.local not found — using existing env vars");
}

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      i++;
    } else {
      options[key] = true;
    }
  }
}

if (options.help) {
  console.log(`
Xenode Internal CLI Upload (E2EE Encrypted)

Usage:
  node scripts/cli-upload.js --file <path> --user <userId> [--bucket <bucketId>] [--password <vaultPassword>]

Required:
  --file           Path to the file to upload
  --user           The userId (from MongoDB user collection)

Optional:
  --bucket         Bucket _id (auto-detects if omitted)
  --password       Vault master password (will prompt if omitted)
  --no-encrypt     Skip encryption (upload plaintext)
  --list-buckets   List all buckets for the user
  --help           Show this help
`);
  process.exit(0);
}

if (options["list-buckets"] && !options.user) {
  console.error(
    "Usage: node scripts/cli-upload.js --list-buckets --user <userId>"
  );
  process.exit(1);
}

if (!options["list-buckets"] && (!options.file || !options.user)) {
  console.error(
    "Usage: node scripts/cli-upload.js --file <path> --user <userId> [--bucket <bucketId>]"
  );
  process.exit(1);
}

const FILE_PATH = options.file ? path.resolve(options.file) : null;
const USER_ID = options.user;
const BUCKET_ID = options.bucket || null;
const SKIP_ENCRYPT = !!options["no-encrypt"];

if (FILE_PATH && !fs.existsSync(FILE_PATH)) {
  console.error(`✗ File not found: ${FILE_PATH}`);
  process.exit(1);
}

// ── MIME type detection ─────────────────────────────────────────────────────
const MIME_MAP = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",
  ".3gp": "video/3gpp",
  ".ts": "video/mp2t",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function getMediaCategory(mimeType) {
  if (!mimeType) return "other";
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("zip") || m.includes("tar") || m.includes("rar") || m.includes("7z") || m.includes("archive")) return "archive";
  if (m.includes("document") || m.includes("text/")) return "document";
  return "other";
}

/**
 * Compute chunk size matching UploadContext.tsx logic
 */
function getAdaptiveChunkSize(fileSize, mimeType) {
  const isStreamable =
    mimeType.startsWith("video/") || mimeType.startsWith("audio/");
  if (isStreamable) {
    if (fileSize < 100 * 1024 * 1024) return 2 * 1024 * 1024; // 2 MB
    if (fileSize < 1024 * 1024 * 1024) return 4 * 1024 * 1024; // 4 MB
    return 8 * 1024 * 1024; // 8 MB
  }
  const adaptive = Math.max(8 * 1024 * 1024, Math.floor(fileSize / 100));
  return Math.min(adaptive, 64 * 1024 * 1024);
}

// ── Crypto helpers (Node.js equivalents of Web Crypto) ──────────────────────

function toB64(buf) {
  return Buffer.from(buf).toString("base64");
}

function fromB64(b64) {
  return Buffer.from(b64, "base64");
}

/**
 * Derive AES-256-GCM key from password + salt using PBKDF2-SHA256 (600k iterations)
 * Matches lib/crypto/utils.ts deriveKey()
 */
function deriveKeySync(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 600_000, 32, "sha256");
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * Node's crypto module expects the auth tag appended to ciphertext (last 16 bytes).
 */
function aesGcmDecrypt(key, iv, ciphertext) {
  // Web Crypto appends the 16-byte auth tag to the ciphertext
  const authTag = ciphertext.slice(-16);
  const encrypted = ciphertext.slice(0, -16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Encrypt with AES-256-GCM. Returns ciphertext + appended auth tag (matching Web Crypto).
 */
function aesGcmEncrypt(key, iv, plaintext) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]); // Web Crypto format
}

/**
 * Encrypt data with RSA-OAEP + SHA-256 (matches Web Crypto RSA-OAEP)
 */
function rsaOaepEncrypt(publicKeyDer, plaintext) {
  // Convert DER (SPKI) to PEM for Node.js
  const publicKeyObj = crypto.createPublicKey({
    key: Buffer.from(publicKeyDer),
    format: "der",
    type: "spki",
  });
  return crypto.publicEncrypt(
    { key: publicKeyObj, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(plaintext)
  );
}

/**
 * Encrypt a metadata string using the metadataKey.
 * Format: [0x02 version byte] + [12 bytes IV] + [ciphertext+tag]
 * Matches encryptMetadataString() in fileEncryption.ts
 */
function encryptMetadataString(text, metadataKey) {
  const iv = crypto.randomBytes(12);
  const encoded = Buffer.from(text, "utf-8");
  const encrypted = aesGcmEncrypt(metadataKey, iv, encoded);
  const combined = Buffer.alloc(1 + 12 + encrypted.length);
  combined[0] = 0x02;
  iv.copy(combined, 1);
  encrypted.copy(combined, 13);
  return toB64(combined);
}

/**
 * Encrypt a metadata object using the metadataKey.
 * Format: [0x03 version byte] + [12 bytes IV] + [ciphertext+tag]
 * Matches encryptMetadataObject() in fileEncryption.ts
 */
function encryptMetadataObject(metadata, metadataKey) {
  const json = JSON.stringify(metadata);
  const iv = crypto.randomBytes(12);
  const encoded = Buffer.from(json, "utf-8");
  const encrypted = aesGcmEncrypt(metadataKey, iv, encoded);
  const combined = Buffer.alloc(1 + 12 + encrypted.length);
  combined[0] = 0x03;
  iv.copy(combined, 1);
  encrypted.copy(combined, 13);
  return toB64(combined);
}

/**
 * Encrypt file in chunks (matches encryptFileChunked in fileEncryption.ts).
 * Returns { encryptedChunks, encryptedDEK, chunkSize, chunkCount, chunkIvs }
 */
function encryptFileChunked(plainBuffer, publicKeyDer, chunkSize) {
  // Generate random AES-256-GCM DEK
  const dekRaw = crypto.randomBytes(32);

  const chunkCount = Math.ceil(plainBuffer.length / chunkSize);
  const chunkIvs = [];
  const encryptedChunks = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, plainBuffer.length);
    const slice = plainBuffer.slice(start, end);
    const iv = crypto.randomBytes(12);
    const encrypted = aesGcmEncrypt(dekRaw, iv, slice);
    chunkIvs.push(toB64(iv));
    encryptedChunks.push(encrypted);
  }

  // Wrap DEK with user's RSA public key
  const encryptedDEK = toB64(rsaOaepEncrypt(publicKeyDer, dekRaw));

  return { encryptedChunks, encryptedDEK, chunkSize, chunkCount, chunkIvs };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const mongoose = (await import("mongoose")).default;

  // ── Connect to MongoDB ──────────────────────────────────────────────────
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error("✗ MONGODB_URI not set");
    process.exit(1);
  }

  console.log("→ Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log("✓ MongoDB connected");

  // ── Define inline schemas ─────────────────────────────────────────────
  const BucketSchema = new mongoose.Schema(
    {
      userId: String, name: String, b2BucketId: String,
      region: { type: String, default: "us-west-004" },
      objectCount: { type: Number, default: 0 },
      totalSizeBytes: { type: Number, default: 0 },
    },
    { timestamps: true }
  );
  const Bucket = mongoose.models.Bucket || mongoose.model("Bucket", BucketSchema);

  const StorageObjectSchema = new mongoose.Schema(
    {
      bucketId: { type: mongoose.Schema.Types.ObjectId, ref: "Bucket" },
      userId: String, key: String, size: Number,
      contentType: { type: String, default: "application/octet-stream" },
      mediaCategory: { type: String, enum: ["image","video","audio","document","pdf","word","excel","powerpoint","archive","code","other"], default: "other" },
      b2FileId: String,
      tags: { type: [String], default: [] },
      position: { type: Number, default: 0 },
      starred: { type: Boolean, default: false },
      lastAccessedAt: Date, thumbnail: String,
      isEncrypted: { type: Boolean, default: false },
      encryptedDEK: String, iv: String, encryptedName: String,
      encryptedContentType: String,
      chunkSize: Number, chunkCount: Number, chunkIvs: String,
      chunks: [{ index: Number, key: String, size: Number }],
      deletedAt: Date, encryptedMetadata: String,
      optimizedKey: String, optimizedSize: Number,
      optimizedContentType: String, optimizedIV: String,
      optimizedEncryptedDEK: String, aspectRatio: Number,
      isSidecar: { type: Boolean, default: false },
      parentObjectId: { type: mongoose.Schema.Types.ObjectId },
      syncContentFp: String, syncMetaFp: String,
    },
    { timestamps: true }
  );
  StorageObjectSchema.index({ bucketId: 1, key: 1 }, { unique: true });
  if (mongoose.models.StorageObject) delete mongoose.models.StorageObject;
  const StorageObject = mongoose.model("StorageObject", StorageObjectSchema);

  const UsageSchema = new mongoose.Schema(
    {
      userId: { type: String, unique: true },
      plan: { type: String, default: "free" },
      totalStorageBytes: { type: Number, default: 0 },
      totalObjects: { type: Number, default: 0 },
      totalBuckets: { type: Number, default: 0 },
      totalEgressBytes: { type: Number, default: 0 },
      uploadCount: { type: Number, default: 0 },
      downloadCount: { type: Number, default: 0 },
      storageLimitBytes: Number, planExpiresAt: Date,
      planPriceINR: Number, lastActiveAt: Date,
    },
    { timestamps: true }
  );
  const Usage = mongoose.models.Usage || mongoose.model("Usage", UsageSchema);

  const UserKeyVaultSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    publicKey: String,
    encryptedPrivateKey: String,
    pbkdf2Salt: String,
    iv: String,
    encryptedRecoveryWords: String,
    recoveryIv: String,
    recoverySalt: String,
    encryptedPrivateKeyRecovery: String,
    recoveryWordSalt: String,
    recoveryWordIv: String,
  }, { timestamps: true });
  const UserKeyVault = mongoose.models.UserKeyVault || mongoose.model("UserKeyVault", UserKeyVaultSchema);

  // ── Handle --list-buckets ─────────────────────────────────────────────
  if (options["list-buckets"]) {
    const buckets = await Bucket.find({
      $or: [{ userId: USER_ID }, { userId: "system" }],
    }).sort({ createdAt: -1 });
    if (buckets.length === 0) {
      console.log(`\nNo buckets found for user ${USER_ID}`);
    } else {
      console.log(`\nBuckets for user ${USER_ID}:\n`);
      for (const b of buckets) {
        const sizeStr = (b.totalSizeBytes / 1024 / 1024).toFixed(2);
        console.log(`  _id:     ${b._id}`);
        console.log(`  name:    ${b.name}`);
        console.log(`  files:   ${b.objectCount}`);
        console.log(`  size:    ${sizeStr} MB`);
        console.log();
      }
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── Resolve bucket ────────────────────────────────────────────────────
  let bucket;
  if (BUCKET_ID) {
    bucket = await Bucket.findOne({
      _id: BUCKET_ID,
      $or: [{ userId: USER_ID }, { userId: "system" }],
    });
    if (!bucket) {
      console.error(`✗ Bucket ${BUCKET_ID} not found`);
      await mongoose.disconnect();
      process.exit(1);
    }
  } else {
    bucket = await Bucket.findOne({
      $or: [{ userId: USER_ID }, { userId: "system" }],
    }).sort({ createdAt: 1 });
    if (!bucket) {
      console.error(`✗ No buckets found for user ${USER_ID}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`✓ Auto-selected bucket: "${bucket.name}" (${bucket._id})`);
  }
  console.log(`✓ Bucket: "${bucket.name}" (b2: ${bucket.b2BucketId})`);

  // ── Prepare file info ─────────────────────────────────────────────────
  const stats = fs.statSync(FILE_PATH);
  const fileName = path.basename(FILE_PATH);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const mediaCategory = getMediaCategory(mimeType);
  const plainBuffer = fs.readFileSync(FILE_PATH);

  console.log(`\n📁 File:     ${fileName}`);
  console.log(`📦 Size:     ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🎬 Type:     ${mimeType} (${mediaCategory})`);

  // ── Unlock vault & derive keys ────────────────────────────────────────
  let publicKeyDer = null;
  let metadataKeyBuf = null;

  if (!SKIP_ENCRYPT) {
    console.log("\n→ Unlocking vault...");
    const vault = await UserKeyVault.findOne({ userId: USER_ID });
    if (!vault) {
      console.error("✗ No vault found for this user. Use --no-encrypt to skip encryption.");
      await mongoose.disconnect();
      process.exit(1);
    }

    // Get vault password
    let vaultPassword = options.password || process.env.XENODE_VAULT_PASSWORD;
    if (!vaultPassword) {
      // Prompt for password
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      vaultPassword = await new Promise((resolve) => {
        rl.question("Enter vault master password: ", (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    // Step 1: Decrypt recovery words using master password
    const recoverySalt = fromB64(vault.recoverySalt);
    const recoveryKey = deriveKeySync(vaultPassword, recoverySalt);
    const recoveryIv = fromB64(vault.recoveryIv);
    const encryptedRecoveryWords = fromB64(vault.encryptedRecoveryWords);

    let recoveryWords;
    try {
      const decryptedBuf = aesGcmDecrypt(recoveryKey, recoveryIv, encryptedRecoveryWords);
      recoveryWords = decryptedBuf.toString("utf-8");
    } catch {
      console.error("✗ Wrong vault password!");
      await mongoose.disconnect();
      process.exit(1);
    }

    // Step 2: Build full passphrase and decrypt private key
    const passphrase = `${vaultPassword}:${recoveryWords}`;
    const pbkdf2Salt = fromB64(vault.pbkdf2Salt);
    const masterKey = deriveKeySync(passphrase, pbkdf2Salt);
    const vaultIv = fromB64(vault.iv);
    const encryptedPrivKey = fromB64(vault.encryptedPrivateKey);

    let privateKeyBuf;
    try {
      privateKeyBuf = aesGcmDecrypt(masterKey, vaultIv, encryptedPrivKey);
    } catch {
      console.error("✗ Failed to decrypt private key!");
      await mongoose.disconnect();
      process.exit(1);
    }

    // We need the public key DER for RSA-OAEP wrapping
    publicKeyDer = fromB64(vault.publicKey);

    // metadataKey = SHA-256(privateKeyBuf) — matches keySetup.ts
    metadataKeyBuf = crypto.createHash("sha256").update(privateKeyBuf).digest();

    console.log("✓ Vault unlocked");
  }

  // ── Build S3 client ───────────────────────────────────────────────────
  const S3_ENDPOINT = process.env.S3_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
  const S3_REGION = process.env.S3_REGION || "us-west-004";
  const S3_KEY_ID = process.env.S3_KEY_ID;
  const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY;

  if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
    console.error("✗ S3_KEY_ID and S3_APPLICATION_KEY must be set");
    await mongoose.disconnect();
    process.exit(1);
  }

  const s3 = new S3Client({
    endpoint: S3_ENDPOINT, region: S3_REGION,
    credentials: { accessKeyId: S3_KEY_ID.trim(), secretAccessKey: S3_APPLICATION_KEY.trim() },
    forcePathStyle: true,
  });

  // ── Encrypt & Upload ──────────────────────────────────────────────────
  const shouldEncrypt = !SKIP_ENCRYPT && publicKeyDer;
  const isStreamable = mimeType.startsWith("video/") || mimeType.startsWith("audio/");

  // Use UUID as the storage key when encrypted (hides real filename)
  const storageFileName = shouldEncrypt
    ? crypto.randomUUID()
    : fileName.replace(/[\/\\]/g, "_");
  const prefix = `users/${USER_ID}/`;

  let encryptedDEK, encryptedName, encryptedContentType, encryptedMetadata;
  let chunkSize, chunkCount, chunkIvs, singleIv;
  let totalUploadSize = stats.size;
  let uploadContentType = mimeType;
  let chunks = [];

  if (shouldEncrypt) {
    console.log("\n→ Encrypting file...");

    // Encrypt the filename
    encryptedName = encryptMetadataString(fileName, metadataKeyBuf);
    encryptedContentType = encryptMetadataString(mimeType, metadataKeyBuf);

    // Build and encrypt metadata object
    const metadata = {
      fileName,
      mimeType,
      size: stats.size,
    };
    encryptedMetadata = encryptMetadataObject(metadata, metadataKeyBuf);

    if (isStreamable || stats.size > 5 * 1024 * 1024) {
      // Chunked encryption (videos, audio, and large files)
      chunkSize = getAdaptiveChunkSize(stats.size, mimeType);
      const enc = encryptFileChunked(plainBuffer, publicKeyDer, chunkSize);
      encryptedDEK = enc.encryptedDEK;
      chunkCount = enc.chunkCount;
      chunkIvs = JSON.stringify(enc.chunkIvs);
      uploadContentType = "application/octet-stream";

      // Upload each chunk individually to S3
      console.log(`→ Uploading ${chunkCount} encrypted chunks...`);
      totalUploadSize = 0;

      for (let i = 0; i < enc.encryptedChunks.length; i++) {
        const chunkKey = `${prefix}${storageFileName}_chunk_${i}`;
        const chunkBuf = enc.encryptedChunks[i];
        totalUploadSize += chunkBuf.length;

        await s3.send(new PutObjectCommand({
          Bucket: bucket.b2BucketId,
          Key: chunkKey,
          ContentType: "application/octet-stream",
          Body: chunkBuf,
          ContentLength: chunkBuf.length,
        }));

        chunks.push({ index: i, key: chunkKey, size: chunkBuf.length });
        const pct = Math.round(((i + 1) / chunkCount) * 100);
        process.stdout.write(`\r  Chunks uploaded: ${i + 1}/${chunkCount} (${pct}%)`);
      }
      console.log("\n✓ All chunks uploaded");
    } else {
      // Single-blob encryption (small files)
      const dekRaw = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const encrypted = aesGcmEncrypt(dekRaw, iv, plainBuffer);
      encryptedDEK = toB64(rsaOaepEncrypt(publicKeyDer, dekRaw));
      singleIv = toB64(iv);
      uploadContentType = "application/octet-stream";

      const objectKey = `${prefix}${storageFileName}`;
      console.log(`→ Uploading encrypted file to S3: ${objectKey}`);
      await s3.send(new PutObjectCommand({
        Bucket: bucket.b2BucketId,
        Key: objectKey,
        ContentType: "application/octet-stream",
        Body: encrypted,
        ContentLength: encrypted.length,
      }));
      totalUploadSize = encrypted.length;
      console.log("✓ Encrypted upload complete");
    }
  } else {
    // Plaintext upload
    const objectKey = `${prefix}${storageFileName}`;
    console.log(`\n→ Uploading plaintext to S3: ${objectKey}`);
    await s3.send(new PutObjectCommand({
      Bucket: bucket.b2BucketId,
      Key: objectKey,
      ContentType: mimeType,
      Body: plainBuffer,
      ContentLength: plainBuffer.length,
    }));
    console.log("✓ Upload complete");
  }

  // ── Verify via HeadObject ─────────────────────────────────────────────
  const isChunked = chunks.length > 0;
  let b2FileId;
  const mainKey = `${prefix}${storageFileName}`;

  if (isChunked) {
    // Verify first chunk exists
    console.log("→ Verifying upload...");
    await s3.send(new HeadObjectCommand({ Bucket: bucket.b2BucketId, Key: chunks[0].key }));
    b2FileId = `multipart-${mainKey}`;
    console.log("✓ Chunks verified");
  } else {
    console.log("→ Verifying upload...");
    const headRes = await s3.send(new HeadObjectCommand({ Bucket: bucket.b2BucketId, Key: mainKey }));
    b2FileId = headRes.VersionId || `${bucket.b2BucketId}/${mainKey}`;
    console.log("✓ File verified");
  }

  // ── Create StorageObject ──────────────────────────────────────────────
  console.log("→ Creating database record...");
  const storageObject = await StorageObject.create({
    bucketId: bucket._id,
    userId: USER_ID,
    key: isChunked ? mainKey : mainKey,
    size: totalUploadSize,
    contentType: shouldEncrypt ? "application/octet-stream" : mimeType,
    mediaCategory,
    b2FileId,
    isEncrypted: !!shouldEncrypt,
    encryptedDEK: encryptedDEK || undefined,
    iv: singleIv || undefined,
    encryptedName: encryptedName || undefined,
    encryptedContentType: encryptedContentType || undefined,
    chunkSize: chunkSize || undefined,
    chunkCount: chunkCount || undefined,
    chunkIvs: chunkIvs || undefined,
    chunks: isChunked ? chunks : undefined,
    encryptedMetadata: encryptedMetadata || undefined,
    lastAccessedAt: new Date(),
  });
  console.log(`✓ StorageObject created: ${storageObject._id}`);

  // ── Update metering ───────────────────────────────────────────────────
  console.log("→ Updating usage & bucket stats...");
  await Usage.findOneAndUpdate(
    { userId: USER_ID },
    {
      $inc: { totalStorageBytes: totalUploadSize, totalObjects: 1, uploadCount: 1 },
      $set: { lastActiveAt: new Date() },
    },
    { upsert: true, new: true }
  );
  await Bucket.findByIdAndUpdate(bucket._id, {
    $inc: { objectCount: 1, totalSizeBytes: totalUploadSize },
  });
  console.log("✓ Metering updated");

  // ── Done ──────────────────────────────────────────────────────────────
  console.log(`\n✅ Upload complete!`);
  console.log(`   Object ID:  ${storageObject._id}`);
  console.log(`   Encrypted:  ${!!shouldEncrypt}`);
  console.log(`   Chunked:    ${isChunked} ${isChunked ? `(${chunkCount} chunks)` : ""}`);
  console.log(`   Size:       ${(totalUploadSize / 1024 / 1024).toFixed(2)} MB`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n✗ Upload failed:", err.message || err);
  try {
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
