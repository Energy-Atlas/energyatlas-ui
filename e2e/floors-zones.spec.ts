import { AxeBuilder } from '@axe-core/playwright'
import { expect, properties, test, type Page } from './test.ts'

// Floors and zones (decision 0032, stage 6): the zoning setting in Geospatial
// preprocessing's Properties, the stage outdated and rerun, floor slabs and
// zones on the map, the floors and zones tables in Properties, a selected
// zone shared with the Table page and the map, the synthetic per-zone split
// on Results, and the viewer showing them without the zoning control.

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

test('zoning outdates preprocessing; a rerun draws slabs and zones shared by Properties, Table, and Map', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

  // The zoning setting is an input of Geospatial preprocessing.
  let panel = await openPreprocessing(page)
  const zoning = panel.getByRole('region', { name: 'Zoning' })
  await expect(zoning).toContainText(
    'The last run zoned by: one zone per building.',
  )
  await expect(
    zoning.getByRole('radio', { name: /One zone per building \(Single\)/ }),
  ).toBeChecked()
  // Nothing changed: Save explains itself instead of doing nothing.
  await zoning.getByRole('button', { name: 'Save zoning' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'The zoning has not been changed.',
  )
  const perimeterCore = zoning.getByRole('radio', {
    name: /Perimeter and core per floor/,
  })
  await perimeterCore.focus()
  await page.keyboard.press('Space')
  await expect(perimeterCore).toBeChecked()
  const depth = zoning.getByRole('textbox', { name: 'Perimeter depth (m)' })
  await expect(depth).toHaveValue('4.5')
  // An empty depth is an error, not a silent default.
  await depth.fill('')
  await depth.press('Tab')
  await expect(zoning).toContainText('Enter a depth from 1 to 15 m.')
  await depth.fill('4.5')
  await depth.press('Tab')
  await expect(zoning).toContainText('Saving makes this stage')
  await zoning.getByRole('button', { name: 'Save zoning' }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Zoning set to perimeter and core per floor, 4.5 m deep',
  )
  await expect(panel.getByText('Outdated').first()).toBeVisible()
  // Later stages are outdated too.
  await expect(
    page
      .getByRole('region', { name: 'Workflow graph' })
      .getByRole('button', { name: /Baseline model setup/ }),
  ).toContainText('Outdated')

  // Before the rerun, a building's zones still follow the last run.
  await selectBuilding(page, 'B0464')
  panel = properties(page)
  const floorsZones = panel.getByTestId('floors-and-zones')
  await expect(floorsZones).toContainText(
    'The zoning setting is now perimeter and core per floor, 4.5 m deep',
  )
  await expect(
    panel.getByRole('grid', { name: 'Zones of Building 464' }),
  ).toContainText('Whole building')

  // Rerun Geospatial preprocessing.
  panel = await openPreprocessing(page)
  await panel
    .getByRole('button', { name: 'Rerun Geospatial preprocessing' })
    .click()
  await expect(panel.getByText('Complete').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(panel.getByRole('region', { name: 'Zoning' })).toContainText(
    'The last run zoned by: perimeter and core per floor, 4.5 m deep.',
  )

  // Properties lists the floors and zones; the core comes first.
  await selectBuilding(page, 'B0464')
  panel = properties(page)
  const floors = panel.getByRole('grid', { name: 'Floors of Building 464' })
  await expect(floors.getByRole('row')).toHaveCount(6)
  const zones = panel.getByRole('grid', { name: 'Zones of Building 464' })
  await expect(zones.getByRole('row').nth(1)).toContainText('Floor 1 core')
  await expect(zones).toContainText('Floor 1 perimeter 1')
  await expect(panel.getByTestId('floors-and-zones')).toContainText(
    '5 floors of 3.2 m',
  )
  await expect(panel).toContainText('Baseline share')

  // The map draws its zones and every other building as slabs.
  await panel
    .getByRole('button', { name: 'Show Building 464 and its zones on the Map' })
    .click()
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Zones of B0464, floor 1')
  await expect(legend).toContainText('Perimeter zones')
  await expect(legend).toContainText('Core')

  // Choosing a zone in Properties selects it.
  const zoneRow = zones.getByRole('row', {
    name: 'Floor 2 perimeter 1 (south)',
  })
  await zoneRow.click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Selected 1 zone(s).',
  )
  await expect(
    panel.getByText(/^Zone B0464:F2:Z2 of building B0464/),
  ).toBeVisible()
  await expect(legend).toContainText('Zones of B0464, floor 2')

  // The Table page shares the selection.
  await panel
    .getByRole('button', { name: 'Show every zone in the Table' })
    .click()
  const table = page.getByRole('region', { name: 'Table' })
  await expect(
    table.getByRole('tab', { name: 'Zones', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  const selectedRow = table.locator('.ag-row-selected [col-id="id"]')
  await expect(selectedRow).toHaveText('B0464:F2:Z2')
  // Adding the next zone by keyboard selects both, everywhere.
  await table.locator('.ag-row-selected [col-id="name"]').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Selected 2 zone(s).',
  )
  await expect(
    panel.getByText('Zone 2 selected of building B0464'),
  ).toBeVisible()

  // In 3D, slabs are a building layer setting, on by default.
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
  await expect(
    panel
      .getByRole('group', { name: /^Settings of/ })
      .getByRole('checkbox', { name: 'Draw floors as slabs' }),
  ).toBeChecked()
  await expect(page.getByRole('group', { name: 'Map legend' })).toContainText(
    'one slab per floor',
  )
  expect(await seriousViolations(page)).toEqual([])

  // A building that cannot be inset falls back, and says why.
  await selectBuilding(page, 'B0002')
  await expect(properties(page).getByTestId('floors-and-zones')).toContainText(
    'fell back to one zone per floor',
  )
  await expect(properties(page).getByTestId('floors-and-zones')).toContainText(
    '(perimeter_inset_failed)',
  )

  // Results split the selected building's demand by zone, labelled synthetic.
  await page.getByRole('main').first().focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Results')
  await page.keyboard.press('Enter')
  const results = page.getByRole('region', { name: 'Results' })
  await results
    .getByRole('button', { name: 'Show results of B0464', exact: true })
    .click()
  await results
    .getByRole('button', {
      name: /Show Building 464 by zone \(synthetic split\)/,
    })
    .click()
  await expect(
    results.getByRole('grid', { name: /of Building 464 by zone/ }),
  ).toContainText('Floor 1 core')
  expect(await seriousViolations(page)).toEqual([])
})

test('states: no heights yet, one zone per building, and a refused zoning on its field', async ({
  page,
}) => {
  await page.goto('/?fixture=partway')
  await selectBuilding(page, 'B0039')
  const floorsZones = properties(page).getByRole('grid', {
    name: 'Zones of Building 39',
  })
  // Partway has preprocessed by RC's default: one zone per building.
  await expect(floorsZones.getByRole('row')).toHaveCount(2)
  await expect(floorsZones).toContainText('Whole building')
  await tab(page, 'Table').click()
  await page.getByRole('tab', { name: 'Floors', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Table' })).toContainText(
    'Every building’s floors',
  )

  // A server refusal lands on its field.
  await page.goto('/?fixture=partway&fault=rejectInput')
  const panel = await openPreprocessing(page)
  const zoning = panel.getByRole('region', { name: 'Zoning' })
  const byFloor = zoning.getByRole('radio', { name: /One zone per floor/ })
  await byFloor.focus()
  await page.keyboard.press('Space')
  await zoning.getByRole('button', { name: 'Save zoning' }).click()
  await expect(zoning).toContainText(
    'The server rejected this value (demo condition: input rejected).',
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

test('the viewer shows floors and zones and leaves the zoning control out', async ({
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
  // shown as handed over: its zoning is a fact, and the form is left out.
  await showTab(page, 'Reasoning')
  const agent = page.getByRole('region', { name: 'Reasoning' })
  await agent
    .getByRole('button', {
      name: 'Start session: Floors and zones of a building',
    })
    .click()
  const transcript = agent.getByRole('log', { name: 'Agent transcript' })
  await expect(transcript).toContainText(
    'zoned one zone per building when the project was handed over',
    { timeout: 20_000 },
  )
  await transcript
    .getByRole('button', {
      name: 'Show the zoning Geospatial preprocessing applied',
    })
    .click()
  const stage = properties(page)
  await expect(
    stage.getByRole('heading', { name: 'Geospatial preprocessing' }),
  ).toBeVisible()
  await expect(stage.getByText('Zoning', { exact: true })).toBeVisible()
  await expect(
    stage.getByText('One zone per building', { exact: true }),
  ).toBeVisible()
  await expect(stage.getByRole('region', { name: 'Zoning' })).toHaveCount(0)
  await expect(stage.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save zoning' })).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
})
