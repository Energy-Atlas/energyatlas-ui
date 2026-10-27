import { createProjectFromStart, openMeasures, startNew } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// First-slice build stage 3c: dashboard comparison and scenario controls.

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

function workflowItem(page: Page, name: string) {
  return page
    .getByRole('region', { name: 'Workflow' })
    .getByRole('listitem')
    .filter({ hasText: name })
}

async function runStages(page: Page, names: string[]) {
  // Clicking an already selected border tab would close the Workflow panel.
  const workflowTab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await workflowTab.getAttribute('aria-selected')) !== 'true') {
    await workflowTab.click()
  }
  for (const name of names) {
    const item = workflowItem(page, name)
    await item.getByRole('button', { name: `Run ${name}` }).click()
    await expect(item).toContainText('Complete', { timeout: 10_000 })
  }
}

test('dashboard compares a modeled scenario and previews adoption before applying it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByText('No results yet')).toBeVisible()

  await runStages(page, [
    'Location setup / footprint capturing',
    'Geospatial data enriching',
    'Schema matching',
    'Geospatial preprocessing',
  ])
  await workflowItem(page, 'Shading calculation / PV yield estimation')
    .getByRole('button', { name: /^Skip / })
    .click()
  await runStages(page, ['Archetype modeling', 'Baseline model setup'])

  await openMeasures(page)
  const measureForm = await startNew(page, 'measure')
  await measureForm
    .getByRole('textbox', { name: 'Name' })
    .fill('Envelope retrofit')
  await measureForm.getByRole('button', { name: 'Create measure' }).click()
  await expect(page.getByRole('grid', { name: 'Measures' })).toContainText(
    'Envelope retrofit',
  )
  const scenarioForm = await startNew(page, 'scenario')
  await scenarioForm
    .getByRole('textbox', { name: 'Name' })
    .fill('Half retrofitted')
  await scenarioForm
    .getByRole('checkbox', { name: 'Envelope retrofit' })
    .focus()
  await page.keyboard.press('Space')
  await scenarioForm.getByRole('button', { name: 'Create scenario' }).click()
  await expect(page.getByRole('grid', { name: 'Scenarios' })).toContainText(
    'Half retrofitted',
  )

  await runStages(page, ['Scenario definitions', 'Scenario modeling'])

  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByText('Baseline annual demand')).toBeVisible()
  await expect(page.getByText('Half retrofitted annual demand')).toBeVisible()
  await expect(page.getByText(/% vs baseline/)).toBeVisible()

  const slider = page.getByRole('slider', {
    name: 'What-if adoption for Half retrofitted',
  })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Preview, not saved')).toBeVisible()
  await expect(
    page.getByText('Half retrofitted (preview 60%) annual demand'),
  ).toBeVisible()

  await page
    .getByRole('button', { name: 'Apply 60% adoption to Half retrofitted' })
    .click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Set adoption for "Half retrofitted" from 50% to 60%.',
  )
  await expect(page.getByText(/Scenario results are outdated/)).toBeVisible()
  await expect(workflowItem(page, 'Scenario modeling')).toContainText(
    'Outdated',
  )

  await page.getByText('Show monthly data table').click()
  await expect(
    page.getByRole('grid', { name: 'Monthly demand data' }),
  ).toContainText('Dec')
  expect(await seriousViolations(page)).toEqual([])
})
