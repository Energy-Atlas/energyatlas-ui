import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// The viewer page and handover package (decision 0032, stage 5): Hand over
// in the modeller, the package list on viewer.html, a view-only shell with no
// model controls, personal layouts and the reset to the handed-over layout,
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

async function openLayouts(page: Page) {
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Alt+l')
  const dialog = page.getByRole('dialog', { name: 'Layouts' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Hands the open project over from File > Hand over…. */
async function handOver(page: Page) {
  const file = await openMenu(page, 'File')
  await file.getByRole('menuitem', { name: 'Hand over…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hand over this project' })
  await expect(dialog).toContainText('Left out: held job outputs')
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

  // A project layout that opens the project on Results travels with it.
  await runFromPalette(page, 'Results')
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  let dialog = await openLayouts(page)
  await dialog
    .getByRole('textbox', { name: 'Layout name' })
    .fill('Results first')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await dialog
    .getByRole('listbox', { name: 'Project layouts' })
    .getByRole('option', { name: /Results first/ })
    .click()
  const opensWith = dialog.getByRole('checkbox', {
    name: 'Open the project with this layout',
  })
  await opensWith.focus()
  await page.keyboard.press('Space')
  await expect(opensWith).toBeChecked()
  await page.keyboard.press('Escape')

  const done = await handOver(page)
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
  for (const name of ['Roadmap', 'Measures and scenarios', 'Jobs']) {
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

  // A personal layout for this package, then back to the handed-over one.
  dialog = await openLayouts(page)
  await expect(
    dialog.getByRole('heading', { name: 'Handed-over layouts' }),
  ).toBeVisible()
  await dialog
    .getByRole('listbox', { name: 'Project layouts' })
    .getByRole('option', { name: /Results first/ })
    .click()
  const actions = dialog.getByRole('toolbar', {
    name: 'Actions for the layout Results first',
  })
  await expect(actions.getByRole('button')).toHaveText([
    'Apply',
    'Copy to personal',
  ])
  await dialog.getByRole('textbox', { name: 'Layout name' }).fill('Mine')
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(
    dialog
      .getByRole('listbox', { name: 'Personal layouts' })
      .getByRole('option', { name: /Mine/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await runFromPalette(page, 'Reset to handed-over layout')
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  await tab(page, 'Table').click()
  await expect(
    page.getByRole('searchbox', { name: 'Search buildings' }),
  ).toHaveValue('')
  dialog = await openLayouts(page)
  await expect(
    dialog
      .getByRole('listbox', { name: 'Personal layouts' })
      .getByRole('option', { name: /Mine/ }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()

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
