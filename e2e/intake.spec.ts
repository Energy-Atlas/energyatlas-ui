import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Data intake (jobs rollout plan, slice 4): synthetic datasets, reviewed
// mapping, row validation, stable-ID fusion preview, and fusion as a job.

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function openIntake(page: Page, query = '') {
  await page.goto(`/?fixture=partway${query}`)
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await workflowPanel(page)
    .getByRole('button', { name: 'Open Data intake to map and fuse a dataset' })
    .click()
  const intake = page.getByRole('region', { name: 'Data intake' })
  await expect(intake).toBeVisible()
  return intake
}

async function chooseDataset(page: Page, name: string) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).focus()
  await page.keyboard.press('Space')
}

test('maps, validates, previews, and applies a dataset as a job', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const intake = await openIntake(page)
  await expect(intake).toContainText('No dataset has been applied.')
  await chooseDataset(page, 'Assessor attributes')

  const mapping = intake.getByRole('table', { name: 'Field mapping' })
  await expect(mapping.getByRole('combobox', { name: 'osm_ref' })).toHaveValue(
    'sourceId',
  )
  await expect(
    mapping.getByRole('combobox', { name: 'assessed_note' }),
  ).toHaveValue('')
  await expect(intake).toContainText('60 records: 53 valid, 7 rejected.')
  const rejected = intake.getByRole('table', { name: 'Rejected records' })
  await expect(rejected).toContainText('appears 2 times')
  await expect(rejected).toContainText('No building has source ID "way/0"')
  await expect(
    intake.getByRole('region', { name: 'Fusion preview' }),
  ).toContainText(`${464 - 53} buildings no record matches`)

  // Removing the identifier blocks the whole dataset, on the field.
  await mapping.getByRole('combobox', { name: 'osm_ref' }).selectOption('')
  await expect(intake.getByRole('alert')).toContainText(
    'Map a field to Source ID',
  )
  const apply = intake.getByRole('button', {
    name: 'Apply Assessor attributes',
  })
  await expect(apply).toHaveAttribute('aria-disabled', 'true')
  await expect(apply).toHaveAttribute('title', /Fix the mapping first/)
  await mapping
    .getByRole('combobox', { name: 'osm_ref' })
    .selectOption('sourceId')
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true')

  await apply.click()
  const notices = page.getByRole('region', { name: 'Job notices' })
  await expect(notices).toContainText(
    'Data fusion: Assessor attributes completed.',
    { timeout: 15_000 },
  )
  const applied = intake.getByRole('table', { name: 'Applied datasets' })
  await expect(applied).toContainText('Assessor attributes')
  // Fused attributes change enrichment's output, so later stages are outdated.
  await expect(
    workflowPanel(page)
      .getByRole('listitem')
      .filter({ hasText: 'Schema matching' }),
  ).toContainText('Outdated')
})

test('a dataset without identifiers cannot be applied and says why', async ({
  page,
}) => {
  const intake = await openIntake(page)
  await chooseDataset(page, 'Export without identifiers')
  await expect(intake.getByRole('alert')).toContainText(
    'Map a field to Source ID',
  )
  const apply = intake.getByRole('button', {
    name: 'Apply Export without identifiers',
  })
  await apply.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Fix the mapping first',
  )
  const upload = intake.getByRole('button', { name: 'Upload a file' })
  await expect(upload).toHaveAttribute('aria-disabled', 'true')
})

test('holds fused records when some fail and retries only those', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const intake = await openIntake(page, '&jobs=itemFailures')
  await chooseDataset(page, 'Assessor attributes')
  await intake
    .getByRole('button', { name: 'Apply Assessor attributes' })
    .click()
  const notices = page.getByRole('region', { name: 'Job notices' })
  await expect(notices).toContainText(
    /Data fusion: Assessor attributes partly failed: \d+ of 53 records failed/,
    { timeout: 15_000 },
  )
  await expect(intake).toContainText('No dataset has been applied.')
  await notices.getByRole('button', { name: 'Open job' }).click()
  const detail = page.getByRole('article')
  await detail
    .getByRole('button', { name: /^Retry \d+ failed records?/ })
    .click()
  await expect(detail).toContainText('Published', { timeout: 15_000 })
})

test('intake renders in light, dark, and a narrow pane without serious axe violations', async ({
  page,
}) => {
  test.setTimeout(90_000)
  for (const appearance of ['light', 'darkEngineering']) {
    await page.addInitScript((value) => {
      localStorage.setItem('eaui.theme', value)
    }, appearance)
    const intake = await openIntake(page)
    await chooseDataset(page, 'Planned infill buildings')
    await expect(intake).toContainText('10 records: 9 valid, 1 rejected.')
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
    await page.screenshot({ path: `tmp/intake-${appearance}-1280.png` })
  }
  await page.setViewportSize({ width: 900, height: 700 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({ path: 'tmp/intake-narrow-900.png' })
})
