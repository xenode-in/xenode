import { createAuthClient } from "better-auth/react";
import { expo } from "@better-auth/expo";

export const authClient = createAuthClient({
  baseURL:
    process.env.EXPO_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
  plugins: [expo()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
