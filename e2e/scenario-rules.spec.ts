import { AxeBuilder } from '@axe-core/playwright'
import {
  expect,
  notifications,
  openMeasures,
  properties,
  saveAndReopen,
  startNew,
  test,
  type Page,
} from './test.ts'

// Scenario rules (decision 0032, stage 3): a scenario's ordered rules on the
// shared rule editor, at most one measure per category; the preview; adoption
// applied when results are aggregated, so changing it needs no new run;
// Scenario modeling; Results; and rules saved with the project.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

function ruleList(page: Page) {
  return page.getByRole('grid', { name: 'Scenario rules', exact: true })
}

async function openPage(page: Page, name: string) {
  await page.keyboard.press('Control+k')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
}

test('re-aggregates adoption without a new run, then models a rule-based scenario', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  const measures = await openMeasures(page)
  const comparison = measures.getByRole('grid', { name: 'Modeled comparison' })
  const envelopeRow = comparison
    .getByRole('row')
    .filter({ hasText: 'Envelope retrofit' })
  await expect(envelopeRow).toContainText('40% adoption, seed 42')

  // Adoption is saved in Properties and re-aggregates the published result.
  await measures
    .getByRole('grid', { name: 'Scenarios' })
    .getByRole('row')
    .filter({ hasText: 'Envelope retrofit' })
    .getByRole('rowheader')
    .click()
  const scenario = properties(page).getByRole('region', {
    name: 'Envelope retrofit',
  })
  await scenario.getByRole('slider', { name: 'Adoption (%)' }).focus()
  for (let step = 0; step < 4; step += 1)
    await page.keyboard.press('ArrowRight')
  await expect(scenario).toContainText(/\d+ adopt at 60% adoption/)
  await scenario.getByRole('button', { name: 'Save scenario' }).click()
  await expect(page.getByTestId('status-notice')).toContainText(
    're-aggregated at 60% adoption, seed 42, without modeling again',
  )
  await expect(envelopeRow).toContainText('60% adoption, seed 42')
  await expect(envelopeRow).toContainText('Current')

  // A rule for older homes, built in Properties with per-field validation.
  await measures
    .getByRole('grid', { name: 'Measure library' })
    .getByRole('button', { name: 'Add Air-source heat pumps to the project' })
    .click()
  await expect(measures.getByRole('grid', { name: 'Measures' })).toContainText(
    'Air-source heat pumps',
  )
  await page.getByRole('button', { name: 'New rule at the top' }).click()
  const form = properties(page).getByRole('region', { name: 'New rule' })
  await form.getByRole('textbox', { name: 'Rule name' }).fill('Older homes')
  await form.getByRole('button', { name: 'Create rule' }).click()
  await expect(form).toContainText(
    'Choose at least one measure for the rule to assign.',
  )
  await form.getByRole('button', { name: 'Add condition' }).click()
  await form
    .getByRole('combobox', { name: 'Condition 1 field' })
    .selectOption('use')
  await form
    .getByRole('combobox', { name: 'Condition 1 value' })
    .selectOption('residential')
  await form.getByRole('button', { name: 'Add condition' }).click()
  await form
    .getByRole('combobox', { name: 'Condition 2 field' })
    .selectOption('yearBuilt')
  await form
    .getByRole('combobox', { name: 'Condition 2 operator' })
    .selectOption('smaller')
  await form.getByRole('textbox', { name: 'Condition 2 value' }).fill('1980')
  await form
    .getByRole('combobox', { name: 'Heating measure' })
    .selectOption({ label: 'Air-source heat pumps' })
  await form.getByRole('button', { name: 'Create rule' }).click()

  const first = ruleList(page).getByRole('row').first()
  await expect(first).toContainText('Older homes')
  await expect(first).toContainText(
    'Use equals Residential and Year built is smaller than 1980; assigns heating: Air-source heat pumps',
  )
  const rule = properties(page).getByRole('region', { name: 'Older homes' })
  await expect(rule).toContainText('Takes heating')
  const preview = measures.getByRole('grid', { name: 'Scenario preview' })
  const previewRow = preview.getByRole('row').nth(1)
  await expect(previewRow.getByRole('rowheader')).toHaveText('1. Older homes')
  const homes = Number(
    /Matches (\d+)/.exec((await first.textContent()) ?? '')?.[1] ?? '0',
  )
  expect(homes).toBeGreaterThan(0)
  await expect(previewRow.getByRole('gridcell')).toHaveText([
    String(homes),
    '0',
    String(homes),
    '0',
    '0',
  ])
  await expect(measures).toContainText(
    'The preview differs from the published results',
  )
  await expect(envelopeRow).toContainText('Outdated')
  await page.screenshot({ path: 'tmp/scenario-rules-1280.png' })

  // Model it from the page: definitions first, then Scenario modeling.
  await measures
    .getByRole('button', { name: 'Run Scenario definitions' })
    .click()
  await expect(notifications(page)).toContainText(
    'Scenario definitions completed',
    { timeout: 15_000 },
  )
  await measures.getByRole('button', { name: 'Run Scenario modeling' }).click()
  await expect(notifications(page)).toContainText(
    'Scenario modeling completed',
    { timeout: 15_000 },
  )
  await expect(envelopeRow).toContainText('Current')
  await expect(envelopeRow).toContainText('60% adoption, seed 42')

  // Results name the aggregation and each building adoption.
  await openPage(page, 'Results')
  const results = page.getByRole('region', { name: 'Results', exact: true })
  await results.getByRole('radio', { name: /^Envelope retrofit/ }).focus()
  await page.keyboard.press('Space')
  await expect(
    results.getByRole('region', { name: 'Provenance' }),
  ).toContainText('Aggregated at 60% adoption, seed 42')
  await expect(
    results.getByRole('grid', { name: 'Building results' }),
  ).toContainText('Adoption')
  expect(await seriousViolations(page)).toEqual([])

  // The rules and the adoption are saved with the project.
  await saveAndReopen(page)
  const reopened = await openMeasures(page)
  await expect(ruleList(page).getByRole('row').first()).toContainText(
    'Older homes',
  )
  await expect(
    reopened
      .getByRole('grid', { name: 'Modeled comparison' })
      .getByRole('row')
      .filter({ hasText: 'Envelope retrofit' }),
  ).toContainText('60% adoption, seed 42')
})

test('shows a scenario without rules, no baseline yet, and a refusal on its field', async ({
  page,
}) => {
  test.setTimeout(60_000)
  // Partway: no baseline results yet.
  await page.goto('/?fixture=partway')
  const measures = await openMeasures(page)
  await expect(
    measures.getByRole('region', { name: 'Scenario rules' }),
  ).toContainText('Create a scenario first')
  const form = await startNew(page, 'scenario')
  await form.getByRole('textbox', { name: 'Name' }).fill('Empty')
  await form.getByRole('textbox', { name: 'Adoption seed' }).fill('1.5')
  await form.getByRole('button', { name: 'Create scenario' }).click()
  const seed = form.getByRole('textbox', { name: 'Adoption seed' })
  await expect(seed).toHaveAttribute('aria-invalid', 'true')
  await expect(form).toContainText('Enter the seed as a whole number.')
  await seed.fill('7')
  await form.getByRole('button', { name: 'Create scenario' }).click()
  await expect(measures.getByRole('grid', { name: 'Scenarios' })).toContainText(
    'Empty',
  )
  const rules = measures.getByRole('region', { name: 'Scenario rules' })
  await expect(rules).toContainText(
    '"Empty" has no rules, so it changes no building',
  )
  await expect(rules).toContainText(
    'No baseline yet: estimates need baseline results.',
  )
  await expect(
    rules.getByRole('button', { name: /^Select the 0 buildings that adopt/ }),
  ).toHaveAttribute('aria-disabled', 'true')
  expect(await seriousViolations(page)).toEqual([])

  // A server refusal (demo condition: input rejected) lands on its field.
  await page.goto('/?fixture=complete&fault=rejectInput')
  await openMeasures(page)
  await page.getByRole('button', { name: 'New rule at the top' }).click()
  const refused = properties(page).getByRole('region', { name: 'New rule' })
  await refused.getByRole('textbox', { name: 'Rule name' }).fill('Refused')
  await refused
    .getByRole('combobox', { name: 'Envelope measure' })
    .selectOption({ label: 'Envelope retrofit' })
  await refused.getByRole('button', { name: 'Create rule' }).click()
  await expect(
    refused.getByRole('textbox', { name: 'Rule name' }),
  ).toHaveAttribute('aria-invalid', 'true')
  await expect(refused).toContainText('The server rejected this value')
  await expect(ruleList(page).getByRole('row')).toHaveCount(1)
})

test('reorders scenario rules with Move buttons and switches one off by keyboard', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/?fixture=complete')
  await openMeasures(page)
  const list = ruleList(page)
  await list.getByRole('row').first().click()
  await page.getByRole('button', { name: 'Duplicate All buildings' }).click()
  await expect(list.getByRole('row')).toHaveCount(2)
  await expect(list.getByRole('row').nth(1)).toContainText(
    'All buildings (copy)',
  )
  await list.getByRole('row').nth(1).click()
  await page
    .getByRole('button', { name: 'Move All buildings (copy) up' })
    .click()
  await expect(list.getByRole('row').first()).toContainText(
    'All buildings (copy)',
  )
  // The copy now takes every envelope measure; the original matches but takes none.
  await expect(list.getByRole('row').nth(1)).toContainText('takes no measure')
  await list.getByRole('checkbox', { name: 'Use All buildings (copy)' }).focus()
  await page.keyboard.press('Space')
  await expect(list.getByRole('row').first()).toHaveText(/ · Off$/)
  await expect(list.getByRole('row').nth(1)).toContainText('takes measures of')
  expect(await seriousViolations(page)).toEqual([])
})
