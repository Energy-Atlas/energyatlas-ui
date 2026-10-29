import { AxeBuilder } from '@axe-core/playwright'
import { expect, properties, saveAndReopen, test, type Page } from './test.ts'

// Per-building zoning and 3D zones (decision 0034): a building's own zoning
// in its Properties, outdating Geospatial preprocessing until it runs again;
// the complete fixture's three cases (drawn zones, each floor a zone,
// perimeter and core) shown in 3D; exploded floors saved with the project;
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

test('explodes zoned floors, a building layer setting kept through Save and reopen', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await selectBuilding(page, 'B0427')
  await properties(page)
    .getByRole('button', { name: /^Show the zones of .* in 3D on the Map$/ })
    .click()
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Lines mark zone edges.')
  const explode = properties(page).getByRole('checkbox', {
    name: 'Explode floors in 3D',
  })
  await expect(explode).not.toBeChecked()
  await explode.focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Map layer "Buildings": floors of zoned buildings exploded in 3D.',
  )
  await expect(legend).toContainText('Floors exploded apart')
  await expect(explode).toBeChecked()

  // The same setting is in the map's Properties, on the building layer.
  await properties(page)
    .getByRole('button', { name: 'Clear selection from Properties' })
    .click()
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  const panel = properties(page)
  await expect(
    panel.getByRole('heading', { name: 'Map properties' }),
  ).toBeVisible()
  await panel
    .getByRole('grid', { name: 'Map layers, top first' })
    .getByRole('row', { name: /Buildings/ })
    .click()
  const settings = panel.getByRole('group', { name: /^Settings of/ })
  await expect(
    settings.getByRole('checkbox', { name: 'Explode zoned floors' }),
  ).toBeChecked()

  // Saved with the project's layer stack, like the other layer settings.
  await saveAndReopen(page)
  await selectBuilding(page, 'B0427')
  await expect(
    properties(page).getByRole('checkbox', { name: 'Explode floors in 3D' }),
  ).toBeChecked()
  // The palette closes the storeys again.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Explode zoned floors')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'floors of zoned buildings closed up',
  )
  expect(await seriousViolations(page)).toEqual([])
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
