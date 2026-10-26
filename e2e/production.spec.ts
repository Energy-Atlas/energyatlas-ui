import { createProjectFromStart } from './test.ts'
import { BASE_PATH } from '../basePath.ts'
import { expect, test } from './test.ts'

// One spec against the built bundle (decision 0017). The dev server resolves
// MapLibre's worker from node_modules and serves everything from "/", so it
// cannot catch a missing emitted file or a wrong base path; only a build can.
//
// Vite preview answers a missing file with index.html and a 200, so asset
// checks look at the content type rather than the status. GitHub Pages has no
// such fallback and returns a real 404.

test('the built bundle serves its assets and renders the map', async ({
  page,
}) => {
  const failed: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.goto(BASE_PATH)
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()

  // MapLibre derives this URL from import.meta.url at run time, so the bundler
  // never sees it and the build has to emit the file next to its chunk.
  const worker = await page.request.get(
    `${BASE_PATH}assets/maplibre-gl-worker.mjs`,
  )
  expect(worker.status()).toBe(200)
  expect(worker.headers()['content-type'] ?? '').toContain('javascript')

  // A first visit has no saved project, so the map appears once a stage runs.
  await page
    .getByRole('button', { name: 'Run Location setup / footprint capturing' })
    .first()
    .click()
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({
    timeout: 30_000,
  })

  expect(failed).toEqual([])
})

// Decision 0021, section 14: the EnergyAtlas favicons and mark come from the
// app's own origin under the base path. Preview answers a missing file with
// index.html, so the check reads the content type.
test('serves the EnergyAtlas favicons and mark under the base path', async ({
  page,
}) => {
  await page.goto(BASE_PATH)
  const links = await page
    .locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href') ?? ''),
    )
  expect(links).toHaveLength(4)
  // The mark is small enough for Vite to inline as a data URI: no request.
  const mark = await page.locator('header img').first().getAttribute('src')
  expect(mark ?? '').toMatch(/^(data:image\/svg\+xml|\/)/)
  const requested = mark?.startsWith('data:') ? links : [...links, mark ?? '']
  for (const href of requested) {
    expect(href.startsWith(BASE_PATH)).toBe(true)
    const response = await page.request.get(href)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type'] ?? '').toMatch(/^image\//)
  }
})

// Jobs (decision 0025) in the built bundle: a partial failure, its notice,
// and a failed-item retry under the base path.
test('runs, holds, and retries a partial job in the built bundle', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto(`${BASE_PATH}?fixture=partway&jobs=itemFailures`)
  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  await page
    .getByRole('region', { name: 'Workflow' })
    .getByRole('button', { name: /^Rerun Geospatial preprocessing/ })
    .click()
  const notices = page.getByRole('region', { name: 'Job notices' })
  await expect(notices).toContainText('partly failed', { timeout: 20_000 })
  await notices.getByRole('button', { name: 'Open job' }).click()
  const detail = page.getByRole('article')
  await detail.getByRole('button', { name: /^Retry \d+ failed items?/ }).click()
  await expect(detail).toContainText('Published', { timeout: 20_000 })
})
