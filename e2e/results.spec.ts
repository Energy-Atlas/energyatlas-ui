import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Results (jobs rollout plan, slice 8): published results only, provenance and
// currentness, drill-down, monthly and typical-weekday series, and CSV export.

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
  return results
}

test('drills into a building and exports the published result as CSV', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const results = await openResults(page)
  await expect(results.getByRole('radio', { name: /^Baseline/ })).toBeChecked()
  const provenance = results.getByRole('region', { name: 'Provenance' })
  await expect(provenance).toContainText(
    'Current: produced with the present inputs.',
  )
  await expect(provenance).toContainText(/Baseline model setup, run run-\d+/)

  const table = results.getByRole('table', { name: 'Building results' })
  const firstId = await table.locator('tbody tr th').first().innerText()
  await table
    .getByRole('button', { name: `Show results of ${firstId}` })
    .click()
  await expect(results).toContainText(`Monthly demand, ${firstId} (kWh)`)
  await page.getByRole('radio', { name: 'Typical weekday (hourly)' }).focus()
  await page.keyboard.press('Space')
  await expect(results).toContainText(`Typical weekday, ${firstId} (kW)`)
  await expect(results).toContainText('Weekday shape of the schedule')

  const downloading = page.waitForEvent('download')
  await provenance
    .getByRole('button', { name: 'Export Baseline as CSV' })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^energyatlas-baseline-run-\d+\.csv$/,
  )
  const path = await download.path()
  const csv = await readFile(path, 'utf8')
  expect(csv).toContain('# currentness: current')
  expect(csv).toContain('annual_demand[kWh]')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Exported "Baseline"',
  )

  await results.getByRole('radio', { name: /^Envelope retrofit/ }).focus()
  await page.keyboard.press('Space')
  await expect(
    results.getByRole('table', { name: 'Building results' }),
  ).toContainText('Saving vs baseline (kWh)')
})

test('results render in light and dark without serious axe violations', async ({
  page,
}) => {
  test.setTimeout(60_000)
  for (const appearance of ['light', 'darkEngineering']) {
    await page.addInitScript((value) => {
      localStorage.setItem('eaui.theme', value)
    }, appearance)
    await openResults(page)
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      )
    })
    const results = await new AxeBuilder({ page }).analyze()
    expect(
      results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.nodes.length})`),
      appearance,
    ).toEqual([])
    await page.screenshot({ path: `tmp/results-${appearance}-1280.png` })
  }
})
