import { createProjectFromStart, properties, saveAndReopen } from './test.ts'
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

/**
 * Opens the Map and shows its own properties (decision 0030): working in the
 * map with nothing selected hands Properties to it.
 */
async function openMapProperties(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  // Clicking an already selected border tab closes its panel.
  const tab = page.getByRole('tab', { name: 'Properties', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  const panel = properties(page)
  await expect(
    panel.getByRole('heading', { name: 'Map properties' }),
  ).toBeVisible()
  return panel
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
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
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  // The Map has no selection bar of its own (decision 0030): the selection is
  // shown and cleared in Properties.
  await expect(
    page.getByRole('button', { name: /Clear selection$/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Inspect' })).toHaveCount(0)
  const tab = page.getByRole('tab', { name: 'Properties', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(properties(page).locator('header').first()).toContainText(
    'B0001',
  )
  await properties(page)
    .getByRole('button', { name: 'Clear selection from Properties' })
    .click()

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
  // Four stage runs and a 3D render take about 27 s alone; under 4 workers
  // it can pass the default 30 s.
  test.setTimeout(60_000)
  await runStages(page, ['Location setup / footprint capturing'])
  const panel = await openMapProperties(page)

  const toggle = panel.getByRole('checkbox', { name: '3D view' })
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
  // The canvas note is for screen readers only.
  const note = page.getByText('Shift+arrow keys rotate and tilt')
  await expect(note).toHaveCount(1)
  await expect(note).toHaveClass(/visually-hidden/)

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

  // Clearing the selection in Properties brings the map's properties back.
  await panel
    .getByRole('button', { name: 'Clear selection from Properties' })
    .click()
  await openMapProperties(page)
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'The map is shown flat, in 2D.',
  )
  await expect(legend).not.toContainText('Height: floors')
  await expect.poll(() => paintedPixels(silhouette)).toBe(0)
})

// Decision 0015: live terrain for display only; e2e/test.ts serves flat tiles.
test('map shows terrain at true scale and sets exaggeration from the keyboard', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  const panel = await openMapProperties(page)

  // Terrain belongs to the 3D scene (decision 0018), so it is offered there.
  const flat = panel.getByRole('checkbox', { name: 'Terrain (3D only)' })
  await expect(flat).toBeDisabled()
  const view3d = panel.getByRole('checkbox', { name: '3D view' })
  await view3d.focus()
  await page.keyboard.press('Space')

  const toggle = panel.getByRole('checkbox', { name: 'Terrain', exact: true })
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

  const slider = panel.getByRole('slider', { name: 'Terrain exaggeration' })
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
  await expect(panel.getByRole('checkbox', { name: /^Terrain/ })).toBeChecked()

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
  const panel = await openMapProperties(page)
  const view3d = panel.getByRole('checkbox', { name: '3D view' })
  await view3d.focus()
  await page.keyboard.press('Space')
  const toggle = panel.getByRole('checkbox', { name: 'Terrain', exact: true })
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

// Decision 0018: the map's own properties, shown in Properties while the map
// is the surface being worked in and nothing is selected; decision 0030 lists
// its layers, then the basemap and the scene.
test('the map offers its layers, basemap, and scene in Properties when nothing is selected', async ({
  page,
}) => {
  await runStages(page, ['Location setup / footprint capturing'])
  await page.getByRole('tab', { name: 'Properties', exact: true }).click()
  const panel = properties(page)
  await expect(panel.getByText('Nothing selected')).toBeVisible()

  // Working in the map hands Properties to it.
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  await expect(
    panel.getByRole('heading', { name: 'Map properties' }),
  ).toBeVisible()
  // The controls come in this order: layers, then the basemap and its scene.
  const headings = await panel
    .getByRole('heading', { level: 4 })
    .allInnerTexts()
  expect(headings.map((text) => text.trim().toUpperCase())).toEqual([
    'LAYERS',
    'BASEMAP',
    'SUN POSITION',
    'LIGHT AND HAZE',
  ])
  await expect(
    panel.getByRole('grid', { name: 'Map layers, top first' }),
  ).toBeVisible()
  const labels = await panel
    .getByRole('region', { name: 'Basemap' })
    .locator('label, [role="slider"]')
    .evaluateAll((nodes) =>
      nodes.map(
        (node) => node.getAttribute('aria-label') ?? node.textContent ?? '',
      ),
    )
  expect(labels.join(' | ')).toMatch(/OpenFreeMap basemap.*3D view.*Terrain/)
  // The lighting is disclosed as display only, and the sun's own numbers are
  // not shown (decision 0019).
  await expect(panel).toContainText('Simulated')
  await expect(panel).not.toContainText('Elevation')
  await expect(panel).not.toContainText('Azimuth')

  // Haze, intensity, and diffusion open together on demand.
  const haze = panel.getByRole('slider', { name: 'Horizon haze' })
  await expect(haze).toHaveCount(0)
  await panel.getByRole('button', { name: 'Light and haze' }).click()
  await expect(
    panel.getByRole('slider', { name: 'Sun intensity' }),
  ).toBeVisible()
  await expect(
    panel.getByRole('slider', { name: 'Sun diffusion' }),
  ).toBeVisible()
  await haze.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Horizon haze is 25%.',
  )

  // Sun position opens on demand.
  const season = panel.getByRole('slider', { name: 'Season' })
  await expect(season).toHaveCount(0)
  await panel.getByRole('button', { name: 'Sun position' }).click()
  await season.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Map lighting is set to 22 June.',
  )

  // The basemap switch is the same setting as in Settings.
  const basemap = panel.getByRole('checkbox', { name: 'OpenFreeMap basemap' })
  await expect(basemap).toBeChecked()
  await basemap.focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('status-notice')).toContainText(
    'The Map shows footprints on a plain background.',
  )
  await expect(page.locator('.maplibregl-ctrl-attrib')).not.toContainText(
    'OpenFreeMap',
  )
  expect(await seriousViolations(page)).toEqual([])

  // A selection takes Properties back.
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await expect(panel.locator('header').first()).toContainText('B0001')
})

// Decision 0031: the map's layer stack, in its Properties and saved with the
// project.
test('map layers are added, reordered, hidden, styled, and saved with the project', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const panel = await openMapProperties(page)
  const list = panel.getByRole('grid', { name: 'Map layers, top first' })
  const legend = page.getByRole('group', { name: 'Map legend' })
  const rows = list.getByRole('row')
  const titles = async () =>
    (await rows.allInnerTexts()).map((text) => text.split('\n')[0]?.trim())
  await expect(rows).toHaveCount(3)
  expect(await titles()).toEqual(['Grid points', 'Grid lines', 'Buildings'])
  // "Color buildings by" and the grid overlay left the Map's bar.
  await expect(page.getByText('Color buildings by')).toHaveCount(0)
  await expect(
    page.getByRole('checkbox', { name: 'Grid overlay' }),
  ).toHaveCount(0)

  // Add a second building layer and color it by baseline demand.
  await panel.getByRole('button', { name: 'Add layer' }).click()
  await page.getByRole('menuitem', { name: /^Buildings/ }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Added the map layer "Buildings" on top.',
  )
  await expect(rows).toHaveCount(4)
  const settings = panel.getByRole('group', { name: /^Settings of/ })
  const name = settings.getByRole('textbox', { name: 'Layer name' })
  await name.fill('Demand')
  await name.press('Enter')
  await expect(rows.first()).toContainText('Demand')
  // React Aria keeps native inputs visually hidden; use the keyboard.
  await settings.getByRole('radio', { name: 'Baseline demand' }).focus()
  await page.keyboard.press('Space')
  await expect(legend).toContainText('Demand: Baseline demand')
  await expect(legend).toContainText('Buildings: Floors')

  // Move it below the grid with the buttons, then hide the grid lines from
  // their row.
  await panel.getByRole('button', { name: 'Move Demand down' }).click()
  await panel.getByRole('button', { name: 'Move Demand down' }).click()
  expect(await titles()).toEqual([
    'Grid points',
    'Grid lines',
    'Demand',
    'Buildings',
  ])
  await list.getByRole('checkbox', { name: 'Show Grid lines' }).focus()
  await page.keyboard.press('Space')
  await expect(legend).not.toContainText('Grid lines')
  await expect(rows.nth(1)).toContainText('hidden')

  // Rows also move by keyboard drag and drop: Enter on the handle starts at
  // the gap above the row's neighbour, arrows move between gaps, Enter drops.
  await list.getByRole('button', { name: 'Move Buildings' }).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect
    .poll(titles)
    .toEqual(['Grid points', 'Buildings', 'Grid lines', 'Demand'])

  // Extrusion belongs to a building layer and shows in the 3D view.
  await list.getByRole('row', { name: /Demand/ }).click()
  await expect(
    settings.getByRole('checkbox', { name: 'Extrude to height' }),
  ).toBeChecked()
  await expect(settings).toContainText('Extrusion shows in the 3D view')
  expect(await seriousViolations(page)).toEqual([])

  // Saved with the project and restored on reopening.
  await saveAndReopen(page)
  const reopened = await openMapProperties(page)
  const reopenedRows = reopened
    .getByRole('grid', { name: 'Map layers, top first' })
    .getByRole('row')
  await expect(reopenedRows).toHaveCount(4)
  await expect(reopenedRows.nth(3)).toContainText('Demand')
  await expect(reopenedRows.nth(2)).toContainText('hidden')
  await expect(legend).toContainText('Demand: Baseline demand')
})
