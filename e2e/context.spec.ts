import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Reasoning and Inspection are independent dockable panels (decision 0016).
// Inspection follows the shared selection read-only.

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function runStages(page: Page, names: string[]) {
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

async function selectFirstBuildingInTable(page: Page) {
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await page.locator('[row-index="0"] [col-id="name"]').click()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
})

test('inspection shows the shared selection read-only', async ({ page }) => {
  await runStages(page, [
    'Location setup / footprint capturing',
    'Geospatial data enriching',
  ])
  // Both panels are docked on the right; Reasoning is the one shown first.
  const reasoningTab = page.getByRole('tab', { name: 'Reasoning', exact: true })
  const inspectionTab = page.getByRole('tab', {
    name: 'Inspection',
    exact: true,
  })
  await expect(reasoningTab).toHaveAttribute('aria-selected', 'true')
  await expect(inspectionTab).toHaveAttribute('aria-selected', 'false')

  await inspectionTab.click()
  await expect(inspectionTab).toHaveAttribute('aria-selected', 'true')
  const inspection = page.getByRole('region', { name: 'Inspection' })
  await expect(inspection.getByText('Nothing selected')).toBeVisible()

  await selectFirstBuildingInTable(page)
  await expect(inspection.locator('header').first()).toContainText('B0001')
  await expect(
    inspection.getByRole('region', { name: 'Properties' }),
  ).toContainText('Floors')
  await expect(
    inspection.getByRole('region', { name: 'Provenance' }),
  ).toContainText('Simulated')
  expect(await seriousViolations(page)).toEqual([])

  await inspection
    .getByRole('button', { name: 'Clear selection from Inspection' })
    .click()
  await expect(inspection.getByText('Nothing selected')).toBeVisible()
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible()
})

test('inspect selection opens the Inspection panel', async ({ page }) => {
  await runStages(page, ['Location setup / footprint capturing'])
  const inspectionTab = page.getByRole('tab', {
    name: 'Inspection',
    exact: true,
  })
  await expect(inspectionTab).toHaveAttribute('aria-selected', 'false')

  await selectFirstBuildingInTable(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('inspect selection')
  await page.keyboard.press('Enter')

  await expect(inspectionTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Showed the Inspection panel.',
  )
  const inspection = page.getByRole('region', { name: 'Inspection' })
  await expect(inspection.locator('header').first()).toContainText('B0001')
})

test('each panel has its own toggle, so both can be open at once', async ({
  page,
}) => {
  const reasoningTab = page.getByRole('tab', { name: 'Reasoning', exact: true })
  const inspectionTab = page.getByRole('tab', {
    name: 'Inspection',
    exact: true,
  })

  // Closing Reasoning from the Panels menu leaves Inspection docked.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('reasoning')
  await page.keyboard.press('Enter')
  await expect(reasoningTab).toHaveAttribute('aria-selected', 'false')
  await expect(inspectionTab).toBeVisible()

  await page.keyboard.press('Control+k')
  await page.keyboard.type('inspection')
  await page.keyboard.press('Enter')
  await expect(inspectionTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Showed the Inspection panel.',
  )
})
