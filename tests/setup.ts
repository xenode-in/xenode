import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach, vi } from "vitest";

let mongod: MongoMemoryReplSet;

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
}));

// Mock better-auth session
vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
  getServerSession: vi.fn(),
}));
