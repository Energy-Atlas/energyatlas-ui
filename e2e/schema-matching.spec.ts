import { AxeBuilder } from '@axe-core/playwright'
import { readFile, writeFile } from 'node:fs/promises'
import {
  expect,
  notifications,
  properties,
  saveAndReopen,
  test,
  type Page,
} from './test.ts'

// Schema matching as a mapping review (decision 0032, stage 4): target fields
// in RC's tiers, suggestions to review, value checks with unrecognised
// values, a run blocked with its reason, the mapping applied as a job with
// provenance in Properties, rule sets saved, loaded, and read from files, and
// the mapping saved with the project.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function openSchema(page: Page, query = 'fixture=partway') {
  await page.goto(`/?${query}`)
  return showSchema(page)
}

/** Opens Schema matching from its stage in the Workflow panel. */
async function showSchema(page: Page) {
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await page
    .getByRole('button', {
      name: 'Open Schema matching to review the attribute mapping',
    })
    .click()
  const schema = page.getByRole('region', {
    name: 'Schema matching',
    exact: true,
  })
  await expect(schema).toBeVisible()
  return schema
}

function mappingOf(page: Page) {
  return page.getByRole('region', { name: 'Attribute mapping' })
}

test('reviews suggestions, maps by keyboard, explains a blocked run, and applies the mapping with provenance', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const schema = await openSchema(page)
  const mapping = mappingOf(page)
  await expect(schema).toContainText('Applied by run')
  await expect(mapping).toContainText('2 suggested matches wait for review')

  // A suggestion is accepted with its own button.
  await mapping.getByRole('button', { name: 'Accept "name" for Name' }).click()
  await expect(mapping.getByRole('combobox', { name: 'Name' })).toHaveValue(
    'name',
  )
  await expect(mapping).toContainText('1 suggested match waits for review')

  // Unmapping a compulsory field by keyboard blocks the run, with the reason.
  const use = mapping.getByRole('combobox', { name: 'Use', exact: true })
  await use.focus()
  await page.keyboard.press('Home')
  await expect(use).toHaveValue('')
  await expect(mapping).toContainText(
    'Use is compulsory: choose the attribute that holds it.',
  )
  const run = schema.getByRole('button', {
    name: 'Run Schema matching to apply the mapping',
  })
  await expect(run).toHaveAttribute('aria-disabled', 'true')
  await expect(run).toHaveAttribute(
    'title',
    /1 compulsory field is missing or invalid: Use/,
  )
  await run.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'compulsory field',
  )
  // Typing the first letters maps it again.
  await use.focus()
  await page.keyboard.type('bu')
  await expect(use).toHaveValue('building')
  await expect(run).not.toHaveAttribute('aria-disabled', 'true')

  // Unrecognised enumerated values are listed with counts and can be read.
  await expect(mapping).toContainText('1 value is not recognised')
  await mapping
    .getByRole('combobox', { name: 'Read "yes" as' })
    .selectOption('mixed')
  await expect(mapping).toContainText('Every value is recognised')
  await expect(
    page
      .getByRole('region', { name: 'Workflow' })
      .getByRole('listitem')
      .filter({ hasText: 'Schema matching' }),
  ).toContainText('Outdated')

  // The value distribution of a source attribute.
  await mapping
    .getByRole('listbox', { name: 'Source attributes' })
    .getByRole('option', { name: /^height/ })
    .click()
  await expect(
    mapping.getByRole('region', { name: 'Values of height' }),
  ).toContainText('Not a number')

  await run.click()
  await expect(notifications(page)).toContainText('Schema matching completed', {
    timeout: 15_000,
  })
  await expect(schema).toContainText('values_invalid')
  await expect(schema).toContainText('Name 53')
  await expect(schema).not.toContainText('enum_values_unrecognised')

  // Mapped names reach the Table, and Properties says where values come from.
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const table = page.locator('[data-table-id="table.buildings"]')
  await table
    .getByRole('searchbox', { name: 'Search buildings' })
    .fill('Harbor House')
  const name = table.locator('[row-index="0"] [col-id="name"]')
  await expect(name).toHaveText('Harbor House')
  await name.click()
  await page.getByRole('tab', { name: 'Properties', exact: true }).click()
  await expect(properties(page)).toContainText(
    'Schema matching from "name" = "Harbor House"',
  )
  await expect(properties(page)).toContainText('Captured tags')
  await expect(properties(page)).toContainText('roof:shape')
})

test('saves, loads, downloads, and reads rule sets, and keeps the mapping through Save and reopen', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const schema = await openSchema(page)
  const mapping = mappingOf(page)
  await mapping
    .getByRole('button', { name: 'Accept all suggestions (2)' })
    .click()
  await expect(mapping.getByRole('combobox', { name: 'Height' })).toHaveValue(
    'height',
  )
  const ruleSets = schema.getByRole('region', { name: 'Rule sets' })
  await ruleSets
    .getByRole('textbox', { name: 'Rule set name' })
    .fill('All OSM tags')
  await ruleSets
    .getByRole('button', { name: 'Save the mapping as a rule set' })
    .click()
  // Outcomes are messages, not notices that push the section down (decision 0036).
  await expect(page.getByTestId('status-notice')).toContainText(
    'Saved the rule set "All OSM tags" with 5 mappings.',
  )
  await expect(
    ruleSets.getByRole('option', { name: /^All OSM tags/ }),
  ).toBeVisible()

  // The built-in rule set maps only the compulsory fields.
  await ruleSets
    .getByRole('option', { name: /^OSM building tags \(built in\)/ })
    .click()
  await ruleSets
    .getByRole('button', {
      name: 'Load the rule set OSM building tags (built in)',
      exact: true,
    })
    .click()
  await expect(mapping.getByRole('combobox', { name: 'Height' })).toHaveValue(
    '',
  )

  // A saved rule set downloads in RC's shape.
  await ruleSets.getByRole('option', { name: /^All OSM tags/ }).click()
  const downloading = page.waitForEvent('download')
  await ruleSets
    .getByRole('button', { name: 'Download the rule set All OSM tags' })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('all-osm-tags.json')
  const file = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    version: number
    mappings: { target: string; source: string; transform: null }[]
  }
  expect(file.version).toBe(1)
  expect(file.mappings).toContainEqual({
    target: 'heightM',
    source: 'height',
    tier: 'computed',
    transform: null,
  })

  // A file naming fields that do not exist loads the rest and says why.
  const path = testInfo.outputPath('county.json')
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      name: 'County export',
      mappings: [
        { target: 'use', source: 'building', tier: 'compulsory' },
        { target: 'yearBuilt', source: 'start_date' },
        { target: 'floors', source: 'stories' },
        { target: 'roofType', source: 'roof:shape' },
      ],
    }),
  )
  await ruleSets.getByLabel('Rule set file').setInputFiles(path)
  // Skipped mappings are a warning message (decision 0036).
  const loaded = notifications(page).locator('[data-tone="warning"]', {
    hasText: 'Loaded "County export": 2 mappings',
  })
  await expect(loaded).toContainText(
    '"stories" is not an attribute of the captured footprints.',
  )
  await expect(loaded).toContainText(
    '"roofType" is not a target field of this model.',
  )
  await expect(schema).toContainText('Schema matching cannot run')

  // The saved rule set brings the mapping back, and both survive reopening.
  await ruleSets
    .getByRole('button', {
      name: 'Load the rule set All OSM tags',
      exact: true,
    })
    .click()
  await expect(mapping.getByRole('combobox', { name: 'Floors' })).toHaveValue(
    'building:levels',
  )
  await saveAndReopen(page)
  const reopened = await showSchema(page)
  await expect(
    reopened.getByRole('option', { name: /^All OSM tags/ }),
  ).toBeVisible()
  await expect(
    mappingOf(page).getByRole('combobox', { name: 'Height' }),
  ).toHaveValue('height')
})

test('a refused change shows on its field, and the page waits for footprints', async ({
  page,
}) => {
  const schema = await openSchema(page, 'fixture=partway&fault=rejectInput')
  const mapping = mappingOf(page)
  await mapping.getByRole('combobox', { name: 'Floors' }).selectOption('height')
  await expect(mapping).toContainText(
    'The server rejected this value (demo condition: input rejected).',
  )
  await expect(mapping.getByRole('combobox', { name: 'Floors' })).toHaveValue(
    'building:levels',
  )
  await expect(schema).toBeVisible()

  const empty = await openSchema(page, 'fixture=new')
  await expect(empty).toContainText('No source attributes yet')
  await expect(
    empty.getByRole('button', {
      name: 'Run Location setup / footprint capturing',
    }),
  ).toBeVisible()
})

test('schema matching renders in every appearance and a narrow pane without serious axe violations', async ({
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
    const schema = await openSchema(page)
    await expect(schema).toContainText('Applied by run')
    expect(await seriousViolations(page), appearance).toEqual([])
  }
  await page.setViewportSize({ width: 900, height: 900 })
  const schema = await openSchema(page)
  await expect(mappingOf(page)).toBeVisible()
  expect(await seriousViolations(page), 'narrow').toEqual([])
  await expect(schema).toBeVisible()
})
