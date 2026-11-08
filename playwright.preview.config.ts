import { defineConfig, devices } from '@playwright/test'
import { BASE_PATH } from './basePath.ts'
import { TIMEOUT_SCALE } from './e2e/timeoutScale.ts'

// Checks the production bundle, which the dev-server specs cannot: the base
// path, and files that only a build emits, such as MapLibre's worker
// (decision 0017). Kept separate so the everyday `npm run test:e2e` stays fast
// and needs no build; `npm run test:e2e:preview` builds and runs this one.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge'
const baseURL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: 'e2e',
  testMatch: /production\.spec\.ts/,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Longer on the slower CI runner; see e2e/timeoutScale.ts.
  timeout: 30_000 * TIMEOUT_SCALE,
  expect: { timeout: 5_000 * TIMEOUT_SCALE },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'production',
      use: {
        ...devices['Desktop Chrome'],
        channel,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    // Serves whatever is in dist; the script builds before calling Playwright.
    // The prefix comes from basePath.ts, the same source the build used, so a
    // repository rename cannot leave preview serving one path and the bundle
    // asking for another.
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: `${baseURL}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
  },
})
