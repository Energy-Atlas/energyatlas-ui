import { AxeBuilder } from '@axe-core/playwright'
import {
  expect,
  notifications,
  properties,
  startNew,
  test,
  type Page,
} from './test.ts'

// Archetypes and schedules (jobs rollout plan, slice 5; decision 0028):
// tables of definitions edited in Properties with per-field validation,
// coverage, and assignment as a job.

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
  const table = archetypes.getByRole('grid', { name: 'Project archetypes' })
  // Five archetypes and the header row.
  await expect(table.getByRole('row')).toHaveCount(6)
  const coverage = archetypes.getByRole('grid', {
    name: 'Assignment coverage',
  })
  await expect(
    coverage.getByRole('row').filter({ hasText: 'Mixed use' }),
  ).toContainText(/Mixed use\s*\d+\s*0\s*\d+/)

  await archetypes
    .getByRole('grid', { name: 'Synthetic library' })
    .getByRole('button', { name: 'Add Mixed use to the project' })
    .click()
  await expect(table.getByRole('row')).toHaveCount(7)
  // The added archetype is selected and shown in Properties.
  await expect(
    properties(page).getByRole('region', { name: 'Mixed use' }),
  ).toBeVisible()
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
  // A new archetype, created in Properties, with an empty year range is
  // refused on its field.
  const form = await startNew(page, 'archetype')
  await form
    .getByRole('textbox', { name: 'Archetype name' })
    .fill('Office 1990s')
  await form
    .getByRole('combobox', { name: 'Building use' })
    .selectOption('office')
  await form
    .getByRole('textbox', { name: 'Built from (year, optional)' })
    .fill('2000')
  await form
    .getByRole('textbox', { name: 'Built to (year, optional)' })
    .fill('1990')
  await form.getByRole('button', { name: 'Create archetype' }).click()
  const builtTo = form.getByRole('textbox', {
    name: 'Built to (year, optional)',
  })
  await expect(builtTo).toHaveAttribute('aria-invalid', 'true')
  await expect(form).toContainText(
    'The first construction year must not be after the last.',
  )
  await builtTo.fill('1999')
  await form
    .getByRole('textbox', { name: 'Built from (year, optional)' })
    .fill('1990')
  await expect(builtTo).not.toHaveAttribute('aria-invalid', 'true')
  await form.getByRole('button', { name: 'Create archetype' }).click()
  await expect(
    archetypes
      .getByRole('grid', { name: 'Project archetypes' })
      .getByRole('row')
      .filter({ hasText: 'Office 1990s' }),
  ).toHaveAttribute('aria-selected', 'true')

  // A schedule hour above 1 is refused; correcting it saves the schedule.
  const schedule = await startNew(page, 'schedule')
  await schedule
    .getByRole('textbox', { name: 'Schedule name' })
    .fill('Night shift')
  const hour = schedule.getByRole('textbox', { name: 'Weekday, hour 3' })
  await hour.fill('2')
  await schedule.getByRole('button', { name: 'Create schedule' }).click()
  await expect(schedule.getByRole('alert').first()).toContainText(
    'Enter a number from 0 to 1 in every hour.',
  )
  await hour.fill('0.5')
  await schedule.getByRole('button', { name: 'Create schedule' }).click()
  await expect(
    archetypes
      .getByRole('grid', { name: 'Schedules' })
      .getByRole('row')
      .filter({ hasText: 'Night shift' }),
  ).toContainText('2,807')
})

test('edits a schedule by dragging or keys, marks edits, and cancels them', async ({
  page,
}) => {
  const archetypes = await openArchetypes(page)
  await archetypes
    .getByRole('grid', { name: 'Schedules' })
    .getByRole('row')
    .filter({ hasText: 'Office occupancy' })
    .getByRole('rowheader')
    .click()
  const schedule = properties(page).getByRole('region', {
    name: 'Office occupancy',
  })
  const average = schedule.getByRole('status')
  const before = await average.textContent()

  // The chart's points are sliders: Up raises an hour by 0.05.
  const point = schedule.getByRole('slider', { name: 'Weekday, hour 3' })
  await point.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(point).toHaveAttribute('aria-valuetext', '0.15, edited')
  await expect(
    schedule.getByRole('textbox', { name: 'Weekday, hour 3' }),
  ).toHaveValue('0.15')
  await expect(schedule).toContainText('1 field edited, not saved.')
  await expect(average).not.toHaveText(before ?? '')

  // A third day type: Sunday gets its own profile.
  await schedule.getByRole('button', { name: 'Add a day type' }).click()
  await schedule.getByRole('textbox', { name: 'Day type name' }).fill('Sunday')
  await schedule
    .getByRole('combobox', { name: 'Sunday' })
    .selectOption('Sunday')
  await expect(schedule).toContainText('2 fields edited, not saved.')

  await schedule.getByRole('button', { name: 'Discard the edits' }).click()
  await expect(schedule).toContainText('No unsaved edits.')
  await expect(point).toHaveAttribute('aria-valuetext', '0.05')
  await expect(average).toHaveText(before ?? '')
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
