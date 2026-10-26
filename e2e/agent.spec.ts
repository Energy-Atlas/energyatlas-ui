import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// First-slice build stage 4: scripted agent sessions in the Reasoning panel
// (decisions 0006, 0011, and 0016).

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

function reasoningPanel(page: Page) {
  return page.getByRole('region', { name: 'Reasoning' })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
})

test('layout session runs missing stages after approval, then arranges the workbench', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const panel = reasoningPanel(page)
  await panel
    .getByRole('button', {
      name: 'Start session: Map beside Table, tallest buildings',
    })
    .click()

  const approval = panel.getByRole('listitem', { name: 'Run 2 missing stages' })
  await expect(approval).toContainText('Waiting for your approval')
  await approval
    .getByRole('button', { name: 'Approve: Run 2 missing stages' })
    .click()

  await expect(panel.getByText(/selected the 5 tallest buildings/)).toBeVisible(
    { timeout: 30_000 },
  )
  await expect(
    page.getByRole('tab', { name: 'Map', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('tab', { name: 'Table', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('5 selected', { exact: true })).toBeVisible()
  await expect(
    panel.getByRole('listitem', {
      name: 'Tool call: Select the 5 tallest buildings',
    }),
  ).toContainText('Applied')
  expect(await seriousViolations(page)).toEqual([])

  await panel
    .getByRole('button', { name: 'Start session: Restore the default layout' })
    .click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Restored the default workbench layout.',
    { timeout: 10_000 },
  )
})

test('a model change waits for approval and rejecting it changes nothing', async ({
  page,
}) => {
  const panel = reasoningPanel(page)
  await panel
    .getByRole('button', { name: 'Start session: Propose a scenario change' })
    .click()
  const approval = panel.getByRole('listitem', {
    name: 'Create a measure and a scenario',
  })
  await approval
    .getByRole('button', { name: 'Reject: Create a measure and a scenario' })
    .click()
  await expect(approval).toContainText('Rejected')
  await expect(page.getByTestId('status-notice')).toContainText(
    'nothing was changed',
  )
  await expect(
    panel.getByText('Understood. I did not make that change'),
  ).toBeVisible()

  await page.keyboard.press('Control+k')
  await page.keyboard.type('creator')
  await page.keyboard.press('Enter')
  await expect(page.getByText('No measures yet.')).toBeVisible()
})

test('free text without a prepared session gets an honest answer', async ({
  page,
}) => {
  const panel = reasoningPanel(page)
  await panel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('What is the weather tomorrow?')
  // The left half of the split control queues the message; the agent answers it
  // as soon as it is idle. Exact: the menu half is named "More send options".
  await panel
    .getByRole('button', { name: 'Queue message', exact: true })
    .click()
  await expect(
    panel.getByRole('log', { name: 'Agent transcript' }),
  ).toContainText('I can only run the prepared sessions')
})

test('data representation session colors the map and adds a chart from a specification', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const panel = reasoningPanel(page)
  await panel
    .getByRole('button', {
      name: 'Start session: PV yield map and demand chart',
    })
    .click()
  await panel
    .getByRole('button', { name: 'Approve: Run 7 missing stages' })
    .click()

  await expect(
    panel.getByText(/built from a validated view specification/),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('radio', { name: 'PV yield' })).toBeChecked()

  const chart = page.getByRole('article', { name: 'Baseline monthly demand' })
  await expect(chart).toBeVisible()
  await chart.getByText('Show data table for Baseline monthly demand').click()
  await expect(
    chart.getByRole('table', { name: 'Baseline monthly demand data' }),
  ).toContainText('Dec')
  expect(await seriousViolations(page)).toEqual([])
})
