import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, notifications } from './test.ts'

// Archetypes and schedules (jobs rollout plan, slice 5): library, compact
// editors with per-field validation, coverage, and assignment as a job.

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function openArchetypes(page: Page) {
  await page.goto('/?fixture=failed')
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await workflowPanel(page)
    .getByRole('button', {
      name: 'Open Archetypes to edit definitions and schedules',
    })
    .click()
  const archetypes = page.getByRole('region', {
    name: 'Archetypes and schedules',
  })
  await expect(archetypes).toBeVisible()
  return archetypes
}

test('adds a library archetype, shows coverage, and reassigns as a job', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const archetypes = await openArchetypes(page)
  const list = archetypes.getByRole('listbox', { name: 'Project archetypes' })
  await expect(list.getByRole('option')).toHaveCount(6)
  const coverage = archetypes.getByRole('grid', {
    name: 'Assignment coverage',
  })
  await expect(
    coverage.getByRole('row').filter({ hasText: 'Mixed use' }),
  ).toContainText(/Mixed use\s*\d+\s*0\s*\d+/)

  await archetypes
    .getByRole('listbox', { name: 'Synthetic library' })
    .getByRole('option', { name: 'Mixed use', exact: true })
    .click()
  await archetypes
    .getByRole('button', {
      name: 'Add the chosen library archetype to the project',
    })
    .click()
  await expect(list.getByRole('option')).toHaveCount(7)
  await expect(archetypes).toContainText('Archetype modeling')
  await expect(archetypes.getByText('Outdated').first()).toBeVisible()
  await expect(
    coverage.getByRole('row').filter({ hasText: 'Mixed use' }),
  ).toContainText(/Mixed use\s*(\d+)\s*\1\s*0/)

  await archetypes
    .getByRole('button', { name: 'Run Archetype modeling to assign buildings' })
    .click()
  await expect(notifications(page)).toContainText(
    'Archetype modeling completed',
    { timeout: 15_000 },
  )
  await expect(archetypes).toContainText('0 assignments would change')
})

test('validates archetype and schedule fields where they are entered', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const archetypes = await openArchetypes(page)
  // A new archetype with an empty year range is refused on its field.
  await archetypes
    .getByRole('textbox', { name: 'Archetype name' })
    .fill('Office 1990s')
  await archetypes
    .getByRole('combobox', { name: 'Building use' })
    .selectOption('office')
  await archetypes
    .getByRole('textbox', { name: 'Built from (year, optional)' })
    .fill('2000')
  await archetypes
    .getByRole('textbox', { name: 'Built to (year, optional)' })
    .fill('1990')
  await archetypes.getByRole('button', { name: 'Create archetype' }).click()
  const builtTo = archetypes.getByRole('textbox', {
    name: 'Built to (year, optional)',
  })
  await expect(builtTo).toHaveAttribute('aria-invalid', 'true')
  await expect(archetypes).toContainText(
    'The first construction year must not be after the last.',
  )
  await builtTo.fill('1999')
  await archetypes
    .getByRole('textbox', { name: 'Built from (year, optional)' })
    .fill('1990')
  await expect(builtTo).not.toHaveAttribute('aria-invalid', 'true')
  await archetypes.getByRole('button', { name: 'Create archetype' }).click()
  await expect(
    archetypes
      .getByRole('listbox', { name: 'Project archetypes' })
      .getByRole('option', { name: 'Office 1990s' }),
  ).toHaveAttribute('aria-selected', 'true')

  // A schedule hour above 1 is refused; correcting it saves the schedule.
  await archetypes
    .getByRole('listbox', { name: 'Schedules' })
    .getByRole('option', { name: 'New schedule…' })
    .click()
  await archetypes
    .getByRole('textbox', { name: 'Schedule name' })
    .fill('Night shift')
  const hour = archetypes.getByRole('textbox', { name: 'Weekday hour 3' })
  await hour.fill('2')
  await archetypes.getByRole('button', { name: 'Create schedule' }).click()
  await expect(archetypes.getByRole('alert')).toContainText(
    'Hourly values cannot be above 1.',
  )
  await hour.fill('0.5')
  await archetypes.getByRole('button', { name: 'Create schedule' }).click()
  await expect(
    archetypes
      .getByRole('listbox', { name: 'Schedules' })
      .getByRole('option', { name: 'Night shift' }),
  ).toContainText('2.5 full-load hours a week')
})

test('archetypes render in every appearance and a narrow pane without serious axe violations', async ({
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
    await openArchetypes(page)
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
    await page.screenshot({ path: `tmp/archetypes-${appearance}-1280.png` })
  }
  await page.setViewportSize({ width: 900, height: 700 })
  // Wait for the narrow layout to settle before measuring.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.screenshot({ path: 'tmp/archetypes-narrow-900.png' })
})
