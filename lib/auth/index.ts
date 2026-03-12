import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import dbConnect from "@/lib/mongodb";
import mongoose from "mongoose";

/**
 * GAP-3: Reuse the existing Mongoose connection's native db client for better-auth.
 * This eliminates the duplicate standalone MongoClient that was previously created,
 * reducing connection pool overhead and enabling future cross-collection transactions.
 *
 * Pattern: lazy singleton that waits for Mongoose to be connected before
 * handing the native db reference to better-auth.
 */
async function getDb() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection not established");
  return db;
}

function createAuth() {
  // We pass a db-getter-compatible adapter.
  // better-auth mongodbAdapter accepts a db promise as well.
  const dbPromise = getDb();

  return betterAuth({
    database: mongodbAdapter(dbPromise as any, {
      usePlural: false,
      // transaction: false is kept for now — enabling requires replica set
      transaction: false,
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        enabled: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
        enabled: !!(
          process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    trustedOrigins: [
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    ],
    user: {
      additionalFields: {
        onboarded: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        encryptByDefault: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      },
    },
  });
}

// Lazy singleton — avoids initialization during build
let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
