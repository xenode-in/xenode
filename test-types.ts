import { betterAuth } from "better-auth";
betterAuth({
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
    }
  }
});
