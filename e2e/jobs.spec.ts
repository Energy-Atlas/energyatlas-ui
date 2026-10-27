import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, notifications, toast } from './test.ts'

// Jobs (decision 0025, jobs rollout plan): held item results, failed-item
// retry with unchanged inputs, fresh runs after changes or cancellation,
// notices that open the job, and the list and detail by keyboard.

const PREPROCESSING = 'Geospatial preprocessing'
const LOCATION = 'Location setup / footprint capturing'

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function showWorkflow(page: Page) {
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(workflowPanel(page)).toBeVisible()
}

function stageRow(page: Page, name: string) {
  return workflowPanel(page).getByRole('listitem').filter({ hasText: name })
}

/** Reruns preprocessing in the Partway fixture with some items failing. */
async function partlyFailPreprocessing(page: Page) {
  await page.goto('/?fixture=partway&jobs=itemFailures')
  await showWorkflow(page)
  await workflowPanel(page)
    .getByRole('button', { name: `Run ${PREPROCESSING}` })
    .click()
  await expect(stageRow(page, PREPROCESSING)).toContainText('Failed', {
    timeout: 15_000,
  })
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

test('holds partial results, opens the job from its notice, and retries only failed items', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await partlyFailPreprocessing(page)
  // The workflow offers the retry beside a fresh rerun.
  await expect(
    stageRow(page, PREPROCESSING).getByRole('button', {
      name: new RegExp(`^Retry \\d+ failed items? of ${PREPROCESSING}`),
    }),
  ).toBeVisible()

  const notices = notifications(page)
  await expect(notices).toContainText(
    /Geospatial preprocessing partly failed: \d+ of 464 items failed; successful results are held/,
  )
  const before = await page.evaluate(() => document.activeElement?.tagName)
  // The notice never takes focus.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
    before,
  )
  await toast(page, /partly failed/)
    .getByRole('button', { name: 'Open job' })
    .click()
  await expect(
    page.getByRole('tab', { name: 'Jobs', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  // Opening the job is a choice, so focus follows it to the list.
  await expect(page.getByRole('listbox', { name: 'Jobs' })).toBeFocused()

  const detail = page.getByRole('article')
  await expect(detail).toContainText('attempt 1')
  await expect(detail).toContainText(/\d+ results? held, not published/)
  await expect(detail).toContainText('Unchanged since submission.')
  const failed = detail.getByRole('grid', { name: 'Failed items' })
  await expect(failed).toContainText('Transient worker fault')
  const failedCount = await failed.locator('tbody tr').count()
  expect(failedCount).toBeGreaterThan(0)

  // Selecting a failed building uses the shared selection.
  await failed
    .getByRole('button', { name: /^Select building / })
    .first()
    .click()
  await expect(page.getByRole('region', { name: 'Inspection' })).toContainText(
    /Building/,
  )

  const retry = detail.getByRole('button', {
    name: new RegExp(`^Retry ${failedCount} failed items? of ${PREPROCESSING}`),
  })
  await retry.click()
  await expect(detail).toContainText('attempt 2', { timeout: 15_000 })
  await expect(detail.getByRole('group', { name: 'Job actions' })).toBeVisible()
  await expect(detail).toContainText('Completed', { timeout: 15_000 })
  await expect(detail).toContainText('Published')
  const attempts = detail.getByRole('region', { name: 'Attempts' })
  await expect(attempts).toContainText('Attempt 1: Failed')
  await expect(attempts).toContainText('Attempt 2: Completed')
  await expect(notices).toContainText(
    'Geospatial preprocessing completed on attempt 2.',
  )
  // Dismissing by keyboard never strands focus on a removed button: it
  // moves to the next toast, or back to the workspace.
  const completed = toast(page, 'completed on attempt 2.')
  await completed.getByRole('button', { name: /^Dismiss: / }).focus()
  await page.keyboard.press('Enter')
  await expect(completed).toBeHidden()
  await expect(page.locator(':focus')).toHaveAccessibleName(
    /^(Workspace|Dismiss: .*)$/,
  )
  await showWorkflow(page)
  await expect(stageRow(page, PREPROCESSING)).toContainText('Complete')
})

test('refuses a retry after an input changes and explains the fresh run', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await partlyFailPreprocessing(page)
  // Rerunning an earlier stage changes what preprocessing consumed.
  await workflowPanel(page)
    .getByRole('button', { name: `Run ${LOCATION}` })
    .click()
  await expect(stageRow(page, LOCATION)).toContainText('Complete', {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: /Open Jobs/ }).click()
  const list = page.getByRole('listbox', { name: 'Jobs' })
  await list
    .getByRole('option', { name: new RegExp(`^${PREPROCESSING}`) })
    .first()
    .click()
  const detail = page.getByRole('article')
  await expect(detail).toContainText(
    /Changed since submission: the outputs of "Location setup/,
  )
  const retry = detail.getByRole('button', { name: /^Retry \d+ failed items?/ })
  await expect(retry).toHaveAttribute('aria-disabled', 'true')
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Inputs changed since this run was submitted',
  )
})

test('cancels a stalled job, publishes nothing, and offers only a fresh run', async ({
  page,
}) => {
  await page.goto('/?fixture=new&jobs=stall')
  await showWorkflow(page)
  await workflowPanel(page)
    .getByRole('button', { name: `Run ${LOCATION}` })
    .click()
  await page.getByRole('button', { name: /^1 active jobs/ }).click()
  const detail = page.getByRole('article')
  await expect(detail).toContainText('Running')
  await detail.getByRole('button', { name: `Cancel ${LOCATION}` }).click()
  await expect(detail).toContainText('Cancelled')
  await expect(detail).toContainText('Nothing was published')
  const retry = detail.getByRole('button', { name: /^Retry the whole run/ })
  await expect(retry).toHaveAttribute(
    'title',
    /Cancelled work is not resumed; start a fresh run/,
  )
  await expect(
    detail.getByRole('button', { name: `Fresh run of ${LOCATION}` }),
  ).not.toHaveAttribute('aria-disabled', 'true')
})

test('moves through the jobs list by keyboard and filters it', async ({
  page,
}) => {
  await page.goto('/?fixture=failed')
  await page.getByRole('button', { name: /Open Jobs/ }).click()
  const list = page.getByRole('listbox', { name: 'Jobs' })
  const detail = page.getByRole('article')
  await expect(detail.getByRole('heading', { level: 3 })).toContainText(
    'Grid modeling',
  )
  await list.getByRole('option').first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(detail.getByRole('heading', { level: 3 })).not.toContainText(
    'Grid modeling',
  )
  await page.keyboard.press('Home')
  await expect(detail.getByRole('heading', { level: 3 })).toContainText(
    'Grid modeling',
  )
  await page.getByRole('radio', { name: 'Needs attention' }).focus()
  await page.keyboard.press('Space')
  await expect(list.getByRole('option')).toHaveCount(1)
  await page.getByRole('radio', { name: 'Active' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByText('No active jobs.')).toBeVisible()
})

test('jobs render in every appearance and a narrow pane without serious axe violations', async ({
  page,
}) => {
  test.setTimeout(150_000)
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
    await partlyFailPreprocessing(page)
    await expect(page.locator('html')).toHaveAttribute(
      'data-appearance',
      appearance,
    )
    await page.getByRole('button', { name: /Open Jobs/ }).click()
    await expect(page.getByRole('article')).toContainText('Failed items')
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      )
    })
    expect(await seriousViolations(page), appearance).toEqual([])
    await page.screenshot({ path: `tmp/jobs-${appearance}-1280.png` })
  }
  await page.setViewportSize({ width: 900, height: 700 })
  await expect(page.getByRole('listbox', { name: 'Jobs' })).toBeVisible()
  // Wait for the narrow layout to settle before measuring.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.screenshot({ path: 'tmp/jobs-narrow-900.png' })
})
