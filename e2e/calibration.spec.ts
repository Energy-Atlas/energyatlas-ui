import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, notifications } from './test.ts'

// Calibration (jobs rollout plan, slice 7; decision D10): meter validation,
// a fit job, a separate calibrated variant, explicit Adopt and Revert.

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function openCalibration(page: Page) {
  await page.goto('/?fixture=complete')
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await workflowPanel(page)
    .getByRole('button', {
      name: 'Open Calibration to fit the baseline to meters',
    })
    .click()
  const calibration = page.getByRole('region', {
    name: 'Calibration',
    exact: true,
  })
  await expect(calibration).toBeVisible()
  return calibration
}

async function chooseSeries(page: Page, name: string) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).focus()
  await page.keyboard.press('Space')
}

test('validates meters, fits a variant, and adopts it only on request', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const calibration = await openCalibration(page)
  await expect(calibration).toContainText('Working baseline: modeled baseline')

  await chooseSeries(page, 'Partial year, 2026')
  await expect(calibration.getByRole('alert')).toContainText(
    'a fit needs 12 consecutive months',
  )
  await expect(
    calibration.getByRole('button', { name: /^Fit the modeled baseline/ }),
  ).toHaveAttribute('aria-disabled', 'true')

  await chooseSeries(page, 'District export in MWh, 2025')
  const unit = calibration.getByRole('combobox', { name: 'Unit of the values' })
  await expect(unit).toHaveValue('MWh')
  await unit.selectOption('kWh')
  await expect(calibration).toContainText(
    'The export states MWh, but kWh is chosen.',
  )
  await unit.selectOption('MWh')

  await chooseSeries(page, 'District utility meters, 2025')
  await calibration
    .getByRole('button', { name: /^Fit the modeled baseline/ })
    .click()
  await expect(notifications(page)).toContainText(
    'Calibration fit: District utility meters, 2025 completed',
    {
      timeout: 15_000,
    },
  )
  const variants = calibration.getByRole('grid', {
    name: 'Calibrated variants',
  })
  await expect(variants).toContainText('Available')
  // Publishing a variant leaves the working baseline as it was.
  await expect(calibration).toContainText('Working baseline: modeled baseline')
  await expect(
    calibration.getByRole('grid', { name: /^Monthly residuals of/ }),
  ).toContainText('Jan')

  await variants
    .getByRole('button', { name: /^Adopt Calibrated baseline 1/ })
    .click()
  await expect(calibration).toContainText(
    'Working baseline: Calibrated baseline 1',
  )
  await expect(variants).toContainText('Working baseline')
  await expect(
    workflowPanel(page)
      .getByRole('listitem')
      .filter({ hasText: 'Scenario definitions' }),
  ).toContainText('Outdated')

  await variants
    .getByRole('button', { name: 'Revert to the modeled baseline' })
    .click()
  await expect(calibration).toContainText('Working baseline: modeled baseline')
})

test('calibration renders in every appearance and a narrow pane without serious axe violations', async ({
  page,
}) => {
  test.setTimeout(240_000)
  for (const appearance of [
    'light',
    'dark',
    'monochrome',
    'lieflat',
    'cleanLight',
    'darkEngineering',
  ]) {
    await page.addInitScript((value) => {
      localStorage.setItem('eaui.theme', value)
    }, appearance)
    await openCalibration(page)
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
    await page.screenshot({ path: `tmp/calibration-${appearance}-1280.png` })
  }
  await page.setViewportSize({ width: 900, height: 700 })
  // Wait for the narrow layout to settle before measuring.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.screenshot({ path: 'tmp/calibration-narrow-900.png' })
})
