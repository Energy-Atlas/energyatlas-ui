import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, toast, type Locator, type Page } from './test.ts'

// Views and the viewer page (decision 0032, stage 5; decision 0036): File >
// Save as… > View in the modeller, the viewer's start page on viewer.html, the
// editor's shell with everything a view cannot do unavailable, the view's
// layouts and the reset to them, view files, warnings as messages, and the
// errors a viewer can meet.

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

/** Opens File > Save as… with View chosen. */
async function openSaveAsView(page: Page) {
  const file = await openMenu(page, 'File')
  await file.getByRole('menuitem', { name: /^Save as/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as' })
  await dialog.getByText('View', { exact: true }).click()
  await expect(dialog).toContainText('Left out: held job outputs')
  return dialog
}

/**
 * Saves the open project as a view from File > Save as…, saving it first
 * unless told not to: a view holds the saved copy (decision 0032).
 */
async function saveAsView(page: Page, { saveFirst = true } = {}) {
  if (saveFirst) await save(page)
  const dialog = await openSaveAsView(page)
  await dialog.getByRole('button', { name: 'Save as a view' }).click()
  await expect(dialog).toContainText("is in this browser's list of views")
  return dialog
}

const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true })

test('saves a view, lists it on the start page, and explores it in the editor shell', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')

  // A view holds the saved copy, so a project never saved has none yet.
  let dialog = await openSaveAsView(page)
  await expect(dialog).toContainText('Save the project first')
  await expect(
    dialog.getByRole('button', { name: 'Save as a view' }),
  ).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')

  // A project layout that opens the project on Results goes with the view.
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
  dialog = await openSaveAsView(page)
  await expect(dialog).toContainText('Unsaved changes stay out')
  expect(await seriousViolations(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Save as a view' }).click()
  await expect(dialog).toContainText("is in this browser's list of views")
  await expect(dialog).toContainText('later unsaved changes left out')
  await expect(dialog).toContainText('12 stages: 12 complete')
  await expect(
    dialog.getByRole('link', { name: 'Open in the viewer' }),
  ).toHaveAttribute('href', /viewer\.html\?package=handover%3A/)
  await page.keyboard.press('Escape')

  // The start page lists the view; Enter on it opens it.
  await page.goto('/viewer.html')
  await expect(
    page.getByRole('heading', { name: 'Views', level: 1 }),
  ).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Views in this browser' })
  const option = list.getByRole('option', { name: /Synthetic district/ })
  await expect(option).toContainText('464 buildings · 2 results')
  await expect(page.getByLabel('View provenance')).toContainText(
    '42 job log lines',
  )
  // Laid out as the project start screen: two lists side by side.
  const sections = page.locator('main section')
  await expect(sections).toHaveCount(2)
  const [left, right] = [
    await sections.nth(0).boundingBox(),
    await sections.nth(1).boundingBox(),
  ]
  expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1)
  expect(await seriousViolations(page)).toEqual([])
  await option.focus()
  await page.keyboard.press('Enter')

  // The shell: the view's default layout, View only in the status bar.
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  const status = page.getByRole('contentinfo', { name: 'Status bar' })
  await expect(status.getByText('View only')).toBeVisible()
  await expect(status).toContainText('Synthetic district (demo)')
  await expect(page.getByTestId('handover-status')).toContainText('View saved')
  // No title in the top bar; the account button as in the editor.
  const ribbon = page.getByRole('banner')
  await expect(ribbon.getByText('View only')).toHaveCount(0)
  await expect(ribbon.getByRole('button', { name: /^Account/ })).toBeVisible()

  // All five menus; what a view cannot do is unavailable and says why.
  const commands = page.getByRole('toolbar', { name: 'Workbench commands' })
  for (const name of ['File', 'Edit', 'View', 'Run', 'Help']) {
    await expect(
      commands.getByRole('button', { name, exact: true }),
    ).toBeVisible()
  }
  const run = commands.getByRole('button', { name: 'Run current stage' })
  await expect(run).toHaveAttribute('aria-disabled', 'true')
  await expect(run).toHaveAttribute('title', /runs nothing/)
  await expect(
    commands.getByRole('button', { name: 'Save project in this browser' }),
  ).toHaveAttribute('aria-disabled', 'true')
  const edit = await openMenu(page, 'Edit')
  const undo = edit.getByRole('menuitem', { name: /^Undo/ })
  await expect(undo).toHaveAttribute('aria-disabled', 'true')
  await expect(undo).toHaveAttribute('title', /nothing in it can be changed/)
  await page.keyboard.press('Escape')
  const file = await openMenu(page, 'File')
  await expect(file.getByRole('menuitem').first()).toHaveText(
    'Open view file…Ctrl+O',
  )
  await expect(
    file.getByRole('menuitem', { name: /^Save as/ }),
  ).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  // Pressing an unavailable control reports why instead of doing nothing.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('status-notice')).toContainText(
    'it is not saved again',
  )
  // The status bar keeps Issues and Jobs, unavailable here.
  const jobs = status.getByRole('button', { name: /active jobs/ })
  await expect(jobs).toHaveAttribute('aria-disabled', 'true')
  // Unavailable controls stay focusable and say why when pressed.
  await jobs.click({ force: true })
  await expect(page.getByTestId('status-notice')).toContainText(
    'The viewer has no Jobs page',
  )
  for (const name of ['Roadmap', 'Scenarios', 'Jobs']) {
    await expect(tab(page, name)).toHaveCount(0)
  }
  // The refusals stay as toasts until dismissed; clear them off the panels.
  for (const text of ['not saved again', 'no Jobs page']) {
    await toast(page, text)
      .getByRole('button', { name: /^Dismiss/ })
      .click()
  }
  expect(await seriousViolations(page)).toEqual([])

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

  // The view's layouts apply only; Default shows but cannot change.
  panel = await openLayouts(page)
  await expect(panel).toContainText('Kept with the view.')
  await expect(layoutRow(panel, 'Not saved')).toHaveCount(0)
  const row = layoutRow(panel, 'Results first')
  await expect(row.getByRole('button')).toHaveCount(1)
  await expect(
    row.getByRole('button', { name: 'Apply the layout Results first' }),
  ).toBeVisible()
  const opensWithView = row.getByRole('checkbox', {
    name: 'The view opens with the layout Results first',
  })
  await expect(opensWithView).toBeChecked()
  await expect(opensWithView).toHaveAttribute('aria-readonly', 'true')
  await expect(panel.getByRole('textbox', { name: 'Layout name' })).toHaveCount(
    0,
  )
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await runFromPalette(page, "Reset to the view's layout")
  await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
  await tab(page, 'Table').click()
  await expect(
    page.getByRole('searchbox', { name: 'Search buildings' }),
  ).toHaveValue('')

  // The agent has the editor's controls; every mode allows everything.
  if ((await tab(page, 'Reasoning').getAttribute('aria-selected')) !== 'true')
    await tab(page, 'Reasoning').click()
  const agent = page.getByRole('region', { name: 'Reasoning' })
  const modes = agent.getByRole('button', { name: /^Permission mode/ })
  await expect(modes).toBeVisible()
  // From the keyboard, as toasts from the refusals above may cover it.
  await modes.focus()
  await page.keyboard.press('Enter')
  const bypass = page.getByRole('menuitemradio', { name: /^Bypass approval/ })
  await expect(bypass).toContainText('In a view nothing waits')
  await page.keyboard.press('Escape')
  await agent
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Rerun the baseline with heat pumps')
  await agent
    .getByRole('button', { name: 'Queue message', exact: true })
    .click()
  const transcript = agent.getByRole('log', { name: 'Agent transcript' })
  await expect(transcript).toContainText('This is a view')
  await agent
    .getByRole('button', {
      name: 'Start session: Explain the published results',
    })
    .click()
  await expect(transcript).toContainText('uses the most', { timeout: 20_000 })
  await expect(transcript).not.toContainText('Waiting for your approval')
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible()
})

test('opens a downloaded view file and refuses invalid files', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const done = await saveAsView(page)
  const downloading = page.waitForEvent('download')
  await done.getByRole('button', { name: /^Download the view file/ }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^synthetic-district-demo-\d{4}-\d{2}-\d{2}\.view\.json$/,
  )
  const path = await download.path()
  const text = await readFile(path, 'utf8')

  // The modeller can remove views to free storage, after confirming.
  const kept = done.getByRole('listbox', { name: 'Views in this browser' })
  await expect(kept.getByRole('option')).toHaveCount(1)
  await done.getByRole('button', { name: /^Remove the view/ }).click()
  const confirm = page.getByRole('alertdialog', {
    name: /^Remove the view "Synthetic district \(demo\)"/,
  })
  await expect(
    confirm.getByRole('button', { name: 'Remove view' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(done).toContainText('No views kept here yet.')

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
  await expect(error).toContainText('not an EnergyAtlas view')
  expect(await seriousViolations(page)).toEqual([])

  // A file saved before views had their name still opens (decision 0036).
  await input.setInputFiles({
    name: 'synthetic-district-demo-2026-10-28.handover.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await runFromPalette(page, 'About this view')
  const about = page.getByRole('dialog', { name: /^About/ })
  await expect(about).toContainText(
    'synthetic-district-demo-2026-10-28.handover.json',
  )
  await page.keyboard.press('Escape')

  // Back to the start page from the File menu.
  const file = await openMenu(page, 'File')
  await file.getByRole('menuitem', { name: 'Views…' }).click()
  await expect(
    page.getByRole('heading', { name: 'Views', level: 1 }),
  ).toBeVisible()
})

test('shows loading, empty, and warning states as messages; nothing offers a run', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/viewer.html?latency=slow')
  await expect(page.getByText('Loading views…')).toBeVisible()
  await expect(page.getByText('No views in this browser')).toBeVisible({
    timeout: 10_000,
  })

  // A project with no results saves as a view with a warning.
  await page.goto('/?fixture=partway')
  const done = await saveAsView(page)
  await expect(done).toContainText('no published results')
  await page.keyboard.press('Escape')
  await page.goto('/viewer.html')
  await page
    .getByRole('listbox', { name: 'Views in this browser' })
    .getByRole('option')
    .first()
    .press('Enter')
  const main = page.getByRole('main', { name: 'Workspace' })
  await expect(main).toBeVisible()
  // The warning is a message, not a band that pushes the workspace down.
  await expect(
    toast(page, /This view has no published results/),
  ).toHaveAttribute('data-tone', 'warning')
  const ribbonBox = await page.getByRole('banner').boundingBox()
  const mainBox = await main.boundingBox()
  expect(mainBox!.y).toBeLessThanOrEqual(ribbonBox!.y + ribbonBox!.height + 1)
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Alt+m')
  await expect(
    page.getByRole('region', { name: 'Messages', exact: true }),
  ).toContainText('This view has no published results')
  await tab(page, 'Results').click()
  const results = page.getByRole('region', { name: 'Results' })
  await expect(results).toContainText('This view does not include it')
  await expect(results.getByRole('button', { name: /^Run/ })).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])

  // A view without layouts: a wrapping empty state in viewer wording.
  const layouts = await openLayouts(page)
  await expect(layouts).toContainText(
    'No layout of the view is applied; the panels are arranged as the view opened.',
  )
  const empty = layouts.getByText('This view was saved without layouts.')
  await expect(empty).toBeVisible()
  await expect(layouts.getByRole('grid')).toHaveCount(0)
  const emptyBox = await empty.boundingBox()
  const layoutsBox = await layouts.boundingBox()
  expect(emptyBox!.x + emptyBox!.width).toBeLessThanOrEqual(
    layoutsBox!.x + layoutsBox!.width + 1,
  )

  // An asset without a page in the viewer says so in a note, not a failure.
  const assetsTab = tab(page, 'Assets')
  if ((await assetsTab.getAttribute('aria-selected')) !== 'true') {
    await assetsTab.click()
  }
  const tree = page.getByRole('treegrid', { name: 'Project assets' })
  const rules = tree.getByRole('row', { name: 'Attribute mapping rules' })
  await rules.click()
  await page.keyboard.press('Enter')
  await expect(
    toast(page, 'Attribute mapping rules has no page'),
  ).toHaveAttribute('data-tone', 'info')
  await rules.dblclick()
  await expect(rules).toHaveAttribute('aria-selected', 'true')
})

test('removes a view from the start page after confirming', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  await saveAsView(page)
  await page.keyboard.press('Escape')
  await page.goto('/viewer.html')
  const remove = page.getByRole('button', { name: /^Remove the view/ })
  await remove.click()
  const confirm = page.getByRole('alertdialog', { name: /^Remove the view/ })
  // Escape keeps it, and focus returns to the button.
  await expect(
    confirm.getByRole('button', { name: 'Remove view' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(remove).toBeFocused()
  await remove.click()
  expect(await seriousViolations(page)).toEqual([])
  await confirm.getByRole('button', { name: 'Remove view' }).click()
  await expect(page.getByText('No views in this browser yet')).toBeVisible()
  // The last view is gone, so focus goes to the page heading, not the body.
  await expect(
    page.getByRole('heading', { name: 'Views', level: 1 }),
  ).toBeFocused()
})

test('saves a view again after a view', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const dialog = await saveAsView(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const again = await openSaveAsView(page)
  await again.getByRole('button', { name: 'Save as a view' }).click()
  await expect(again).toContainText("is in this browser's list of views")
})

test('shows an unreadable list of views without an empty search', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eaui.handovers.v1', '{not json')
  })
  await page.goto('/viewer.html')
  await expect(page.getByRole('main')).toContainText(
    'The list of views stored in this browser could not be read.',
  )
  await expect(page.getByRole('main')).toContainText(
    'No views can be listed until the list is read.',
  )
  await expect(page.getByText(/Nothing matches/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('button', { name: 'Open view file…' }),
  ).toBeVisible()
})

test('keeps the view for download when browser storage is full', async ({
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
  await save(page)
  const dialog = await openSaveAsView(page)
  await dialog.getByRole('button', { name: 'Save as a view' }).click()
  await expect(dialog).toContainText('Not kept in this browser')
  await expect(dialog).toContainText('Browser storage is full')
  await expect(
    dialog.getByRole('button', { name: /^Download the view file/ }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: 'Open in the viewer' }),
  ).toHaveCount(0)
})
