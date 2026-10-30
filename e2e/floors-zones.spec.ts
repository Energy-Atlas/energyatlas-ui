import { AxeBuilder } from '@axe-core/playwright'
import { expect, properties, test, type Page } from './test.ts'

// Floors and zones (decision 0032, stage 6; decision 0036): zones are the
// backend's geometry, shown in Geospatial preprocessing's Properties as where
// zones come from, the floors and zones tables in Properties, a selected
// zone shared with the Table page and the map, no floor slabs and no
// per-zone results, and the viewer showing them.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true })

async function showTab(page: Page, name: string) {
  // Clicking an already selected border tab closes its panel.
  if ((await tab(page, name).getAttribute('aria-selected')) !== 'true')
    await tab(page, name).click()
}

/** Shows Geospatial preprocessing in Properties from the Roadmap. */
async function openPreprocessing(page: Page) {
  await tab(page, 'Roadmap').click()
  const stage = page
    .getByRole('region', { name: 'Workflow graph' })
    .getByRole('button', { name: /Geospatial preprocessing/ })
  await stage.focus()
  await page.keyboard.press('Enter')
  await showTab(page, 'Properties')
  const panel = properties(page)
  await expect(
    panel.getByRole('heading', { name: 'Geospatial preprocessing' }),
  ).toBeVisible()
  return panel
}

/** Selects one building from the Table page's search. */
async function selectBuilding(page: Page, id: string) {
  await tab(page, 'Table').click()
  await page.getByRole('tab', { name: 'Buildings', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search buildings' }).fill(id)
  await expect(page.locator('[row-index="0"] [col-id="id"]')).toHaveText(id)
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await showTab(page, 'Properties')
  await expect(properties(page).getByText(`Building ${id}`)).toBeVisible()
}

test('zones are the backend’s geometry: Properties, Table, and Map share them, with no zoning control, slabs, or per-zone results', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

  // Geospatial preprocessing says where zones come from and offers no setting.
  let panel = await openPreprocessing(page)
  await expect(panel.getByTestId('zone-geometry-note')).toContainText(
    'Zoning is done by the backend: the browser shows the zone geometry it delivers and never zones a building itself. 3 buildings have zone geometry (B0439, B0427, B0426); every other building is one zone, as in RC.',
  )
  await expect(panel.getByRole('region', { name: 'Zoning' })).toHaveCount(0)
  await expect(panel.getByRole('radio')).toHaveCount(0)
  await expect(
    panel.getByRole('textbox', { name: /Perimeter depth/ }),
  ).toHaveCount(0)

  // Properties lists the floors and zones of a building with zone geometry,
  // and offers no zoning control.
  await selectBuilding(page, 'B0426')
  panel = properties(page)
  const floorsZones = panel.getByTestId('floors-and-zones')
  await expect(floorsZones).toContainText(
    "3 floors of 3.2 m (height over storeys); 15 zones, perimeter and core zones on each floor, from the backend's zone geometry. Zones are display only.",
  )
  await expect(floorsZones).toContainText('Zone geometry: Synthetic zone')
  await expect(
    panel.getByRole('region', { name: 'Zoning of this building' }),
  ).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: /in 3D on the Map/ }),
  ).toHaveCount(0)
  const floors = panel.getByRole('grid', { name: 'Floors of Building 426' })
  await expect(floors.getByRole('row')).toHaveCount(4)
  const zones = panel.getByRole('grid', { name: 'Zones of Building 426' })
  await expect(zones.getByRole('row').nth(1)).toContainText('Floor 1 core')
  await expect(zones).toContainText('Floor 1 perimeter 1 (north)')
  await expect(panel).not.toContainText('Baseline share')

  // The map draws its zones.
  await panel
    .getByRole('button', { name: 'Show Building 426 and its zones on the Map' })
    .click()
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Zones of B0426, floor 1')
  await expect(legend).toContainText(
    'Zone geometry: precomputed in the fixture',
  )
  await expect(legend).toContainText('Perimeter zones')
  await expect(legend).toContainText('Core')

  // Choosing a zone in Properties selects it.
  await zones.getByRole('row', { name: 'Floor 2 perimeter 1 (north)' }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Selected zone Floor 2 perimeter 1 (north) of Building 426.',
  )
  await expect(
    panel.getByText(/^Zone B0426:F2:Z2 of building B0426/),
  ).toBeVisible()
  await expect(legend).toContainText('Zones of B0426, floor 2')

  // The Table page shares the selection.
  await panel
    .getByRole('button', { name: 'Show every zone in the Table' })
    .click()
  const table = page.getByRole('region', { name: 'Table' })
  await expect(
    table.getByRole('tab', { name: 'Zones', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(table).toContainText(
    '3 buildings zoned by their zone geometry, the rest one zone each',
  )
  const selectedRow = table.locator('.ag-row-selected [col-id="id"]')
  await expect(selectedRow).toHaveText('B0426:F2:Z2')
  // Adding the next zone by keyboard selects both, everywhere.
  await table.locator('.ag-row-selected [col-id="name"]').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Selected 2 zone(s).',
  )

  // In 3D, buildings are no longer drawn as floor slabs.
  await panel
    .getByRole('button', { name: 'Clear selection from Properties' })
    .click()
  await tab(page, 'Map').click()
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  await expect(
    panel.getByRole('heading', { name: 'Map properties' }),
  ).toBeVisible()
  const view3d = panel.getByRole('checkbox', { name: '3D view' })
  await view3d.focus()
  await page.keyboard.press('Space')
  await panel
    .getByRole('grid', { name: 'Map layers, top first' })
    .getByRole('row', { name: /Buildings/ })
    .click()
  const settings = panel.getByRole('group', { name: /^Settings of/ })
  await expect(
    settings.getByRole('checkbox', { name: 'Extrude to height' }),
  ).toBeChecked()
  await expect(
    settings.getByRole('checkbox', { name: 'Draw floors as slabs' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('group', { name: 'Map legend' }),
  ).not.toContainText('slab')
  expect(await seriousViolations(page)).toEqual([])

  // Results show no per-zone split.
  await page.getByRole('main').first().focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Results')
  await page.keyboard.press('Enter')
  const results = page.getByRole('region', { name: 'Results' })
  await results
    .getByRole('button', { name: 'Show results of B0464', exact: true })
    .click()
  await expect(results).toContainText('Building 464')
  await expect(results.getByRole('button', { name: /by zone/ })).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
})

test('states: no heights yet, and one zone for a building without zone geometry', async ({
  page,
}) => {
  // Two fixtures and a Location setup run: close to the default 30 s alone.
  test.setTimeout(90_000)
  await page.goto('/?fixture=partway')
  await selectBuilding(page, 'B0039')
  const floorsZones = properties(page).getByRole('grid', {
    name: 'Zones of Building 39',
  })
  // Without zone geometry from the backend, a building is one zone.
  await expect(floorsZones.getByRole('row')).toHaveCount(2)
  await expect(floorsZones).toContainText('Whole building')
  await expect(properties(page).getByTestId('floors-and-zones')).toContainText(
    'with no zone geometry from the backend',
  )
  await tab(page, 'Table').click()
  await page.getByRole('tab', { name: 'Floors', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Table' })).toContainText(
    'Every building’s floors',
  )

  // Footprints without heights: no floors or zones yet, and why.
  await page.goto('/?fixture=new')
  await tab(page, 'Roadmap').click()
  const location = page
    .getByRole('region', { name: 'Workflow graph' })
    .getByRole('button', { name: /Location setup/ })
  await location.focus()
  await page.keyboard.press('Enter')
  await showTab(page, 'Properties')
  await properties(page)
    .getByRole('button', { name: /^Run Location setup/ })
    .click()
  await expect(location).toContainText('Complete', { timeout: 15_000 })
  await selectBuilding(page, 'B0039')
  await expect(properties(page)).toContainText(
    'Floors and zones appear once “Geospatial preprocessing” has computed this building’s height from its floor count.',
  )
  await tab(page, 'Table').click()
  await page.getByRole('tab', { name: 'Zones', exact: true }).click()
  await expect(page.getByText('No zones yet')).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('the viewer shows floors and zones, and where they come from', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  // A handover packages the saved copy (decision 0032).
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('Saved')
  const file = page
    .getByRole('toolbar', { name: 'Workbench commands' })
    .getByRole('button', { name: 'File', exact: true })
  await file.click()
  await page.getByRole('menuitem', { name: 'Hand over…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hand over this project' })
  await dialog.getByRole('button', { name: 'Hand over the project' }).click()
  await expect(page.getByRole('dialog', { name: 'Handed over' })).toBeVisible()

  await page.goto('/viewer.html')
  const option = page
    .getByRole('listbox', { name: 'Handover packages' })
    .getByRole('option', { name: /Synthetic district/ })
  await option.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('View only').first()).toBeVisible()

  await selectBuilding(page, 'B0464')
  const panel = properties(page)
  await expect(
    panel.getByRole('grid', { name: 'Zones of Building 464' }),
  ).toContainText('Whole building')
  await panel
    .getByRole('grid', { name: 'Floors of Building 464' })
    .getByRole('row')
    .nth(3)
    .click()
  await expect(
    panel.getByText(/^Floor B0464:F3 of building B0464/),
  ).toBeVisible()
  await panel
    .getByRole('button', { name: 'Show every floor in the Table' })
    .click()
  await expect(
    page.locator('.ag-row-selected [col-id="id"]').filter({ visible: true }),
  ).toHaveText('B0464:F3')

  // The map draws the floor's building in zones.
  await tab(page, 'Map').click()
  await expect(page.getByTestId('zone-legend')).toContainText(
    'Zones of B0464, floor 3',
  )
  await expect(page.getByTestId('zone-legend')).toContainText('Whole building')

  // The agent's floors-and-zones session leads to Geospatial preprocessing,
  // shown as handed over: where zones come from is a fact.
  await showTab(page, 'Reasoning')
  const agent = page.getByRole('region', { name: 'Reasoning' })
  await agent
    .getByRole('button', {
      name: 'Start session: Floors and zones of a building',
    })
    .click()
  const transcript = agent.getByRole('log', { name: 'Agent transcript' })
  await expect(transcript).toContainText('Zoning is done by the backend', {
    timeout: 20_000,
  })
  await transcript
    .getByRole('button', { name: 'Show where the zones come from' })
    .click()
  const stage = properties(page)
  await expect(
    stage.getByRole('heading', { name: 'Geospatial preprocessing' }),
  ).toBeVisible()
  await expect(stage.getByText('Zones', { exact: true })).toBeVisible()
  await expect(
    stage.getByText(
      '3 buildings with zone geometry from the backend (synthetic); the rest one zone each',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(stage.getByRole('region', { name: 'Zoning' })).toHaveCount(0)
  await expect(stage.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save zoning' })).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
})
