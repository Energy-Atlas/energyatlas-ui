import { AxeBuilder } from '@axe-core/playwright'
import {
  expect,
  notifications,
  properties,
  saveAndReopen,
  test,
  type Page,
} from './test.ts'

// Archetype assignment rules with RC's four parts (decision 0032, stage 2):
// rules built in Properties with typed conditions and per-field validation,
// reordering by keyboard and buttons, the preview, manual parts in the
// Table, assignment as a job, and rules saved with the project.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function openArchetypes(page: Page, query = 'fixture=failed') {
  await page.goto(`/?${query}`)
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Archetypes')
  await page.keyboard.press('Enter')
  const archetypes = page.getByRole('region', {
    name: 'Archetypes and assignment rules',
  })
  await expect(archetypes).toBeVisible()
  return archetypes
}

function ruleList(page: Page) {
  return page.getByRole('grid', { name: 'Assignment rules', exact: true })
}

async function ruleNames(page: Page) {
  return (await ruleList(page).getByRole('row').allTextContents()).map(
    (text) => text.replace(/^\d+\.\s*/, '').split(/(Use |Every |Floors )/)[0],
  )
}

/** Starts a new rule and names it, with one condition on the floors. */
async function startTallRule(page: Page, name: string, floors: string) {
  await page.getByRole('button', { name: 'New rule at the top' }).click()
  const form = properties(page).getByRole('region', { name: 'New rule' })
  await expect(form).toBeVisible()
  await form.getByRole('textbox', { name: 'Rule name' }).fill(name)
  await form.getByRole('button', { name: 'Add condition' }).click()
  await form
    .getByRole('combobox', { name: 'Condition 1 field' })
    .selectOption('floors')
  await form
    .getByRole('combobox', { name: 'Condition 1 operator' })
    .selectOption('larger')
  await form.getByRole('textbox', { name: 'Condition 1 value' }).fill(floors)
  await form
    .getByRole('combobox', { name: 'Systems part' })
    .selectOption({ label: 'Condensing gas boiler' })
  return form
}

test('builds a rule with typed conditions, refuses invalid fields, and previews it', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const archetypes = await openArchetypes(page)
  // The first run generated one rule per archetype and the fallback.
  await expect(ruleList(page).getByRole('row')).toHaveCount(6)
  await expect(ruleList(page).getByRole('row').last()).toContainText(
    'Fallback: any building',
  )

  const form = await startTallRule(page, 'Tall buildings', 'six')
  // Operators follow the field type.
  await expect(
    form
      .getByRole('combobox', { name: 'Condition 1 operator' })
      .getByRole('option'),
  ).toHaveText(['is larger than', 'is smaller than', 'equals'])
  await form.getByRole('button', { name: 'Create rule' }).click()
  const value = form.getByRole('textbox', { name: 'Condition 1 value' })
  await expect(value).toHaveAttribute('aria-invalid', 'true')
  await expect(form).toContainText('Enter a number.')

  await value.fill('6')
  await form.getByRole('button', { name: 'Create rule' }).click()
  await expect(ruleList(page).getByRole('row')).toHaveCount(7)
  const first = ruleList(page).getByRole('row').first()
  await expect(first).toContainText('Tall buildings')
  await expect(first).toContainText('Floors is larger than 6; sets systems')
  await expect(first).toHaveAttribute('aria-selected', 'true')
  // The saved rule shows what it takes and can select the buildings it matches.
  const rule = properties(page).getByRole('region', { name: 'Tall buildings' })
  await expect(rule).toContainText('Takes systems')
  const matched = Number(
    /Matches (\d+)/.exec((await first.textContent()) ?? '')?.[1] ?? '0',
  )
  expect(matched).toBeGreaterThan(0)
  const previewRow = archetypes
    .getByRole('grid', { name: 'Assignment preview' })
    .getByRole('row')
    .nth(1)
  await expect(previewRow.getByRole('rowheader')).toHaveText(
    '1. Tall buildings',
  )
  await expect(previewRow.getByRole('gridcell')).toHaveText([
    String(matched),
    '0',
    String(matched),
    '0',
    '0',
  ])
  await expect(archetypes).toContainText('Outdated')

  // The preview part is a view operation.
  await archetypes
    .getByRole('radiogroup', { name: 'Preview part' })
    .getByRole('radio', { name: 'Systems' })
    .click()
  await expect(
    archetypes
      .getByRole('grid', { name: 'Assignment preview' })
      .getByRole('columnheader'),
  ).toHaveText(['Rule', 'Matches', 'Systems'])
  await expect(page.getByTestId('status-notice')).toContainText(
    'Previewing systems',
  )

  await rule
    .getByRole('button', {
      name: `Select the ${matched} buildings Tall buildings matches`,
    })
    .click()
  await expect(properties(page)).toContainText(`${matched} buildings`)
  expect(await seriousViolations(page)).toEqual([])
})

test('reorders rules by keyboard and with Move buttons, and switches one off', async ({
  page,
}) => {
  await openArchetypes(page)
  const list = ruleList(page)
  await list.getByRole('row').filter({ hasText: 'Office' }).first().click()
  await page.getByRole('button', { name: 'Move Office down' }).click()
  await expect
    .poll(() => ruleNames(page))
    .toEqual([
      'Residential, built 1980 or later',
      'Office',
      'Residential, built before 1980',
      'Retail',
      'School',
      'Fallback: any building',
    ])
  // Keyboard drag and drop: Enter on the handle starts at the gap above the
  // row's neighbour, arrows move between gaps, and Enter drops.
  await list.getByRole('button', { name: 'Move School' }).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => ruleNames(page))
    .toEqual([
      'Residential, built 1980 or later',
      'School',
      'Office',
      'Residential, built before 1980',
      'Retail',
      'Fallback: any building',
    ])
  // A rule switched off matches nothing; offices fall to the fallback.
  await list.getByRole('checkbox', { name: 'Use Office' }).focus()
  await page.keyboard.press('Space')
  const office = list.getByRole('row').filter({ hasText: /^\d+\.Office/ })
  await expect(office).toHaveText(/ · Off$/)
  await expect(list.getByRole('row').last()).not.toContainText(
    'takes parts of 18',
  )
  await page.keyboard.press('Space')
  await expect(office).not.toHaveText(/ · Off$/)
  expect(await seriousViolations(page)).toEqual([])
})

test('a manual part set in the Table wins over the rules', async ({ page }) => {
  test.setTimeout(60_000)
  await openArchetypes(page)
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const systems = page.locator('[row-index="0"] [col-id="part:systems"]')
  await expect(systems).toBeVisible()
  const before = (await systems.innerText()).trim()
  const target =
    before === 'Condensing gas boiler'
      ? 'Gas boiler, split cooling'
      : 'Condensing gas boiler'
  // AG Grid's select editor opens collapsed; its list names the parts.
  await systems.dblclick()
  await systems.getByRole('combobox').click()
  await page
    .locator('.ag-select-list')
    .getByText(target, { exact: true })
    .click()
  await expect(page.getByTestId('pending-count')).toHaveText('1 pending edit')
  await expect(systems).toHaveText(target)
  await page.getByRole('button', { name: 'Apply pending edits' }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('0 pending edits')
  await expect(
    page.locator('[row-index="0"] [col-id="assignedBy"]'),
  ).toContainText('Manual systems')

  await page.locator('[row-index="0"] [col-id="name"]').click()
  const tab = page.getByRole('tab', { name: 'Properties', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(properties(page)).toContainText(`${target} (manual)`)
  await expect(properties(page)).toContainText(
    'it wins over the assignment rules',
  )
})

test('runs Archetype modeling and keeps rules through Save and reopen', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const archetypes = await openArchetypes(page)
  const form = await startTallRule(page, 'Tall buildings', '6')
  await form.getByRole('button', { name: 'Create rule' }).click()
  await expect(ruleList(page).getByRole('row')).toHaveCount(7)
  await expect(archetypes).toContainText(
    'The preview differs from the published parts',
  )
  await archetypes
    .getByRole('button', { name: 'Run Archetype modeling to assign buildings' })
    .click()
  await expect(notifications(page)).toContainText(
    'Archetype modeling completed',
    { timeout: 15_000 },
  )
  await expect(archetypes).toContainText('0 buildings would change')

  await saveAndReopen(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Archetypes')
  await page.keyboard.press('Enter')
  await expect(ruleList(page).getByRole('row').first()).toContainText(
    'Tall buildings',
  )
  await expect(
    page.getByRole('region', { name: 'Archetypes and assignment rules' }),
  ).toContainText('0 buildings would change')
})

test('warns about blank conditions and shows a refusal from the server on its field', async ({
  page,
}) => {
  await openArchetypes(page)
  await page.getByRole('button', { name: 'New rule at the top' }).click()
  const form = properties(page).getByRole('region', { name: 'New rule' })
  await form.getByRole('textbox', { name: 'Rule name' }).fill('Half done')
  await form.getByRole('button', { name: 'Add condition' }).click()
  await expect(form).toContainText(
    'Only blank conditions: the rule is skipped until a field is chosen.',
  )
  await form
    .getByRole('combobox', { name: 'External loads part' })
    .selectOption({ label: 'Residential exterior' })
  await form.getByRole('button', { name: 'Create rule' }).click()
  const warnings = page
    .getByRole('region', { name: 'Assignment rules' })
    .getByText('"Half done" was skipped: all of its conditions are blank.')
  await expect(warnings.first()).toBeVisible()

  // A server refusal (demo condition: input rejected) lands on its field.
  const archetypes = await openArchetypes(
    page,
    'fixture=failed&fault=rejectInput',
  )
  await expect(archetypes).toBeVisible()
  const refused = await startTallRule(page, 'Refused', '6')
  await refused.getByRole('button', { name: 'Create rule' }).click()
  const name = refused.getByRole('textbox', { name: 'Rule name' })
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(refused).toContainText('The server rejected this value')
  await expect(ruleList(page).getByRole('row')).toHaveCount(6)
})
