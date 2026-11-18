import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  use: {
    baseURL: "http://localhost:4173",
    launchOptions: process.env.AGENTPULSE_CHROME
      ? { executablePath: process.env.AGENTPULSE_CHROME }
      : {},
  },
  webServer: {
    command: "pnpm dev:demo --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
