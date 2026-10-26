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
