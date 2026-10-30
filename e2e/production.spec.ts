import { createProjectFromStart, notifications, toast } from './test.ts'
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
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

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
  const notices = notifications(page)
  await expect(notices).toContainText('partly failed', { timeout: 20_000 })
  await toast(page, /partly failed/)
    .getByRole('button', { name: 'Open job' })
    .click()
  const detail = page.getByRole('article')
  await detail.getByRole('button', { name: /^Retry \d+ failed items?/ }).click()
  await expect(detail).toContainText('Published', { timeout: 20_000 })
})

// The viewer page (decision 0032, stage 5) is a second HTML entry; under the
// base path it must load its own bundle, list a package handed over in the
// modeller, and open it view only.
test('serves the viewer page under the base path and opens a view', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const failed: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`)
    }
  })
  await page.goto(`${BASE_PATH}?fixture=complete`)
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  // A view holds the saved copy (decision 0032); File > Save as… > View
  // makes it (decision 0036).
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('Saved')
  await page
    .getByRole('toolbar', { name: 'Workbench commands' })
    .getByRole('button', { name: 'File', exact: true })
    .click()
  await page.getByRole('menuitem', { name: /^Save as/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as' })
  await dialog.getByText('View', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Save as a view' }).click()
  const link = page.getByRole('link', { name: 'Open in the viewer' })
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`^${BASE_PATH}viewer[.]html[?]package=`),
  )

  const viewer = await page.request.get(`${BASE_PATH}viewer.html`)
  expect(viewer.status()).toBe(200)
  // Preview falls back to index.html for missing files: check it is the viewer.
  expect(await viewer.text()).toContain('EnergyAtlas viewer')

  await page.goto((await link.getAttribute('href')) ?? '')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await expect(page.getByText('View only', { exact: true })).toBeVisible()
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({
    timeout: 30_000,
  })
  expect(failed).toEqual([])
})
