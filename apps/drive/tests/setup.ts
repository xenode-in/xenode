import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { clearStorageConfigCacheForTests } from "@xenode/config/storage";

let mongod: MongoMemoryReplSet;

beforeEach(() => {
  vi.stubEnv("STORAGE_ENABLED_REGIONS", "asia");
  vi.stubEnv("S3_BUCKET_NAME", "xenode-drive-storage");
  vi.stubEnv("S3_ENDPOINT", "https://example.r2.cloudflarestorage.com");
  vi.stubEnv("S3_REGION", "auto");
  vi.stubEnv("S3_KEY_ID", "test-key");
  vi.stubEnv("S3_APPLICATION_KEY", "test-secret");
  for (const region of ["US", "EU"]) {
    for (const name of ["BUCKET_NAME", "ENDPOINT", "REGION", "KEY_ID", "APPLICATION_KEY"]) {
      vi.stubEnv(`S3_${region}_${name}`, undefined);
    }
  }
  clearStorageConfigCacheForTests();
});

vi.mock("@/lib/b2/buckets", () => ({ bucketExists: vi.fn(async () => true) }));

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

afterEach(async () => {
  // Wipe all collections between tests for isolation
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

// Mock Next.js server internals
vi.mock("@/lib/mongodb", () => ({
  default: async () => mongoose,
}));

// Mock PostHog to prevent real events during tests
vi.mock("@/lib/posthog", () => ({
  captureEvent: vi.fn(),
  contentTypeCategory: vi.fn((contentType?: string) => {
    if (!contentType) return "unknown";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    if (contentType.startsWith("audio/")) return "audio";
    return "other";
  }),
  countBucket: vi.fn((count: number) => String(count)),
  sizeBucket: vi.fn(() => "test_bucket"),
}));

// Mock better-auth session
vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
  getServerSession: vi.fn(),
}));
