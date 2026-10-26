import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// First-slice build stage 3a: Assets panel, Creator, and Roadmap.

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function runFirstStage(page: Page) {
  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  const workflow = page.getByRole('region', { name: 'Workflow' })
  await workflow
    .getByRole('button', { name: 'Run Location setup / footprint capturing' })
    .click()
  await expect(workflow.getByRole('listitem').first()).toContainText(
    'Complete',
    {
      timeout: 10_000,
    },
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
})

test('assets panel shows project structure, planned groups, and stage provenance', async ({
  page,
}) => {
  const tree = page.locator('[aria-label="Project assets"]')
  await tree.getByText('Gas network', { exact: true }).click()
  const details = page.getByRole('region', { name: 'Asset details' })
  await expect(details).toContainText('Planned')
  await expect(details).toContainText('Gas network modeling is planned')

  await runFirstStage(page)
  await page.getByRole('tab', { name: 'Assets', exact: true }).click()
  await tree.getByText('Building footprints', { exact: true }).click()
  await expect(details).toContainText(
    'Produced by "Location setup / footprint capturing"',
  )
  expect(await seriousViolations(page)).toEqual([])
})

test('creator validates and creates measures and scenarios through commands', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Creator', exact: true }).click()

  const measureForm = page.getByRole('region', { name: 'New measure' })
  await measureForm.getByRole('button', { name: 'Create measure' }).click()
  await expect(measureForm.getByText('Enter a name.')).toBeVisible()

  await measureForm
    .getByRole('textbox', { name: 'Name' })
    .fill('Envelope retrofit')
  await measureForm.getByRole('button', { name: 'Create measure' }).click()
  await expect(page.getByRole('grid', { name: 'Measures' })).toContainText(
    'Envelope retrofit',
  )

  const scenarioForm = page.getByRole('region', { name: 'New scenario' })
  await scenarioForm
    .getByRole('textbox', { name: 'Name' })
    .fill('Half retrofitted')
  await scenarioForm.getByRole('button', { name: 'Create scenario' }).click()
  await expect(
    scenarioForm.getByText('Choose at least one measure.'),
  ).toBeVisible()

  // React Aria keeps the native checkbox visually hidden; use the keyboard.

  await scenarioForm

    .getByRole('checkbox', { name: 'Envelope retrofit' })

    .focus()

  await page.keyboard.press('Space')
  await scenarioForm.getByRole('button', { name: 'Create scenario' }).click()
  await expect(page.getByRole('grid', { name: 'Scenarios' })).toContainText(
    'Half retrofitted',
  )
  expect(await seriousViolations(page)).toEqual([])
})

test('roadmap focuses stages and inserts a custom stage shared with the workflow panel', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Roadmap', exact: true }).click()
  const graph = page.getByRole('region', { name: 'Workflow graph' })
  const schemaStage = graph.getByRole('button', { name: /Schema matching/ })
  await schemaStage.focus()
  await page.keyboard.press('Enter')

  const details = page.getByRole('complementary', { name: 'Stage details' })
  await expect(
    details.getByRole('heading', { name: 'Schema matching' }),
  ).toBeVisible()
  await expect(schemaStage).toHaveAttribute('aria-current', 'step')

  await details
    .getByRole('textbox', { name: 'Insert a custom stage after this one' })
    .fill('Data quality review')
  await details.getByRole('button', { name: 'Insert stage' }).click()
  await expect(
    graph.getByRole('button', { name: /Data quality review/ }),
  ).toHaveCount(1)

  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Workflow' }).getByRole('listitem'),
  ).toHaveCount(13)
  expect(await seriousViolations(page)).toEqual([])
})
