import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 5173);
const backendPort = Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
  webServer: [
    {
      command: `PORT=${backendPort} NODE_ENV=development DATABASE_URL=${process.env.DATABASE_URL ?? "postgresql://myishasiddiqui@localhost:5432/recordkeeper"} FRONTEND_ORIGIN=http://localhost:${frontendPort} npm run dev`,
      cwd: "./backend",
      url: `http://localhost:${backendPort}/api/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `VITE_API_BASE_URL=http://localhost:${backendPort} npm run dev -- --host localhost --port ${frontendPort}`,
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
