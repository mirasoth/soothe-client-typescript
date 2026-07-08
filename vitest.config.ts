import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests involve daemon communication and can take longer
    testTimeout: 60_000,
  },
});
