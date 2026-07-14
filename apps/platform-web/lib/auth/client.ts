import { createAuthClient } from "better-auth/react";
import { expo } from "@better-auth/expo";
import {
  twoFactorClient,
  emailOTPClient,
  organizationClient,
} from "better-auth/client/plugins";
import { orgAccessControl, orgRoles } from "@/lib/auth/organization";

const getAuthBaseURL = () => {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/auth`;
  }

  return (
    process.env.EXPO_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
};

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
  plugins: [
    expo(),
    twoFactorClient(),
    emailOTPClient(),
    ...(process.env.NEXT_PUBLIC_ORGS_ENABLED === "true"
      ? [
          organizationClient({
            teams: { enabled: true },
            ac: orgAccessControl,
            roles: orgRoles,
          }),
        ]
      : []),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
