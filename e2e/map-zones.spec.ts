import { AxeBuilder } from '@axe-core/playwright'
import { expect, properties, test, type Page } from './test.ts'

// Zones on the map (decisions 0034 to 0036): the fixture's zone geometry in
// 3D with envelope edges and zone boundaries, nested selection on the map
// (decision 0035) with hollow floors around a selected floor, the selected
// zone's neighbours keeping their colours, a click picking what is in front,
// and the hover label following keys and Shift.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.nodes.length}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    )
}

const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true })

async function showTab(page: Page, name: string) {
  // Clicking an already selected border tab closes its panel.
  if ((await tab(page, name).getAttribute('aria-selected')) !== 'true')
    await tab(page, name).click()
}

/** Selects buildings from the Table page's search, one at a time with Ctrl for more. */
async function selectBuilding(page: Page, id: string) {
  await tab(page, 'Table').click()
  await page.getByRole('tab', { name: 'Buildings', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search buildings' }).fill(id)
  await expect(page.locator('[row-index="0"] [col-id="id"]')).toHaveText(id)
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await showTab(page, 'Properties')
  await expect(properties(page).getByText(`Building ${id}`)).toBeVisible()
}

/** Turns the map's 3D view on from the map's Properties, with nothing selected. */
async function turn3dOn(page: Page) {
  await tab(page, 'Map').click()
  await page.getByRole('heading', { name: 'Map', exact: true }).click()
  await showTab(page, 'Properties')
  const view3d = properties(page).getByRole('checkbox', { name: '3D view' })
  await view3d.focus()
  await page.keyboard.press('Space')
  await expect(view3d).toBeChecked()
}

/** Selects a building and frames it on the map. */
async function showOnMap(page: Page, id: string) {
  await selectBuilding(page, id)
  await properties(page)
    .getByRole('button', {
      name: `Show Building ${Number(id.slice(1))} and its zones on the Map`,
    })
    .click()
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Zoomed the map to 1 selected building',
  )
}

/** The point of the map the selected building is framed around. */
async function framedPoint(page: Page, tilted = false) {
  const canvas = page
    .locator('canvas.maplibregl-canvas')
    .filter({ visible: true })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The map canvas is not on screen.')
  // map.focusSelection keeps 64 px on the left, 232 px on the right (the
  // legend), and 48 px (120 px at the top when tilted) above and below.
  const top = tilted ? 120 : 48
  return {
    canvas,
    box,
    x: 64 + (box.width - 64 - 232) / 2,
    y: top + (box.height - top - 48) / 2,
  }
}

test('shows each kind of zone geometry in 3D with building edges and lines between zones, and no Show zones in 3D', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await turn3dOn(page)
  const legend = page.getByTestId('zone-legend')
  const cases: [string, string, string][] = [
    ['B0439', 'Drawn zones', '25 zones, zones of its floor plans'],
    ['B0427', 'Whole floors', '9 zones, each floor a zone'],
    ['B0426', 'Perimeter zones', '15 zones, perimeter and core zones'],
  ]
  for (const [id, row, summary] of cases) {
    await showOnMap(page, id)
    await expect(
      properties(page).getByTestId('floors-and-zones'),
    ).toContainText(summary)
    await expect(legend).toContainText(`Zones of ${id}`)
    await expect(legend).toContainText(row)
    // Extruded: zones read apart by lines, not only colour.
    await expect(legend).toContainText('Building edges')
    await expect(legend).toContainText('Lines between zones')
    await expect(legend).not.toContainText(', floor 1')
  }
  // "Show zones in 3D" is retired: neither Properties nor the palette offer it.
  await expect(
    properties(page).getByRole('button', { name: /in 3D on the Map/ }),
  ).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Show zones in 3D')
  await expect(
    page.getByRole('option', { name: /Show zones in 3D/ }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('nested selection on the flat map: a click goes down a level, Escape goes up, and Page Up and Page Down change floor', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  // Flat: the plan of floor 1 is shown, so a click selects floor 1.
  await showOnMap(page, 'B0439')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Zones of B0439, floor 1')
  const notice = page.getByTestId('status-notice')
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

test('in 3D a click on the roof selects the top floor, a floor is solid among hollow floors, and clicks on it select the zone under the pointer (M2)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await turn3dOn(page)
  await showOnMap(page, 'B0439')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Lines between zones')
  await expect(legend).not.toContainText('hollow')
  const notice = page.getByTestId('status-notice')
  const { canvas, x, y } = await framedPoint(page, true)
  // The building is selected: a click on its roof selects the top floor,
  // the storey in front (MapLibre listed the ground floor first).
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText('Selected floor 4 of Building 439.')
  await expect(legend).toContainText('its other floors are drawn hollow.')
  await expect(legend).toContainText('Hollow floors')
  // On the selected floor, clicks select the zone under the pointer, a
  // different zone at a different spot rather than always the first. Spots
  // on the roof are found by the hover label naming a zone of floor 4.
  const picked = new Set<string>()
  const roofZone = page.getByText(/^Floor 4 .+, Building 439$/)
  for (const dy of [0, -20, -40, -60, -80]) {
    for (const dx of [-50, 0, 50]) {
      if (picked.size >= 3) break
      const position = { x: x + dx, y: y + dy }
      await canvas.hover({ position })
      if (!(await roofZone.isVisible())) continue
      const named = (await roofZone.textContent()) ?? ''
      if (picked.has(named)) continue
      await canvas.click({ position })
      await expect(notice).toContainText(
        `Selected zone ${named.replace(', Building 439', '')} of Building 439.`,
      )
      picked.add(named)
      // Back to the floor for the next click.
      await canvas.focus()
      await page.keyboard.press('Escape')
      await expect(notice).toContainText(/Selected floor 4 of Building 439\./)
    }
  }
  expect(picked.size).toBeGreaterThan(1)
  expect([...picked].every((name) => name.startsWith('Floor 4'))).toBe(true)
  // A selected zone keeps its colour among its neighbours; the legend says
  // the selection outlines it.
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(
    /Selected zone Floor 4 .+ of Building 439\./,
  )
  await expect(legend).toContainText('Zone on floor 4 of B0439 selected')
  await expect(legend).toContainText('Selected floor or zone, outlined')
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

test('the hover label follows Page Up, Page Down, and Shift without a pointer move; Shift-click adds a zone; keys that change nothing say why', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await showOnMap(page, 'B0439')
  const notice = page.getByTestId('status-notice')
  const { canvas, x, y } = await framedPoint(page)
  await canvas.hover({ position: { x, y } })
  const floorLabel = page.getByText('Floor 1 of Building 439', { exact: true })
  await expect(floorLabel).toBeVisible()
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 floor\(s\)|floor 1 of)/)
  // Without moving, the label now names the zone a click would select.
  await expect(floorLabel).toBeHidden()
  const onFloor = (floor: number) =>
    page.getByText(new RegExp(`^Floor ${floor} .+, Building 439$`))
  await expect(onFloor(1)).toBeVisible()
  // Page Up shows floor 2's plan: the label names its zone under the
  // pointer, not floor 1's (decision 0036).
  await canvas.focus()
  await page.keyboard.press('PageUp')
  await expect(
    properties(page).getByText(/^Floor B0439:F2 of building B0439/),
  ).toBeVisible()
  await expect(onFloor(2)).toBeVisible()
  await expect(onFloor(1)).toBeHidden()
  await page.keyboard.press('PageDown')
  await expect(onFloor(1)).toBeVisible()
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 zone\(s\)|zone .+ of)/)

  // Find another zone of the floor: with Shift held, its label adds it.
  // (The label follows the Shift key itself, so it is held, not passed as
  // a modifier of each move, which releases it after the move.)
  const adds = page.getByText(/, Building 439 and 1 more$/)
  let spot: { x: number; y: number } | null = null
  await page.keyboard.down('Shift')
  for (const dx of [-120, 120, -80, 80, -40, 40, 0]) {
    for (const dy of [0, -60, 60, -30, 30]) {
      if (dx === 0 && dy === 0) continue
      const position = { x: x + dx, y: y + dy }
      await canvas.hover({ position })
      if (await adds.isVisible()) {
        spot = position
        break
      }
    }
    if (spot) break
  }
  await page.keyboard.up('Shift')
  if (!spot) throw new Error('No other zone of floor 1 was found on screen.')
  // Releasing Shift without a move: the label is a plain click's again.
  await canvas.hover({ position: spot })
  await page.keyboard.down('Shift')
  await expect(adds).toBeVisible()
  await page.keyboard.up('Shift')
  await expect(adds).toBeHidden()
  await expect(onFloor(1)).toBeVisible()
  // Shift-clicks reach the selection (box zoom is off).
  await page.keyboard.down('Shift')
  await canvas.click({ position: spot })
  await expect(notice).toContainText('Selected 2 zone(s).')
  await expect(
    page.getByText(/^Remove .+, Building 439 from the selection$/),
  ).toBeVisible()
  await canvas.click({ position: spot })
  await page.keyboard.up('Shift')
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
  await turn3dOn(page)
  await showOnMap(page, 'B0464')
  const notice = page.getByTestId('status-notice')
  const legend = page.getByTestId('zone-legend')
  await expect(legend).toContainText('Whole building')
  await expect(legend).not.toContainText('Zone geometry')
  const { canvas, x, y } = await framedPoint(page, true)
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 floor\(s\)|floor \d+ of)/)
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(/Selected (1 zone\(s\)|zone .+ of)/)
  await expect(
    properties(page).getByText(/^Zone B0464:Z1 of building B0464/),
  ).toBeVisible()
  await expect(legend).toContainText(
    'Whole-building zone of B0464 selected, on every floor.',
  )
  await expect(legend).not.toContainText('Hollow floors')
  // Nothing is smaller than the whole building: a click and the keys say so.
  await canvas.click({ position: { x, y } })
  await expect(notice).toContainText(
    /spans all of Building 464, so there is no smaller zone to select/,
  )
  await canvas.focus()
  await page.keyboard.press('PageUp')
  await expect(notice).toContainText(/spans every floor of Building 464/)
  await page.keyboard.press('Escape')
  await expect(notice).toContainText('Selected 1 building(s).')
})
