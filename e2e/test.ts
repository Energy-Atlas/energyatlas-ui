import { expect, test as base, type Locator, type Page } from '@playwright/test'

// Product specs import `test` and `expect` from here. Every page serves a small
// stand-in for the OpenFreeMap style, TileJSON, and tiles, so tests stay
// offline and repeatable (decision 0012). Call blockBasemap before navigating
// to exercise the fallback.

export { expect, type Locator, type Page } from '@playwright/test'

const OPENFREEMAP = 'https://tiles.openfreemap.org/**'
const CORS = { 'Access-Control-Allow-Origin': '*' }

export const STUB_BASEMAP_STYLE = {
  version: 8,
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgb(242,243,240)' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': 'rgb(194, 200, 202)' },
    },
  ],
}

const STUB_TILEJSON = {
  tilejson: '3.0.0',
  tiles: ['https://tiles.openfreemap.org/planet/stub/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
}

export async function serveBasemapStub(page: Page): Promise<void> {
  await page.unroute(OPENFREEMAP)
  await page.route(OPENFREEMAP, async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith('/styles/')) {
      return route.fulfill({ json: STUB_BASEMAP_STYLE, headers: CORS })
    }
    if (pathname === '/planet') {
      return route.fulfill({ json: STUB_TILEJSON, headers: CORS })
    }
    // Empty tiles: the basemap renders only its background and water color.
    return route.fulfill({ status: 204, body: '', headers: CORS })
  })
}

// Terrain (decision 0015): an 8x8 terrarium PNG at elevation 0, so terrain
// renders flat without the network.
const MAPTERHORN = 'https://tiles.mapterhorn.com/**'
const FLAT_TERRAIN_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNoYGDAirCLDloJAKF8IAFkxpMYAAAAAElFTkSuQmCC',
  'base64',
)

export async function serveTerrainStub(page: Page): Promise<void> {
  await page.unroute(MAPTERHORN)
  await page.route(MAPTERHORN, (route) =>
    route.fulfill({
      status: 200,
      body: FLAT_TERRAIN_TILE,
      contentType: 'image/png',
      headers: CORS,
    }),
  )
}

export async function blockTerrain(page: Page): Promise<void> {
  await page.unroute(MAPTERHORN)
  await page.route(MAPTERHORN, (route) => route.abort('internetdisconnected'))
}

export async function blockBasemap(page: Page): Promise<void> {
  await page.unroute(OPENFREEMAP)
  await page.route(OPENFREEMAP, (route) => route.abort('internetdisconnected'))
}

/** The session key of the demo conditions (decision 0023). */
/** The toasts region, where asynchronous events and failures pop up (decision 0027). */
export function notifications(page: Page): Locator {
  return page.getByRole('region', { name: 'Notifications' })
}

/** One toast, found by its text. */
export function toast(page: Page, text: string | RegExp): Locator {
  return notifications(page).locator('[data-tone]').filter({ hasText: text })
}

export const DEMO_CONDITIONS_KEY = 'eaui.demoConditions'

/** Normal product entry, through the same Create form a person uses. */
export async function createProjectFromStart(
  page: Page,
  name = 'Synthetic district (demo)',
) {
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByRole('textbox', { name: 'Project name' }).fill(name)
  await dialog
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
}

export async function openRecentProject(
  page: Page,
  name = 'Synthetic district (demo)',
) {
  await page
    .getByRole('main', { name: 'Projects' })
    .getByRole('button')
    .filter({ hasText: name })
    .first()
    .click()
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
}

export const test = base.extend<{ basemapStub: undefined }>({
  basemapStub: [
    async ({ page }, use) => {
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'beforeunload') await dialog.accept()
        else await dialog.dismiss()
      })
      await serveBasemapStub(page)
      await serveTerrainStub(page)
      // The mock server answers without delay in tests unless a test sets
      // other conditions; a stored choice survives reloads, as in the app.
      await page.addInitScript((key) => {
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(
            key,
            JSON.stringify({ latency: 'none' }),
          )
        }
      }, DEMO_CONDITIONS_KEY)
      await use(undefined)
    },
    { auto: true },
  ],
})
