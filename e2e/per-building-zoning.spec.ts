import { AxeBuilder } from '@axe-core/playwright'
import { expect, properties, test, type Page } from './test.ts'

// Per-building zoning and 3D zones (decision 0034): a building's own zoning
// in its Properties, outdating Geospatial preprocessing until it runs again;
// the complete fixture's three cases (drawn zones, each floor a zone,
// perimeter and core) shown in 3D; nested selection on the map and hollow
// floors around a selected floor (decision 0035);
// a drawn-zones fallback explained; and the viewer showing the zoning
// read-only.

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

/** Reruns Geospatial preprocessing from its Properties. */
async function rerunPreprocessing(page: Page) {
  await tab(page, 'Roadmap').click()
  const stage = page
    .getByRole('region', { name: 'Workflow graph' })
    .getByRole('button', { name: /Geospatial preprocessing/ })
  await stage.focus()
  await page.keyboard.press('Enter')
  await showTab(page, 'Properties')
  const panel = properties(page)
  await panel
    .getByRole('button', { name: 'Rerun Geospatial preprocessing' })
    .click()
  await expect(panel.getByText('Complete').first()).toBeVisible({
    timeout: 30_000,
  })
}

const zoningForm = (page: Page) =>
  properties(page).getByRole('region', { name: 'Zoning of this building' })

async function choose(page: Page, name: string) {
  // React Aria hides the real radio input: focus it and press Space.
  const radio = zoningForm(page).getByRole('radio', { name, exact: true })
  await radio.focus()
  await page.keyboard.press('Space')
  await expect(radio).toBeChecked()
}

test('a building override outdates preprocessing; a rerun zones it its own way in Properties and the Table', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

  await selectBuilding(page, 'B0464')
  const form = zoningForm(page)
  await expect(form).toContainText(
    'The last run zoned it by one zone (project default).',
  )
  await expect(
    form.getByRole('radio', {
      name: 'Project default (One zone per building)',
    }),
  ).toBeChecked()
  // Nothing changed: Save explains itself instead of doing nothing.
  const save = form.getByRole('button', { name: 'Save zoning of Building 464' })
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'The building’s zoning has not been changed.',
  )

  await choose(page, 'Each floor a zone')
  await expect(form).toContainText(
    'Saving zones it by each floor a zone and makes Geospatial preprocessing and every later stage outdated',
  )
  await save.click()
  await expect(page.getByTestId('status-notice')).toContainText(
    "Building 464 (B0464) is zoned by each floor a zone, overriding the project's one zone per building.",
  )
  const floorsZones = properties(page).getByTestId('floors-and-zones')
  await expect(floorsZones).toContainText(
    'This building\'s zoning is now each floor a zone (building override); "Geospatial preprocessing" has not applied it yet.',
  )
  // Until the rerun its zones follow the last run.
  await expect(
    properties(page).getByRole('grid', { name: 'Zones of Building 464' }),
  ).toContainText('Whole building')
  await tab(page, 'Roadmap').click()
  await expect(
    page
      .getByRole('region', { name: 'Workflow graph' })
      .getByRole('button', { name: /Geospatial preprocessing/ }),
  ).toContainText('Outdated')

  // The Buildings view shows the setting and that it is an override.
  await tab(page, 'Table').click()
  await expect(page.locator('[row-index="0"] [col-id="zoning"]')).toHaveText(
    'Each floor a zone',
  )
  await expect(
    page.locator('[row-index="0"] [col-id="zoningSource"]'),
  ).toHaveText('Building override')

  await rerunPreprocessing(page)
  await selectBuilding(page, 'B0464')
  const zones = properties(page).getByRole('grid', {
    name: 'Zones of Building 464',
  })
  // Five floors, a zone each, plus the header row.
  await expect(zones.getByRole('row')).toHaveCount(6)
  await expect(zones.getByRole('row').nth(1)).toContainText('Floor 1')
  await expect(zoningForm(page)).toContainText(
    'The last run zoned it by each floor a zone (building override).',
  )
  // The Zones view names how each building was zoned, and by whom.
  await properties(page)
    .getByRole('button', { name: 'Show every zone in the Table' })
    .click()
  const table = page.getByRole('region', { name: 'Table' })
  await expect(
    table.getByRole('tab', { name: 'Zones', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(table).toContainText('4 buildings zoned their own way')
  expect(await seriousViolations(page)).toEqual([])
})

test('shows each fixture case in 3D: drawn zones, each floor a zone, and perimeter and core', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  const legend = page.getByTestId('zone-legend')
  const cases: [string, string, string][] = [
    ['B0439', 'Drawn zones (synthetic)', 'drawn zones (building override)'],
    ['B0427', 'Whole floors', 'each floor a zone (building override)'],
    [
      'B0426',
      'Perimeter zones',
      'perimeter and core per floor, 4.5 m deep (building override)',
    ],
  ]
  for (const [id, row, summary] of cases) {
    await selectBuilding(page, id)
    await expect(
      properties(page).getByTestId('floors-and-zones'),
    ).toContainText(summary)
    await properties(page)
      .getByRole('button', {
        name: `Show the zones of Building ${Number(id.slice(1))} in 3D on the Map`,
      })
      .click()
    await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true')
    await expect(legend).toContainText(`Zones of ${id}`)
    await expect(legend).toContainText(row)
    // Extruded: zones read apart by drawn edges, not only colour.
    await expect(legend).toContainText('Lines mark zone edges.')
    await expect(legend).not.toContainText(', floor 1')
  }
  // The drawn building lists its drawn zones by use.
  await selectBuilding(page, 'B0439')
  const zones = properties(page).getByRole('grid', {
    name: 'Zones of Building 439',
  })
  await expect(zones).toContainText('Floor 1 lobby')
  await expect(zones).toContainText('Drawn: retail')
  await expect(zoningForm(page)).toContainText(
    'Drawn zones: Synthetic floor plan, hand-authored for this demo',
  )
  await expect(zoningForm(page)).toContainText('editing them is deferred')

  // The palette shows the selection's zones in 3D too.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Show zones in 3D')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Zoomed the map to 1 selected building(s).',
  )
  expect(await seriousViolations(page)).toEqual([])
})

/** The point of the map the selected building is framed around. */
async function framedPoint(page: Page) {
  const canvas = page
    .locator('canvas.maplibregl-canvas')
    .filter({ visible: true })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The map canvas is not on screen.')
  // map.focusSelection keeps 64 px on the left, 232 px on the right (the
  // legend), and 48 px (120 px at the top when tilted) above and below.
  const top = 48
  return {
    canvas,
    x: 64 + (box.width - 64 - 232) / 2,
    y: top + (box.height - top - 48) / 2,
  }
}

test('nested selection on the map: a click goes down a level, Escape goes up, and Page Up and Page Down change floor', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0439')
  // Flat: the plan of floor 1 is shown, so a click selects floor 1.
  await properties(page)
    .getByRole('button', { name: 'Show Building 439 and its zones on the Map' })
    .click()
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Zones of B0439, floor 1')
  const notice = page.getByTestId('status-notice')
  await expect(notice).toContainText('Zoomed the map to 1 selected building')
  const { canvas, x, y } = await framedPoint(page)
  // The hover label names what a click would select at this level.
  await canvas.hover({ position: { x, y } })
  await expect(
    page.getByText('Floor 1 of Building 439', { exact: true }),
  ).toBeVisible()
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText('Selected floor 1 of Building 439.')
  await expect(
    properties(page).getByText(/^Floor B0439:F1 of building B0439/),
  ).toBeVisible()
  await expect(legend).toContainText('Floor 1 of B0439 selected.')
  // On the selected floor, a click selects the zone under the pointer.
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected zone .+ of Building 439\./)
  await expect(
    properties(page).getByText(/^Zone B0439:F1:Z\d of building B0439/),
  ).toBeVisible()

  // The keyboard: Page Up and Page Down move between floors.
  await canvas.focus()
  await page.keyboard.press('PageUp')
  await expect(
    properties(page).getByText(/^Floor B0439:F2 of building B0439/),
  ).toBeVisible()
  await expect(legend).toContainText('Zones of B0439, floor 2')
  await page.keyboard.press('PageDown')
  await expect(
    properties(page).getByText(/^Floor B0439:F1 of building B0439/),
  ).toBeVisible()
  // Escape goes up a level: floor to building, building to nothing.
  await page.keyboard.press('Escape')
  await expect(notice).toContainText('Selected 1 building(s).')
  await expect(properties(page).getByText('Building B0439')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(notice).toContainText('Selection cleared.')
  expect(await seriousViolations(page)).toEqual([])
})

test('in 3D a selected floor is solid among hollow floors, and a click on it selects a zone', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0439')
  await properties(page)
    .getByRole('button', {
      name: 'Show the zones of Building 439 in 3D on the Map',
    })
    .click()
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Lines mark zone edges.')
  await expect(legend).not.toContainText('hollow')
  const notice = page.getByTestId('status-notice')
  await expect(notice).toContainText('Zoomed the map to 1 selected building')
  const canvas = page
    .locator('canvas.maplibregl-canvas')
    .filter({ visible: true })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The map canvas is not on screen.')
  const point = {
    x: 64 + (box.width - 64 - 232) / 2,
    y: 120 + (box.height - 120 - 48) / 2,
  }
  // The building is selected: a click selects the storey hit.
  await canvas.click({ position: point })
  await expect(notice).toContainText(/Selected floor \d+ of Building 439\./)
  await expect(
    properties(page).getByText(/^Floor B0439:F\d of building B0439/),
  ).toBeVisible()
  await expect(legend).toContainText('its other floors are drawn hollow.')
  await expect(legend).toContainText('Hollow floors')
  // The same spot is now on the selected floor: a click selects a zone.
  await canvas.click({ position: point })
  await expect(notice).toContainText(/Selected zone .+ of Building 439\./)
  await expect(
    properties(page).getByText(/^Zone B0439:F\d:Z\d of building B0439/),
  ).toBeVisible()
  await expect(legend).toContainText('Zone on floor')
  // Properties still selects a floor directly.
  await selectBuilding(page, 'B0439')
  await properties(page)
    .getByRole('grid', { name: 'Floors of Building 439' })
    .getByRole('row')
    .nth(3)
    .click()
  await expect(
    properties(page).getByText(/^Floor B0439:F3 of building B0439/),
  ).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('Shift-click adds a zone on the map, the hover label follows the selection, and keys that change nothing say why', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0439')
  await properties(page)
    .getByRole('button', { name: 'Show Building 439 and its zones on the Map' })
    .click()
  const notice = page.getByTestId('status-notice')
  await expect(notice).toContainText('Zoomed the map to 1 selected building')
  const { canvas, x, y } = await framedPoint(page)
  await canvas.hover({ position: { x, y } })
  const floorLabel = page.getByText('Floor 1 of Building 439', { exact: true })
  await expect(floorLabel).toBeVisible()
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 floor\(s\)|floor 1 of)/)
  // Without moving, the label now names the zone a click would select.
  await expect(floorLabel).toBeHidden()
  await expect(page.getByText(/^.+, Building 439$/)).toBeVisible()
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 zone\(s\)|zone .+ of)/)

  // Find another zone of the floor: with Shift held, its label adds it.
  const adds = page.getByText(/, Building 439 and 1 more$/)
  let spot: { x: number; y: number } | null = null
  for (const dx of [-120, 120, -80, 80, -40, 40, 0]) {
    for (const dy of [0, -60, 60, -30, 30]) {
      if (dx === 0 && dy === 0) continue
      const position = { x: x + dx, y: y + dy }
      await canvas.hover({ position, modifiers: ['Shift'] })
      if (await adds.isVisible()) {
        spot = position
        break
      }
    }
    if (spot) break
  }
  if (!spot) throw new Error('No other zone of floor 1 was found on screen.')
  // Shift-clicks reach the selection (box zoom is off).
  await canvas.click({ position: spot, modifiers: ['Shift'] })
  await expect(notice).toContainText('Selected 2 zone(s).')
  await expect(
    page.getByText(/^Remove .+, Building 439 from the selection$/),
  ).toBeVisible()
  await canvas.click({ position: spot, modifiers: ['Shift'] })
  await expect(notice).toContainText(/Selected (1 zone\(s\)|zone .+ of)/)

  // Page Up stops at the top floor and says so.
  await canvas.focus()
  await page.keyboard.press('Escape')
  await expect(notice).toContainText(/Selected (1 floor\(s\)|floor 1 of)/)
  for (const floor of [2, 3, 4]) {
    await page.keyboard.press('PageUp')
    await expect(
      properties(page).getByText(
        new RegExp(`^Floor B0439:F${floor} of building B0439`),
      ),
    ).toBeVisible()
  }
  await page.keyboard.press('PageUp')
  await expect(notice).toContainText(
    'Floor 4 is the top floor of Building 439.',
  )
  // A building has no floor to step from.
  await page.keyboard.press('Escape')
  await expect(notice).toContainText('Selected 1 building(s).')
  await page.keyboard.press('PageDown')
  await expect(notice).toContainText(
    'Select a floor first: click the selected building, or choose one in its Floors table.',
  )
})

test('a selected whole-building zone is highlighted on every storey in 3D, and clicks and keys that cannot go further say so', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0464')
  await properties(page)
    .getByRole('button', {
      name: 'Show the zones of Building 464 in 3D on the Map',
    })
    .click()
  const notice = page.getByTestId('status-notice')
  await expect(notice).toContainText('Zoomed the map to 1 selected building')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Whole building')
  const canvas = page
    .locator('canvas.maplibregl-canvas')
    .filter({ visible: true })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The map canvas is not on screen.')
  const point = {
    x: 64 + (box.width - 64 - 232) / 2,
    y: 120 + (box.height - 120 - 48) / 2,
  }
  await canvas.click({ position: point })
  await expect(notice).toContainText(/Selected (1 floor\(s\)|floor \d+ of)/)
  await canvas.click({ position: point })
  await expect(notice).toContainText(/Selected (1 zone\(s\)|zone .+ of)/)
  await expect(
    properties(page).getByText(/^Zone B0464:Z1 of building B0464/),
  ).toBeVisible()
  await expect(legend).toContainText(
    'Whole-building zone of B0464 selected, on every floor.',
  )
  await expect(legend).not.toContainText('Hollow floors')
  // Nothing is smaller than the whole building: a click and the keys say so.
  await canvas.click({ position: point })
  await expect(notice).toContainText(
    /spans all of Building 464, so there is no smaller zone to select/,
  )
  await canvas.focus()
  await page.keyboard.press('PageUp')
  await expect(notice).toContainText(/spans every floor of Building 464/)
  await page.keyboard.press('Escape')
  await expect(notice).toContainText('Selected 1 building(s).')
})

test('states: a drawn-zones fallback explained before and after the rerun, and a refusal on its field', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0039')
  await choose(page, 'Drawn zones')
  const form = zoningForm(page)
  await expect(form).toContainText(
    'This building has no drawn zones, so drawn zoning gives it one zone per floor.',
  )
  await expect(form).toContainText(
    'Expect a fallback when the stage runs: Drawn zones fell back to one zone per floor: this building has no drawn zones. (drawn_zones_missing)',
  )
  await form.getByRole('button', { name: 'Save zoning of Building 39' }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    '(drawn_zones_missing)',
  )
  await rerunPreprocessing(page)
  await selectBuilding(page, 'B0039')
  const floorsZones = properties(page).getByTestId('floors-and-zones')
  await expect(floorsZones).toContainText(
    'each floor a zone, falling back from drawn zones (building override)',
  )
  await expect(floorsZones).toContainText(
    'Drawn zones fell back to one zone per floor: this building has no drawn zones. (drawn_zones_missing)',
  )
  expect(await seriousViolations(page)).toEqual([])

  // A server refusal lands on its field.
  await page.goto('/?fixture=complete&fault=rejectInput')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0464')
  await choose(page, 'One zone')
  await zoningForm(page)
    .getByRole('button', { name: 'Save zoning of Building 464' })
    .click()
  await expect(zoningForm(page)).toContainText(
    'The server rejected this value (demo condition: input rejected).',
  )
})

test('the viewer shows a building’s zoning read-only and its zones in 3D', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('Saved')
  await page
    .getByRole('toolbar', { name: 'Workbench commands' })
    .getByRole('button', { name: 'File', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Hand over…' }).click()
  await page
    .getByRole('dialog', { name: 'Hand over this project' })
    .getByRole('button', { name: 'Hand over the project' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Handed over' })).toBeVisible()

  await page.goto('/viewer.html')
  const option = page
    .getByRole('listbox', { name: 'Handover packages' })
    .getByRole('option', { name: /Synthetic district/ })
  await option.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('View only').first()).toBeVisible()

  await selectBuilding(page, 'B0439')
  const panel = properties(page)
  const facts = panel
    .getByRole('definition')
    .filter({ hasText: 'Drawn zones,' })
  await expect(facts).toHaveText('Drawn zones, building override')
  await expect(panel).toContainText('3 drawn plans, 25 zones over its floors')
  await expect(panel.getByRole('radio')).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: /^Save zoning of/ }),
  ).toHaveCount(0)
  // Showing zones in 3D is a view change, so the viewer offers it.
  await panel
    .getByRole('button', {
      name: 'Show the zones of Building 439 in 3D on the Map',
    })
    .click()
  await expect(page.getByTestId('zone-legend')).toContainText(
    'Drawn zones (synthetic)',
  )
  await expect(page.getByTestId('zone-legend')).toContainText(
    'Lines mark zone edges.',
  )
  expect(await seriousViolations(page)).toEqual([])
})
