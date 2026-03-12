import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "app/api/payment/**/*.ts",
        "app/api/objects/presign-upload/**/*.ts",
        "app/api/objects/complete-upload/**/*.ts",
        "app/api/cron/**/*.ts",
        "lib/metering/**/*.ts",
        "models/Usage.ts",
        "models/Payment.ts",
        "models/PendingTransaction.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
