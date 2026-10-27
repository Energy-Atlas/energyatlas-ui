import { expect, test, type Page, notifications } from './test.ts'

// Roadmap slices 3–8 under a slow server, a failing request, and a project
// switch: controls explain why they wait, failures are shown and recoverable,
// and page drafts never carry into another project.

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function showWorkflow(page: Page) {
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(workflowPanel(page)).toBeVisible()
}

async function openFromWorkflow(page: Page, name: string) {
  await showWorkflow(page)
  await workflowPanel(page).getByRole('button', { name }).click()
}

async function openDemoConditions(page: Page) {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('demo conditions')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Demo conditions' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('a slow server shows pending requests and explains waiting controls', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=partway&latency=slow')
  await openFromWorkflow(page, 'Open Data intake to map and fuse a dataset')
  const intake = page.getByRole('region', { name: 'Data intake' })
  await page.getByRole('radio', { name: /^Assessor attributes/ }).focus()
  await page.keyboard.press('Space')
  const apply = intake.getByRole('button', {
    name: 'Apply Assessor attributes',
  })
  await apply.click()
  await expect(page.getByTestId('status-pending')).toContainText(
    'Waiting for the server: Apply dataset',
  )
  await expect(apply).toHaveAttribute(
    'title',
    'Waiting for the server to answer: the dataset is being queued.',
  )
  await expect(notifications(page)).toContainText(
    'Data fusion: Assessor attributes completed.',
    { timeout: 30_000 },
  )
})

test('a failed request is shown and the same action works on retry', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/?fixture=complete&fault=nextRequest')
  await openFromWorkflow(page, 'Open Calibration to fit the baseline to meters')
  const calibration = page.getByRole('region', {
    name: 'Calibration',
    exact: true,
  })
  const fit = calibration.getByRole('button', {
    name: /^Fit the modeled baseline/,
  })
  await fit.click()
  await expect(page.getByTestId('status-notice')).toContainText(/server|error/i)
  await expect(
    calibration.getByRole('grid', { name: 'Calibrated variants' }),
  ).toHaveCount(0)
  await fit.click()
  await expect(
    calibration.getByRole('grid', { name: 'Calibrated variants' }),
  ).toContainText('Available', { timeout: 15_000 })
})

test('page drafts reset when another project is loaded', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/?fixture=complete')
  await openFromWorkflow(page, 'Open Calibration to fit the baseline to meters')
  const calibration = page.getByRole('region', {
    name: 'Calibration',
    exact: true,
  })
  await page.getByRole('radio', { name: /^Partial year, 2026/ }).focus()
  await page.keyboard.press('Space')
  await expect(
    page.getByRole('radio', { name: /^Partial year, 2026/ }),
  ).toBeChecked()

  const dialog = await openDemoConditions(page)
  await dialog.getByText('Failed stage', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Load "Failed stage"' }).click()
  await page
    .getByRole('alertdialog', { name: 'Leave this project?' })
    .getByRole('button', { name: 'Discard and leave' })
    .click()
  await expect(page.getByTestId('status-notice')).toContainText(
    'Loaded the "Failed stage" fixture',
  )
  await expect(
    calibration.getByRole('radio', { name: /^District utility meters, 2025/ }),
  ).toBeChecked()
})

test('the command palette takes focus from a focused control and gives it back', async ({
  page,
}) => {
  await page.goto('/?fixture=complete')
  await showWorkflow(page)
  const rerun = workflowPanel(page).getByRole('button', {
    name: 'Rerun Location setup / footprint capturing',
  })
  await rerun.focus()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(
    palette.getByRole('searchbox', { name: 'Search commands' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  await expect(rerun).toBeFocused()
})
