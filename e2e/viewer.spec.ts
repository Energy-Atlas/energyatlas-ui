import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from './test.ts'

// The viewer page and handover package (decision 0032, stage 5): Hand over
// in the modeller, the package list on viewer.html, a view-only shell with no
// model controls, handed-over layouts and the reset to the handed-over layout,
// package files, and the errors a viewer can meet.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function runFromPalette(page: Page, text: string) {
  await page.getByRole('main').first().focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

async function openMenu(page: Page, name: string) {
  await page
    .getByRole('toolbar', { name: 'Workbench commands' })
    .getByRole('button', { name, exact: true })
    .click()
  return page.getByRole('menu').first()
}

/** Shows the Layouts panel (decision 0033). */
async function openLayouts(page: Page) {
  const panel = page.getByRole('region', { name: 'Layouts', exact: true })
  if (await panel.isVisible()) return panel
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Alt+l')
  await expect(panel).toBeVisible()
  return panel
}

function layoutRow(panel: Locator, name: string) {
  return panel
    .getByRole('grid', { name: 'Layouts' })
    .getByRole('row', { name: new RegExp(name) })
}

/** Saves the open project in this browser. */
async function save(page: Page) {
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('Saved')
}

/** Opens File > Hand over…. */
async function openHandover(page: Page) {
  const file = await openMenu(page, 'File')
  await file.getByRole('menuitem', { name: 'Hand over…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hand over this project' })
  await expect(dialog).toContainText('Left out: held job outputs')
  return dialog
}

/**
 * Hands the open project over from File > Hand over…, saving it first unless
 * told not to: a handover packages the saved copy (decision 0032).
 */
async function handOver(page: Page, { saveFirst = true } = {}) {
  if (saveFirst) await save(page)
  const dialog = await openHandover(page)
  await dialog.getByRole('button', { name: 'Hand over the project' }).click()
  const done = page.getByRole('dialog', { name: 'Handed over' })
  await expect(done).toBeVisible()
  return done
}

const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true })

test('hands over, lists, opens, and explores a package view only', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')

  // A handover packages the saved copy, so a project never saved has none.
  const fileMenu = await openMenu(page, 'File')
  const handOverItem = fileMenu.getByRole('menuitem', { name: 'Hand over…' })
  await expect(handOverItem).toHaveAttribute('aria-disabled', 'true')
  await expect(handOverItem).toHaveAttribute('title', /Save the project first/)
  await page.keyboard.press('Escape')

  // A project layout that opens the project on Results travels with it.
  await runFromPalette(page, 'Results')
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  let panel = await openLayouts(page)
  await panel
    .getByRole('textbox', { name: 'Layout name' })
    .fill('Results first')
  await panel.getByRole('button', { name: 'Save layout' }).click()
  const opensWith = layoutRow(panel, 'Results first').getByRole('checkbox', {
    name: 'Open the project with the layout Results first',
  })
  await opensWith.locator('xpath=ancestor::label[1]').click()
  await expect(opensWith).toBeChecked()
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await save(page)

  // A layout saved after that is an unsaved change, which stays out.
  panel = await openLayouts(page)
  await panel.getByRole('textbox', { name: 'Layout name' }).fill('Not saved')
  await panel.getByRole('button', { name: 'Save layout' }).click()
  await expect(layoutRow(panel, 'Not saved')).toBeVisible()
  await page.getByRole('main', { name: 'Workspace' }).focus()
  const handover = await openHandover(page)
  await expect(handover).toContainText('Unsaved changes stay out')
  await handover.getByRole('button', { name: 'Hand over the project' }).click()
  const done = page.getByRole('dialog', { name: 'Handed over' })
  await expect(done).toBeVisible()
  await expect(done).toContainText('later unsaved changes left out')
  await expect(done).toContainText("is in this browser's handover catalog")
  await expect(done).toContainText('12 stages: 12 complete')
  await expect(
    done.getByRole('link', { name: 'Open in the viewer' }),
  ).toHaveAttribute('href', /viewer\.html\?package=handover%3A/)
  expect(await seriousViolations(page)).toEqual([])
  await page.keyboard.press('Escape')

  // The viewer lists the package; Enter on it opens it.
  await page.goto('/viewer.html')
  await expect(
    page.getByRole('heading', { name: 'Handover packages', level: 1 }),
  ).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Handover packages' })
  const option = list.getByRole('option', { name: /Synthetic district/ })
  await expect(option).toContainText('464 buildings · 2 results')
  await expect(page.getByLabel('Handover provenance')).toContainText(
    '42 job log lines',
  )
  expect(await seriousViolations(page)).toEqual([])
  await option.focus()
  await page.keyboard.press('Enter')

  // The shell: View only, the handed-over default layout applied.
  await expect(page.getByText('View only').first()).toBeVisible()
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('handover-status')).toContainText('Handed over')

  // Model controls are left out, not shown disabled.
  const commands = page.getByRole('toolbar', { name: 'Workbench commands' })
  for (const name of ['Run', 'Edit']) {
    await expect(
      commands.getByRole('button', { name, exact: true }),
    ).toHaveCount(0)
  }
  await expect(commands.getByRole('button', { name: /^Run/ })).toHaveCount(0)
  const file = await openMenu(page, 'File')
  await expect(file.getByRole('menuitem')).toHaveText([
    'Open package file…Ctrl+O',
    'Handover packages…',
    'About this handover…',
  ])
  await page.keyboard.press('Escape')
  for (const name of ['Roadmap', 'Scenarios', 'Jobs']) {
    await expect(tab(page, name)).toHaveCount(0)
  }

  // View changes work: the table's search and a result drill-down.
  await tab(page, 'Table').click()
  const table = page.getByRole('region', { name: 'Table' })
  await expect(
    table.getByRole('button', { name: 'Apply pending edits' }),
  ).toHaveCount(0)
  await expect(table).toContainText('cells cannot be edited')
  await table.getByRole('searchbox', { name: 'Search buildings' }).fill('b-1')
  await expect(page.getByTestId('status-notice')).toContainText('b-1')
  await tab(page, 'Dashboard').click()
  await expect(
    page.getByRole('button', { name: /^Apply \d+% adoption/ }),
  ).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])

  // The handed-over layouts apply only; saving and changing are left out.
  panel = await openLayouts(page)
  await expect(panel).toContainText('Handed over with the package.')
  await expect(layoutRow(panel, 'Not saved')).toHaveCount(0)
  const row = layoutRow(panel, 'Results first')
  await expect(row.getByRole('button')).toHaveCount(1)
  await expect(
    row.getByRole('button', { name: 'Apply the layout Results first' }),
  ).toBeVisible()
  await expect(row.getByRole('checkbox')).toHaveCount(0)
  await expect(panel.getByRole('textbox', { name: 'Layout name' })).toHaveCount(
    0,
  )
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await runFromPalette(page, 'Reset to handed-over layout')
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  await tab(page, 'Table').click()
  await expect(
    page.getByRole('searchbox', { name: 'Search buildings' }),
  ).toHaveValue('')

  // The agent answers questions and refuses model changes.
  if ((await tab(page, 'Reasoning').getAttribute('aria-selected')) !== 'true')
    await tab(page, 'Reasoning').click()
  const agent = page.getByRole('region', { name: 'Reasoning' })
  await agent
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Rerun the baseline with heat pumps')
  await agent
    .getByRole('button', { name: 'Queue message', exact: true })
    .click()
  const transcript = agent.getByRole('log', { name: 'Agent transcript' })
  await expect(transcript).toContainText('view-only handover')
  // Permission modes govern model changes, which the viewer never makes.
  await expect(
    agent.getByRole('button', { name: /^Permission mode/ }),
  ).toHaveCount(0)
  await agent
    .getByRole('button', {
      name: 'Start session: Explain the published results',
    })
    .click()
  await expect(transcript).toContainText('uses the most', { timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible()
})

test('opens a downloaded package file and refuses invalid files', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const done = await handOver(page)
  const downloading = page.waitForEvent('download')
  await done
    .getByRole('button', { name: /^Download the handover package/ })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^synthetic-district-demo-\d{4}-\d{2}-\d{2}\.handover\.json$/,
  )
  const path = await download.path()
  const text = await readFile(path, 'utf8')

  // The modeller can remove packages to free storage; the file stays usable.
  const kept = done.getByRole('listbox', {
    name: 'Handover packages in this browser',
  })
  await expect(kept.getByRole('option')).toHaveCount(1)
  await done
    .getByRole('button', { name: /^Remove the handover package/ })
    .click()
  await expect(done.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await done.getByRole('button', { name: 'Remove package' }).click()
  await expect(done).toContainText('No packages kept here yet.')

  await page.goto('/viewer.html')
  const input = page.locator('#viewer-package-file')
  const error = page.getByRole('alert')

  await input.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text.slice(0, 200)),
  })
  await expect(error).toContainText('not valid JSON')
  await input.setInputFiles({
    name: 'newer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...JSON.parse(text), version: 9 })),
  })
  await expect(error).toContainText('newer version of EnergyAtlas')
  await input.setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"title":"notes"}'),
  })
  await expect(error).toContainText('not an EnergyAtlas handover package')
  expect(await seriousViolations(page)).toEqual([])

  await input.setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await runFromPalette(page, 'About this handover')
  const about = page.getByRole('dialog', { name: /^About/ })
  await expect(about).toContainText(download.suggestedFilename())
  await page.keyboard.press('Escape')

  // Back to the list from the File menu.
  const file = await openMenu(page, 'File')
  await file.getByRole('menuitem', { name: 'Handover packages…' }).click()
  await expect(
    page.getByRole('heading', { name: 'Handover packages', level: 1 }),
  ).toBeVisible()
})

test('shows loading, empty, and warning states; nothing offers a run', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/viewer.html?latency=slow')
  await expect(page.getByText('Loading handover packages…')).toBeVisible()
  await expect(
    page.getByText('No handover packages in this browser'),
  ).toBeVisible({ timeout: 10_000 })

  // A project with no results hands over with a warning.
  await page.goto('/?fixture=partway')
  const done = await handOver(page)
  await expect(done).toContainText('no published results')
  await page.keyboard.press('Escape')
  await page.goto('/viewer.html')
  await page
    .getByRole('listbox', { name: 'Handover packages' })
    .getByRole('option')
    .first()
    .press('Enter')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await expect(
    page.getByText(/This package has no published results/).first(),
  ).toBeVisible()
  await tab(page, 'Results').click()
  const results = page.getByRole('region', { name: 'Results' })
  await expect(results).toContainText(
    'This handover package does not include it',
  )
  await expect(results.getByRole('button', { name: /^Run/ })).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
})

test('keeps the package for download when browser storage is full', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(
      Storage.prototype,
      'setItem',
    )?.value as (this: Storage, key: string, value: string) => void
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'eaui.handovers.v1')
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await page.goto('/?fixture=complete')
  const done = await handOver(page)
  await expect(done).toContainText('Not kept in this browser')
  await expect(done).toContainText('Browser storage is full')
  await expect(
    done.getByRole('button', { name: /^Download the handover package/ }),
  ).toBeVisible()
  await expect(
    done.getByRole('link', { name: 'Open in the viewer' }),
  ).toHaveCount(0)
})
