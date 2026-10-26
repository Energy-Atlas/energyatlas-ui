import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Decision 0023: the mock server owns the project, and the Demo conditions
// picker sets causes (delay, faults, job behaviour, held requests, fixtures)
// whose effects the UI must show honestly.

const LOCATION = 'Location setup / footprint capturing'

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function showWorkflow(page: Page) {
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(workflowPanel(page)).toBeVisible()
}

async function openDemoConditions(page: Page) {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('demo conditions')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Demo conditions' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('discloses a fault in the status bar and shows its effect', async ({
  page,
}) => {
  await page.goto('/')
  await createProjectFromStart(page)
  const dialog = await openDemoConditions(page)
  await dialog.getByText('Offline', { exact: true }).click()
  const violations = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze()
  expect(
    violations.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
  await dialog.getByRole('button', { name: 'Done' }).click()

  const chip = page.getByRole('button', {
    name: /^Demo conditions: .*Offline/,
  })
  await expect(chip).toBeVisible()

  await showWorkflow(page)
  const location = workflowPanel(page)
    .getByRole('listitem')
    .filter({ hasText: LOCATION })
  await location.getByRole('button', { name: `Run ${LOCATION}` }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Not sent: the server cannot be reached',
  )
  await expect(location).toContainText('Ready')

  await chip.click()
  await page
    .getByRole('dialog', { name: 'Demo conditions' })
    .getByRole('button', { name: 'Back to normal' })
    .click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Demo conditions are back to normal.',
  )
  await expect(chip).toBeHidden()
})

test('shows a held request as pending until the server answers', async ({
  page,
}) => {
  await page.goto('/?fixture=new&hold=1&latency=none')
  await showWorkflow(page)
  const run = workflowPanel(page).getByRole('button', {
    name: `Run ${LOCATION}`,
  })
  await run.click()
  await expect(page.getByTestId('status-pending')).toContainText(
    'Waiting for the server: Run stage',
  )
  // The control explains why it waits instead of sending twice.
  await expect(run).toHaveAttribute('aria-disabled', 'true')

  const dialog = await openDemoConditions(page)
  await dialog.getByText(/^Hold requests/).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('status-pending')).toBeHidden()
  await expect(
    workflowPanel(page).getByRole('listitem').filter({ hasText: LOCATION }),
  ).toContainText('Complete', { timeout: 10_000 })
})

test('shows rejected input on its field and the edit lock as a reason', async ({
  page,
}) => {
  await page.goto('/?fixture=new&fault=rejectInput')
  await page.getByRole('tab', { name: 'Creator', exact: true }).click()
  const measureForm = page.getByRole('region', { name: 'New measure' })
  await measureForm.getByRole('textbox', { name: 'Name' }).fill('Heat pumps')
  await measureForm.getByRole('button', { name: 'Create measure' }).click()
  await expect(
    measureForm.getByText('The server rejected this value'),
  ).toBeVisible()
  await expect(
    measureForm.getByRole('textbox', { name: 'Name' }),
  ).toHaveAttribute('aria-invalid', 'true')

  await page.goto('/?fixture=new&fault=editLock')
  await page.getByRole('tab', { name: 'Creator', exact: true }).click()
  await measureForm.getByRole('textbox', { name: 'Name' }).fill('Heat pumps')
  await measureForm.getByRole('button', { name: 'Create measure' }).click()
  await expect(measureForm).toContainText('A run is in progress')
})

test('keeps table drafts fixed while Apply waits, then makes cells editable again', async ({
  page,
}) => {
  await page.goto('/?fixture=partway&hold=1&latency=none')
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const floors = page.locator('[row-index="0"] [col-id="floors"]')
  await floors.dblclick()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('60')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Apply pending edits' }).click()
  await expect(
    page.getByText(
      'Waiting for the server to answer Apply. Drafts can be changed or undone after it answers.',
    ),
  ).toBeVisible()
  await floors.dblclick()
  await expect(floors.locator('input')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('pending-count')).toHaveText('1 pending edit')
  await expect(floors).toHaveText('60')

  const dialog = await openDemoConditions(page)
  await dialog.getByText(/^Hold requests/).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('0 pending edits')
  await floors.dblclick()
  await expect(floors.locator('input')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('loads project fixtures through the server', async ({ page }) => {
  await page.goto('/?fixture=failed')
  await showWorkflow(page)
  await expect(
    workflowPanel(page)
      .getByRole('listitem')
      .filter({ hasText: 'Grid modeling' }),
  ).toContainText('Failed')

  const dialog = await openDemoConditions(page)
  await expect(dialog).toContainText('unsaved changes')
  await dialog.getByText('Complete', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Load "Complete"' }).click()
  await page
    .getByRole('alertdialog', { name: 'Leave this project?' })
    .getByRole('button', { name: 'Discard and leave' })
    .click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Loaded the "Complete" fixture',
  )
  await expect(
    workflowPanel(page)
      .getByRole('listitem')
      .filter({ hasText: 'Dashboard / visualization' }),
  ).toContainText('Complete')
})

test('fails a job partway and keeps its log', async ({ page }) => {
  await page.goto('/?jobs=failPartway')
  await createProjectFromStart(page)
  await showWorkflow(page)
  await workflowPanel(page)
    .getByRole('button', { name: `Run ${LOCATION}` })
    .click()
  await expect(
    workflowPanel(page).getByRole('listitem').filter({ hasText: LOCATION }),
  ).toContainText('Failed', { timeout: 10_000 })

  await page.getByRole('button', { name: /Open Jobs/ }).click()
  const jobs = page.getByRole('table', { name: 'Jobs' })
  await expect(jobs).toContainText('Failed')
  await jobs.locator('summary').first().click()
  await expect(
    jobs.getByRole('list', { name: `Log of ${LOCATION}` }),
  ).toContainText('Failed: The server reported an error partway')
})
