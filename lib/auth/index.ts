import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";
import { expo } from "@better-auth/expo";
import { Resend } from "resend";

function createAuth() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const client = new MongoClient(MONGODB_URI);
  const db = client.db();
  const resend = new Resend(process.env.RESEND_API_KEY || "fallback");

  return betterAuth({
    database: mongodbAdapter(db, {
      usePlural: false,
      transaction: false,
    }),
    plugins: [expo()],
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await resend.emails.send({
          from: "Xenode <noreply@alerts.xenode.in>",
          to: user.email,
          subject: "Verify your email address - Xenode",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaec; border-radius: 8px;">
              <h2 style="color: #333;">Welcome to Xenode, ${user.name}!</h2>
              <p style="color: #555; line-height: 1.5;">Please verify your email address to complete your registration and get started.</p>
              <a href="${url}" style="display: inline-block; background-color: #7cb686; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin-top: 10px; margin-bottom: 20px;">Verify Email</a>
              <p style="color: #888; font-size: 14px;">If you didn't create this account, you can safely ignore this email.</p>
            </div>
          `,
        });
      },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        enabled: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
        scope: [
          "https://www.googleapis.com/auth/drive.readonly",
          "profile",
          "email",
        ],
        accessType: "offline",
        prompt: "consent",
        disableSignUp: true,
        overrideUserInfoOnSignIn: false,
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
      "xenode://",
      "xenode://*",
      "http://localhost:8081",
      ...(process.env.NODE_ENV === "development"
        ? ["exp://", "exp://**", "exp://192.168.*.*:*/**"]
        : []),
    ],
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },
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

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
