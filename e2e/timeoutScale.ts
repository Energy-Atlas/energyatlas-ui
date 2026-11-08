/**
 * How much longer every browser-test timeout is on CI. The Pages workflow runs
 * on a hosted Linux runner that renders WebGL in software; on 2026-11-08 the
 * same tests took about 2 to 3.5 times as long there as locally, and tests
 * that need half their budget locally ran out of it there. The default and
 * assertion timeouts in the Playwright configs and every `test.setTimeout` in
 * a spec (through `e2e/test.ts`) are multiplied by this. Locally it is 1, so
 * a slow test still shows up while it is being written.
 */
export const TIMEOUT_SCALE = process.env.CI ? 3 : 1
