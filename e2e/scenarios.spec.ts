import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Measures and scenarios (jobs rollout plan, slice 6): library, editing,
// one measure of each kind per scenario, previews, the comparison set, and the
// modeled comparison.

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function showWorkflow(page: Page) {
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(workflowPanel(page)).toBeVisible()
}

async function openCreator(page: Page) {
  await page.goto('/?fixture=complete')
  await page.getByRole('tab', { name: 'Creator', exact: true }).click()
  const creator = page.getByRole('region', { name: 'Creator', exact: true })
  await expect(creator).toBeVisible()
  return creator
}

async function addFromLibrary(page: Page, name: string) {
  const creator = page.getByRole('region', { name: 'Creator', exact: true })
  await creator
    .getByRole('combobox', { name: 'Synthetic measure' })
    .selectOption({ label: name })
  await creator
    .getByRole('button', {
      name: 'Add the chosen library measure to the project',
    })
    .click()
  await expect(creator.getByRole('table', { name: 'Measures' })).toContainText(
    name,
  )
}

async function runStage(page: Page, name: string) {
  await workflowPanel(page)
    .getByRole('button', { name: new RegExp(`^(Run|Rerun) ${name}`) })
    .click()
  await expect(
    workflowPanel(page).getByRole('listitem').filter({ hasText: name }),
  ).toContainText('Complete', { timeout: 15_000 })
}

test('composes, previews, edits, and compares scenarios as one modeled set', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const creator = await openCreator(page)
  await addFromLibrary(page, 'LED lighting')
  await addFromLibrary(page, 'Wall and roof insulation')
  await expect(
    creator
      .getByRole('table', { name: 'Measures' })
      .getByRole('row')
      .filter({ hasText: 'LED lighting' }),
  ).toContainText('Library')

  const scenarioForm = creator.getByRole('region', { name: 'New scenario' })
  await scenarioForm.getByRole('textbox', { name: 'Name' }).fill('Lighting')
  const measures = scenarioForm.getByRole('group', { name: 'Measures' })
  await measures.getByRole('checkbox', { name: /^LED lighting/ }).focus()
  await page.keyboard.press('Space')
  await expect(scenarioForm).toContainText(
    /Affects \d+ modeled buildings; estimated [\d.]+% lower annual demand/,
  )
  // Two envelope measures in one scenario are refused before sending.
  await measures
    .getByRole('checkbox', { name: /^Wall and roof insulation/ })
    .focus()
  await page.keyboard.press('Space')
  await measures.getByRole('checkbox', { name: /^Envelope retrofit/ }).focus()
  await page.keyboard.press('Space')
  await expect(scenarioForm).toContainText('both envelope measures')
  await measures.getByRole('checkbox', { name: /^Envelope retrofit/ }).focus()
  await page.keyboard.press('Space')
  await scenarioForm.getByRole('button', { name: 'Create scenario' }).click()
  const scenarios = creator.getByRole('table', { name: 'Scenarios' })
  await expect(scenarios).toContainText('Lighting')

  // Leave the original scenario out of the comparison.
  await scenarios
    .getByRole('button', { name: 'Edit scenario Envelope retrofit' })
    .click()
  const edit = creator.getByRole('region', { name: 'Edit Envelope retrofit' })
  await edit
    .getByRole('checkbox', { name: 'Include in the comparison set' })
    .focus()
  await page.keyboard.press('Space')
  await edit.getByRole('button', { name: 'Save scenario' }).click()
  await expect(
    scenarios.getByRole('row').filter({ hasText: 'Envelope retrofit' }),
  ).toContainText('Left out')

  await showWorkflow(page)
  await runStage(page, 'Scenario definitions')
  await runStage(page, 'Scenario modeling')
  const comparison = creator.getByRole('table', { name: 'Modeled comparison' })
  await expect(comparison.getByRole('row')).toHaveCount(3)
  await expect(comparison).toContainText('Lighting')
  await expect(comparison).not.toContainText('Envelope retrofit')
  await expect(
    comparison.getByRole('row').filter({ hasText: 'Lighting' }),
  ).toContainText('Current')
})

test('creator renders in every appearance and a narrow pane without serious axe violations', async ({
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
    await openCreator(page)
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
    await page.screenshot({ path: `tmp/creator-${appearance}-1280.png` })
  }
  await page.setViewportSize({ width: 900, height: 700 })
  // Wait for the narrow layout to settle before measuring.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.screenshot({ path: 'tmp/creator-narrow-900.png' })
})
