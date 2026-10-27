import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Shared data tables (decision 0027, step 2): table and column widgets on a
// real page, settings kept per user in this browser, and the CSV of the view.

async function openResults(page: Page) {
  await page.goto('/?fixture=complete')
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await page
    .getByRole('region', { name: 'Workflow' })
    .getByRole('button', {
      name: 'Open Results to drill into published results',
    })
    .click()
  const results = page.getByRole('region', { name: 'Results', exact: true })
  await expect(results).toBeVisible()
  return results.locator('[data-table-id="results.buildings"]')
}

test('filters, sorts, hides, and formats a table, and keeps it in this browser', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const table = await openResults(page)
  const grid = table.getByRole('grid', { name: 'Building results' })
  const total = await table.locator('tbody tr').count()
  expect(total).toBeGreaterThan(0)

  // Tools appear on hover and stay hidden otherwise.
  const columnsTool = table.getByRole('button', { name: /^Columns of/ })
  await page.mouse.move(0, 0)
  await expect(columnsTool).toHaveCSS('opacity', '0')
  await grid.hover()
  await expect(columnsTool).toHaveCSS('opacity', '1')

  // A checklist filter on Use.
  await grid
    .getByRole('columnheader', { name: /^Use/ })
    .getByRole('button', { name: /^Filter and sort Use/ })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Filter and sort: Use' })
  const values = dialog.getByRole('group', { name: /Show rows where Use is/ })
  const first = values.getByRole('checkbox').first()
  await first.focus()
  await page.keyboard.press('Space')
  await dialog.getByRole('button', { name: 'Apply filter' }).click()
  await page.keyboard.press('Escape')
  await expect(table.getByText(/^\d+ of \d+ rows$/)).toBeVisible()
  await expect(
    table.getByRole('button', { name: /^Remove filter: Use is/ }),
  ).toBeVisible()
  // The filter's icon stays visible once the pointer leaves.
  await page.mouse.move(0, 0)
  await expect(
    table.getByRole('button', { name: 'Filter and sort Use (filtered)' }),
  ).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Filtered "Building results": Use is',
  )

  // Sort by annual demand, ascending, from the column header.
  const annual = grid.getByRole('columnheader', { name: /^Annual demand/ })
  await annual.getByText('Annual demand (kWh)').click()
  await expect(annual).toHaveAttribute('aria-sort', 'ascending')

  // Show annual demand in MWh.
  await annual.getByRole('button', { name: 'Format Annual demand' }).click()
  await page
    .getByRole('dialog', { name: 'Format: Annual demand' })
    .getByRole('radio', { name: 'MWh' })
    .click()
  await page.keyboard.press('Escape')
  await expect(annual).toContainText('Annual demand (MWh)')
  // A range is entered in the unit shown and kept in the column's own unit.
  await annual
    .getByRole('button', { name: /^Filter and sort Annual demand/ })
    .click()
  const range = page.getByRole('dialog', {
    name: 'Filter and sort: Annual demand',
  })
  await range.getByLabel('At least (MWh)').fill('1')
  await range.getByRole('button', { name: 'Apply filter' }).click()
  await page.keyboard.press('Escape')
  await expect(
    table.getByRole('button', {
      name: 'Remove filter: Annual demand at least 1,000 kWh',
    }),
  ).toBeVisible()

  // Hide Archetype.
  await columnsTool.click()
  const columns = page.getByRole('dialog', { name: /^Columns:/ })
  await columns.getByRole('checkbox', { name: 'Archetype' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(
    grid.getByRole('columnheader', { name: /^Archetype/ }),
  ).toHaveCount(0)

  // The download is the view: shown columns, filtered rows, and how.
  const downloading = page.waitForEvent('download')
  await table
    .getByRole('button', { name: 'Download Building results as CSV' })
    .click()
  const download = await downloading
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv).toContain('# table: Building results')
  expect(csv).toMatch(/# filters: Use is /)
  expect(csv).toContain('# sorted by: Annual demand, ascending')
  expect(csv).not.toContain('Archetype')
  expect(csv).toContain('Annual demand[kWh]')

  // A new session in this browser shows the table as it was left.
  const table2 = await openResults(page)
  const grid2 = table2.getByRole('grid', { name: 'Building results' })
  await expect(
    grid2.getByRole('columnheader', { name: /^Archetype/ }),
  ).toHaveCount(0)
  await expect(
    grid2.getByRole('columnheader', { name: /^Annual demand/ }),
  ).toHaveAttribute('aria-sort', 'ascending')
  await expect(table2.getByText(/^\d+ of \d+ rows$/)).toBeVisible()

  // Reset returns the defaults.
  await table2.getByRole('button', { name: /^Style of/ }).click()
  await page
    .getByRole('dialog', { name: /^Style:/ })
    .getByRole('button', { name: 'Reset table' })
    .click()
  await page.keyboard.press('Escape')
  await expect(
    grid2.getByRole('columnheader', { name: /^Archetype/ }),
  ).toHaveCount(1)
  await expect(table2.getByText(/^\d+ of \d+ rows$/)).toHaveCount(0)
})

test('a column filter explains a bad range and the grid works from the keyboard', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const table = await openResults(page)
  const grid = table.getByRole('grid', { name: 'Building results' })

  await grid
    .getByRole('button', { name: /^Filter and sort Floor area/ })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Filter and sort: Floor area',
  })
  await dialog.getByLabel('At least').fill('900')
  await dialog.getByLabel('At most').fill('100')
  await expect(dialog.getByRole('alert')).toHaveText(
    'The lower bound is above the upper bound.',
  )
  // Apply stays unavailable and says why rather than applying.
  await dialog.getByRole('button', { name: 'Apply filter' }).focus()
  await page.keyboard.press('Enter')
  await expect(table.getByText(/^\d+ of \d+ rows$/)).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Arrow keys move between cells; the row's buttons are reached the same way.
  await grid.getByRole('rowheader').first().click()
  await page.keyboard.press('ArrowRight')
  await expect(grid.getByRole('gridcell').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(
    grid.getByRole('button', { name: /^Show results of/ }).first(),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Results', exact: true }),
  ).toContainText(/Monthly demand, Building \d+ \(kWh\)/)

  const results = await new AxeBuilder({ page })
    .include('[data-table-id="results.buildings"]')
    .analyze()
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([])
})

test('column widgets follow the pointer, headers cycle sorts, and the header row can freeze', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const table = await openResults(page)
  const grid = table.getByRole('grid', { name: 'Building results' })
  const useTool = table.getByRole('button', { name: /^Filter and sort Use/ })

  // Hovering any cell of a column shows that column's widgets.
  await page.mouse.move(0, 0)
  await expect(useTool).toHaveCSS('opacity', '0')
  await grid.locator('tbody tr').nth(2).getByRole('gridcell').first().hover()
  await expect(useTool).toHaveCSS('opacity', '1')

  // A header steps through ascending, descending, and unsorted; the filter
  // icon carries the direction.
  const floor = grid.getByRole('columnheader', { name: /^Floor area/ })
  const label = floor.getByText('Floor area (m²)')
  await label.click()
  await expect(floor).toHaveAttribute('aria-sort', 'ascending')
  await label.click()
  await expect(floor).toHaveAttribute('aria-sort', 'descending')
  await expect(
    table.getByRole('button', {
      name: 'Filter and sort Floor area (sorted descending)',
    }),
  ).toBeVisible()
  await label.click()
  await expect(floor).toHaveAttribute('aria-sort', 'none')

  // Text columns filter by searching their values; Apply closes the popover.
  await useTool.click()
  const dialog = page.getByRole('dialog', { name: 'Filter and sort: Use' })
  await dialog.getByLabel('Search values').fill('off')
  await expect(dialog.getByRole('group').getByRole('checkbox')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Apply filter' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    table.getByRole('button', { name: 'Remove filter: Use contains “off”' }),
  ).toBeVisible()

  // Format offers center alignment and no longer hides columns.
  await grid.getByRole('button', { name: 'Format Use' }).click()
  const format = page.getByRole('dialog', { name: 'Format: Use' })
  await format.getByRole('radio', { name: 'Center' }).click()
  await expect(format.getByRole('button', { name: 'Hide column' })).toHaveCount(
    0,
  )
  await page.keyboard.press('Escape')
  await expect(grid.getByRole('columnheader', { name: /^Use/ })).toHaveCSS(
    'text-align',
    'center',
  )

  // Freezing the header row keeps it in place while the table scrolls.
  await table.getByRole('button', { name: /^Style of/ }).click()
  const style = page.getByRole('dialog', { name: /^Style:/ })
  await style.getByRole('checkbox', { name: 'Freeze the header row' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(floor).toHaveCSS('position', 'sticky')
  await table.getByRole('button', { name: /^Style of/ }).click()
  await page
    .getByRole('dialog', { name: /^Style:/ })
    .getByRole('button', { name: 'Reset table' })
    .click()
})

// Step 3: the Table page's AG Grid gets the same table bar and column widgets,
// over the shared row model; AG Grid's own filters and menus are gone.
test('the Table page grid has the shared table tools, by pointer and keyboard', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const table = page.locator('[data-table-id="table.buildings"]')
  const useHeader = table.locator('.ag-header-cell[col-id="use"]')
  const useFilter = useHeader.getByRole('button', {
    name: /^Filter and sort Use/,
  })
  await expect(useHeader).toBeVisible()

  // Column widgets show while the pointer is anywhere in their column.
  await page.mouse.move(0, 0)
  await expect(useFilter).toHaveCSS('opacity', '0')
  await table.locator('[row-index="2"] [col-id="use"]').hover()
  await expect(useFilter).toHaveCSS('opacity', '1')

  // A header click steps ascending, descending, unsorted.
  const firstUse = table.locator('[row-index="0"] [col-id="use"]')
  await useHeader.getByText('Use', { exact: true }).click()
  await expect(useHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(firstUse).toHaveText('mixed')
  await useHeader.getByText('Use', { exact: true }).click()
  await expect(useHeader).toHaveAttribute('aria-sort', 'descending')
  await expect(firstUse).toHaveText('school')
  await expect(useFilter).toHaveAccessibleName(
    'Filter and sort Use (sorted descending)',
  )
  await useHeader.getByText('Use', { exact: true }).click()
  await expect(useHeader).toHaveAttribute('aria-sort', 'none')

  // A value search in the column filter; Enter applies it.
  await useFilter.click()
  const dialog = page.getByRole('dialog', { name: 'Filter and sort: Use' })
  await dialog.getByRole('searchbox', { name: 'Search values' }).fill('office')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(table.getByText(/^\d+ of 464 rows$/)).toBeVisible()
  await expect(
    table.getByRole('button', { name: 'Remove filter: Use contains “office”' }),
  ).toBeVisible()
  await expect(firstUse).toHaveText('office')

  // The page search narrows the same rows and says so.
  await table.getByRole('searchbox', { name: 'Search buildings' }).fill('B0006')
  await expect(table.getByText('1 of 464 rows')).toBeVisible()
  const downloading = page.waitForEvent('download')
  await table.hover()
  await table.getByRole('button', { name: 'Download Buildings as CSV' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('energyatlas-buildings.csv')
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv).toContain('# search: B0006')
  expect(csv).toContain('# filters: Use contains “office”')
  expect(csv).toContain('B0006,Building 6,office,1949')

  // No match explains itself and offers a way back.
  await table.getByRole('searchbox', { name: 'Search buildings' }).fill('zzz')
  await expect(
    table.getByText('No rows match the filters and search.'),
  ).toBeVisible()
  await table.getByRole('button', { name: 'Clear filters' }).click()
  await expect(table.getByText('No rows match the search.')).toBeVisible()
  await table.getByRole('button', { name: 'Clear search' }).click()
  await expect(table.getByText(/of 464 rows/)).toHaveCount(0)

  // Columns and style come from the table bar; the grid's header row is
  // always frozen, and the option says why.
  await table.hover()
  await table.getByRole('button', { name: 'Columns of Buildings' }).click()
  const columns = page.getByRole('dialog', { name: 'Columns: Buildings' })
  await columns.getByRole('checkbox', { name: 'Name', exact: true }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(table.locator('.ag-header-cell[col-id="name"]')).toHaveCount(0)
  await table.getByRole('button', { name: 'Style of Buildings' }).click()
  const style = page.getByRole('dialog', { name: 'Style: Buildings' })
  const freezeHeader = style.getByRole('checkbox', {
    name: 'Freeze the header row',
  })
  await expect(freezeHeader).toBeChecked()
  await expect(freezeHeader).toBeDisabled()
  await expect(freezeHeader).toHaveAccessibleDescription(
    'This grid always keeps its header row in place.',
  )
  await style.getByRole('checkbox', { name: 'Freeze the first column' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(
    table.locator('[row-index="0"] .ag-grid-pinned-left-cells [col-id="id"]'),
  ).toBeVisible()

  // From the keyboard: Enter on a header sorts, Tab steps into its widgets.
  await useHeader.focus()
  await page.keyboard.press('Enter')
  await expect(useHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(useFilter).toHaveCSS('opacity', '1')
  await page.keyboard.press('Tab')
  await expect(useFilter).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    useHeader.getByRole('button', { name: 'Format Use' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Format: Use' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    useHeader.getByRole('button', { name: 'Format Use' }),
  ).toBeFocused()

  // The arrangement is kept in this browser.
  await page.reload()
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await expect(useHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(table.locator('.ag-header-cell[col-id="name"]')).toHaveCount(0)

  const results = await new AxeBuilder({ page })
    .include('[data-table-id="table.buildings"]')
    .analyze()
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([])
})
