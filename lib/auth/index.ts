import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { passkey } from "better-auth/plugins/passkey";
import { MongoClient } from "mongodb";

function createAuth() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const client = new MongoClient(MONGODB_URI);
  const db = client.db();

  // Derive rpID from NEXT_PUBLIC_APP_URL hostname, fall back to 'localhost' for dev
  const appURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const rpID = (() => {
    try {
      return new URL(appURL).hostname;
    } catch {
      return "localhost";
    }
  })();

  return betterAuth({
    database: mongodbAdapter(db, {
      usePlural: false,
      transaction: false,
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: appURL,
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
    plugins: [
      passkey({
        rpID,
        rpName: "Xenode",
        origin: appURL,
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    trustedOrigins: [appURL],
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

// Lazy singleton pattern to avoid initialization during build
let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
