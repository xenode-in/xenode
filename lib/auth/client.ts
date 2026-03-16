import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL:
    process.env.EXPO_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
  plugins: [
    expoClient({
      scheme: "xenode",
      storagePrefix: "xenode",
      storage: SecureStore,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
