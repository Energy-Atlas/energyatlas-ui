import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import {
  blockBasemap,
  blockTerrain,
  expect,
  serveBasemapStub,
  serveTerrainStub,
  test,
  type Locator,
  type Page,
} from './test.ts'

/** Counts pixels the 3D selection outline has painted on its overlay canvas. */
async function paintedPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    const overlay = element as HTMLCanvasElement
    const context = overlay.getContext('2d')
    if (!context || overlay.width === 0 || overlay.height === 0) return 0
    const { data } = context.getImageData(0, 0, overlay.width, overlay.height)
    let painted = 0
    for (let index = 3; index < data.length; index += 4) {
      if (data[index]) painted += 1
    }
    return painted
  })
}

// First-slice build stage 3b: Map and Table with linked selection and pending edits.

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.html}`).join(', ')}`,
    )
}

async function runStages(page: Page, names: string[]) {
  // Clicking an already selected border tab closes its panel.
  const workflowTab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await workflowTab.getAttribute('aria-selected')) !== 'true') {
    await workflowTab.click()
  }
  const workflow = page.getByRole('region', { name: 'Workflow' })
  for (const name of names) {
    const item = workflow.getByRole('listitem').filter({ hasText: name })
    await item.getByRole('button', { name: `Run ${name}` }).click()
    await expect(item).toContainText('Complete', { timeout: 10_000 })
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
})

test('table and map explain what is missing before footprints exist', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await expect(page.getByText('No buildings yet')).toBeVisible()
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  await expect(page.getByText('No footprints yet')).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('table validates floor edits, holds them pending, and applies them', async ({
  page,
}) => {
  await runStages(page, [
    'Location setup / footprint capturing',
    'Geospatial data enriching',
  ])
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const floors = page.locator('[row-index="0"] [col-id="floors"]')
  await expect(floors).toBeVisible()
  const original = (await floors.innerText()).trim()

  await floors.dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('0')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText(
    'Floors must be a whole number from 1 to 60.',
  )

  const edited = original === '11' ? '10' : String(Number(original) + 1)
  await floors.dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(edited)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pending-count')).toHaveText('1 pending edit')
  await expect(floors).toHaveText(edited)
  await expect(floors).toHaveClass(/eaui-pending-cell/)

  await page.getByRole('button', { name: 'Apply pending edits' }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('0 pending edits')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Applied 1 edit',
  )
  await expect(floors).toHaveText(edited)
  expect(await seriousViolations(page)).toEqual([])
})

test('selection is shared between the table and the map', async ({ page }) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  await expect(page.getByTestId('map-selection')).toHaveText(
    '1 building selected: B0001',
  )
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()

  await page.getByRole('button', { name: 'Clear selection' }).click()
  await expect(page.getByTestId('map-selection')).toHaveText('Nothing selected')

  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await expect(page.locator('[row-index="0"]').first()).not.toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible()
})

// Decision 0012: OpenFreeMap basemap over OpenStreetMap footprints. The shared
// fixture in e2e/test.ts serves a stand-in style and empty tiles.

test('map shows the basemap with credits for the basemap and the footprints', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  const attribution = page.locator('.maplibregl-ctrl-attrib')
  await expect(attribution).toContainText('OpenFreeMap')
  await expect(attribution).toContainText('OpenMapTiles')
  await expect(attribution).toContainText('OpenStreetMap contributors')
  await expect(page.getByTestId('basemap-status')).toHaveText('')
  expect(await seriousViolations(page)).toEqual([])
})

test('map falls back to a plain background when the basemap cannot load, then retries', async ({
  page,
}) => {
  await blockBasemap(page)
  await page.reload()
  await createProjectFromStart(page)
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()

  const status = page.getByTestId('basemap-status')
  await expect(status).toContainText('Basemap unavailable')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(
    'OpenStreetMap contributors',
  )
  expect(await seriousViolations(page)).toEqual([])

  await serveBasemapStub(page)
  await page
    .getByRole('button', { name: 'Try loading the basemap again' })
    .click()
  await expect(status).toHaveText('')
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(
    'OpenFreeMap',
  )
})

// Decision 0013: 3D building extrusion.
test('map switches buildings between 2D and 3D and explains missing heights', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()

  const toggle = page.getByRole('checkbox', { name: '3D buildings' })
  await expect(toggle).not.toBeChecked()
  // React Aria keeps the native checkbox visually hidden; use the keyboard.
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'buildings stay flat until "Geospatial preprocessing" computes heights',
  )
  await expect(page.getByTestId('map-3d-note')).toBeVisible()

  await runStages(page, [
    'Geospatial data enriching',
    'Schema matching',
    'Geospatial preprocessing',
  ])
  await expect(page.getByTestId('map-3d-note')).toHaveCount(0)
  const legend = page.getByRole('group', { name: 'Map legend' })
  await expect(legend).toContainText('Height: floors × 3.2 m (synthetic)')
  await expect(page.getByText('Shift+arrow keys rotate and tilt')).toBeVisible()

  // Selecting a building in 3D paints its silhouette outline on the overlay.
  const silhouette = page.getByTestId('selection-silhouette')
  expect(await paintedPixels(silhouette)).toBe(0)
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  await expect
    .poll(() => paintedPixels(silhouette), { timeout: 10_000 })
    .toBeGreaterThan(0)
  expect(await seriousViolations(page)).toEqual([])

  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'The map shows buildings in 2D.',
  )
  await expect(legend).not.toContainText('Height: floors')
  await expect.poll(() => paintedPixels(silhouette)).toBe(0)
})

// Decision 0015: live terrain for display only; e2e/test.ts serves flat tiles.
test('map shows terrain at true scale and sets exaggeration from the keyboard', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()

  // Terrain belongs to the 3D scene (decision 0018), so it is offered there.
  const flat = page.getByRole('checkbox', { name: 'Terrain (3D only)' })
  await expect(flat).toBeDisabled()
  const view3d = page.getByRole('checkbox', { name: '3D buildings' })
  await view3d.focus()
  await page.keyboard.press('Space')

  const toggle = page.getByRole('checkbox', { name: 'Terrain', exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'The map shows terrain at true scale.',
  )
  const legend = page.getByRole('group', { name: 'Map legend' })
  await expect(legend).toContainText(
    'Terrain: true scale (Mapterhorn, USGS 3DEP)',
  )
  await expect(page.getByTestId('terrain-status')).toHaveText('')
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(
    'Mapterhorn',
  )

  const slider = page.getByRole('slider', { name: 'Terrain exaggeration' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Terrain is shown at 3× exaggerated.',
  )
  await expect(legend).toContainText('Terrain: 3× exaggerated')
  expect(await seriousViolations(page)).toEqual([])

  // Going flat pauses terrain and keeps the choice.
  await view3d.focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('map-terrain-note')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Terrain' })).toBeChecked()

  await view3d.focus()
  await page.keyboard.press('Space')
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(legend).not.toContainText('Terrain:')
})

test('map falls back to a flat map when terrain cannot load, then retries', async ({
  page,
}) => {
  await blockTerrain(page)
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const view3d = page.getByRole('checkbox', { name: '3D buildings' })
  await view3d.focus()
  await page.keyboard.press('Space')
  const toggle = page.getByRole('checkbox', { name: 'Terrain', exact: true })
  await toggle.focus()
  await page.keyboard.press('Space')

  const status = page.getByTestId('terrain-status')
  await expect(status).toHaveText('Terrain unavailable: the map is shown flat.')
  expect(await seriousViolations(page)).toEqual([])

  await serveTerrainStub(page)
  await page.getByRole('button', { name: 'Try loading terrain again' }).click()
  await expect(status).toHaveText('')
  await expect(toggle).toBeChecked()
})

test('settings turns the basemap off and keeps the choice across reloads', async ({
  page,
}) => {
  // Settings can sit in the tab overflow menu at 1280 px; open it by command.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('settings')
  await page.keyboard.press('Enter')

  const toggle = page.getByRole('checkbox', {
    name: 'Show the OpenFreeMap basemap',
  })
  await expect(toggle).toBeChecked()
  // React Aria keeps the native checkbox visually hidden; use the keyboard.
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'The Map shows footprints on a plain background.',
  )

  await page.reload()
  await createProjectFromStart(page)
  await expect(
    page.getByRole('checkbox', { name: 'Show the OpenFreeMap basemap' }),
  ).not.toBeChecked()

  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const attribution = page.locator('.maplibregl-ctrl-attrib')
  await expect(attribution).toContainText('OpenStreetMap contributors')
  await expect(attribution).not.toContainText('OpenFreeMap')
  await expect(page.getByTestId('basemap-status')).toHaveText('')
})

// Decision 0018: the map's own properties, shown in Inspection while the map is
// the surface being worked in and nothing is selected.
test('the map offers its lighting in Inspection when nothing is selected', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Inspection', exact: true }).click()
  const inspection = page.getByRole('region', { name: 'Inspection' })
  await expect(inspection.getByText('Nothing selected')).toBeVisible()

  // Working in the map hands Inspection to it.
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  await expect(inspection.getByText('Scene lighting')).toBeVisible()
  // The lighting is disclosed as display only, and the sun's own numbers are
  // not shown (decision 0019).
  await expect(inspection).toContainText('Simulated')
  await expect(inspection).not.toContainText('Elevation')
  await expect(inspection).not.toContainText('Azimuth')

  const haze = inspection.getByRole('slider', { name: 'Horizon haze' })
  await haze.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Horizon haze is 25%.',
  )

  const season = inspection.getByRole('slider', { name: 'Season' })
  await season.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Map lighting is set to 22 June.',
  )

  // A selection takes Inspection back.
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await expect(inspection.locator('header').first()).toContainText('B0001')
})
