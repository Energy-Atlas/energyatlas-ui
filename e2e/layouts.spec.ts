import { AxeBuilder } from '@axe-core/playwright'
import {
  createProjectFromStart,
  expect,
  saveAndReopen,
  test,
  type Page,
} from './test.ts'

// Saved layouts (decisions 0032, 0033, and 0036): kept with the project only
// and managed in the Layouts panel, whose table holds each layout's name, its
// actions, and Default; the chosen layout's other details sit under the
// table. View > Layouts > Save layout… asks for a name in a prompt, Rename
// asks in a prompt too, and Delete asks in the confirmation dialog.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

function layoutsPanel(page: Page) {
  return page.getByRole('region', { name: 'Layouts', exact: true })
}

async function openLayouts(page: Page) {
  if (await layoutsPanel(page).isVisible()) return layoutsPanel(page)
  // The shortcut is not taken from a text field, as typing there must work.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Alt+l')
  await expect(layoutsPanel(page)).toBeVisible()
  return layoutsPanel(page)
}

async function runFromPalette(page: Page, text: string) {
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+k')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Saves from the panel's own form: a name, then Save layout. */
async function saveFromPanel(page: Page, name: string) {
  const panel = await openLayouts(page)
  await panel.getByRole('textbox', { name: 'Layout name' }).fill(name)
  await panel.getByRole('button', { name: 'Save layout' }).click()
  await expect(layoutRow(page, name)).toBeVisible()
  return panel
}

/** The chosen layout's details under the table. */
function details(page: Page, name: string) {
  return layoutsPanel(page).getByLabel(`Details of the layout ${name}`)
}

function layoutRow(page: Page, name: string) {
  return layoutsPanel(page)
    .getByRole('grid', { name: 'Layouts' })
    .getByRole('row', { name: new RegExp(name) })
}

/** Chooses Update, Rename…, Duplicate, or Delete… from a layout row's menu. */
async function rowAction(page: Page, name: string, action: string) {
  await layoutRow(page, name)
    .getByRole('button', { name: `More actions for the layout ${name}` })
    .click()
  await page.getByRole('menuitem', { name: new RegExp(`^${action}`) }).click()
}

const mapTab = (page: Page) =>
  page.getByRole('tab', { name: 'Map', exact: true })
const tableTab = (page: Page) =>
  page.getByRole('tab', { name: 'Table', exact: true })
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search buildings' })
const notice = (page: Page) => page.getByTestId('status-notice')

test('saves a layout in the panel, applies it after changes, resets to it, and deletes it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')

  // Empty states first.
  let panel = await openLayouts(page)
  await expect(panel).toContainText('No saved layout is applied')
  await expect(panel).toContainText('No layouts yet.')
  // A name is required.
  await panel.getByRole('button', { name: 'Save layout' }).click()
  await expect(panel).toContainText('Enter a layout name.')

  // An arrangement and a view setting to keep.
  await runFromPalette(page, 'place map beside table')
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  await search(page).fill('office')
  await expect(notice(page)).toContainText(
    'Filtered the buildings table by "office"',
  )

  panel = await saveFromPanel(page, 'Side by side')
  await expect(notice(page)).toContainText(
    'Saved the layout "Side by side". Save the project to keep it.',
  )
  await expect(panel).toContainText('Applied: Side by side')
  // The table holds Name, its actions, and Default; the rest is the details.
  await expect(
    panel.getByRole('grid', { name: 'Layouts' }).getByRole('columnheader'),
  ).toHaveText([/^Name/, /^Actions/, /^Default/])
  await expect(details(page, 'Side by side')).toContainText('StateApplied')
  await expect(details(page, 'Side by side')).toContainText('Saved byA person')
  await expect(details(page, 'Side by side')).toContainText('Created')
  await expect(details(page, 'Side by side')).toContainText('Updated')
  expect(await seriousViolations(page)).toEqual([])

  // A taken name is refused at the field.
  await panel.getByRole('textbox', { name: 'Layout name' }).fill('side by side')
  await panel.getByRole('button', { name: 'Save layout' }).click()
  await expect(panel).toContainText('already exists')
  await panel.getByRole('textbox', { name: 'Layout name' }).fill('')

  // Change both, then apply the layout from its row.
  await runFromPalette(page, 'reset layout')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'false')
  await tableTab(page).click()
  await search(page).fill('')
  await mapTab(page).click()
  panel = await openLayouts(page)
  await expect(panel).toContainText('changed since applied')
  await layoutRow(page, 'Side by side')
    .getByRole('button', { name: 'Apply the layout Side by side' })
    .click()
  await expect(notice(page)).toContainText('Applied the layout "Side by side".')
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(search(page)).toHaveValue('office')

  // Reset to the layout from the palette after another change.
  await search(page).fill('school')
  await expect(notice(page)).toContainText('"school"')
  await runFromPalette(page, 'reset to layout')
  await expect(notice(page)).toContainText(
    'Reset the panels and views to the layout "Side by side".',
  )
  await expect(search(page)).toHaveValue('office')

  // Delete from the row, confirmed in the dialog: Enter deletes.
  panel = await openLayouts(page)
  await rowAction(page, 'Side by side', 'Delete')
  const confirm = page.getByRole('alertdialog', {
    name: 'Delete "Side by side"?',
  })
  await expect(
    confirm.getByRole('button', { name: 'Delete layout' }),
  ).toBeFocused()
  expect(await seriousViolations(page)).toEqual([])
  await page.keyboard.press('Enter')
  await expect(confirm).toBeHidden()
  await expect(panel).toContainText('No layouts yet.')
  await expect(notice(page)).toContainText('Deleted the layout "Side by side".')
})

test('renames, duplicates, and updates layouts from their rows', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const panel = await saveFromPanel(page, 'Draft')

  await rowAction(page, 'Draft', 'Rename')
  const rename = page
    .getByRole('dialog', { name: 'Rename layout' })
    .getByRole('textbox', { name: /New name for/ })
  await expect(rename).toBeFocused()
  await rename.fill('Review')
  await page.keyboard.press('Enter')
  await expect(notice(page)).toContainText(
    'Renamed the layout "Draft" to "Review".',
  )
  await expect(layoutRow(page, 'Review')).toBeVisible()

  await rowAction(page, 'Review', 'Duplicate')
  await expect(notice(page)).toContainText(
    'Duplicated the layout "Review" as "Review copy".',
  )
  await expect(
    panel.getByRole('grid', { name: 'Layouts' }).getByRole('row'),
  ).toHaveCount(3)

  await tableTab(page).click()
  await search(page).fill('office')
  // The search reports itself after a pause; wait so it cannot replace the next notice.
  await expect(notice(page)).toContainText('"office"')
  await rowAction(page, 'Review copy', 'Update')
  await expect(notice(page)).toContainText(
    'Updated the layout "Review copy" with the current panels and views.',
  )
  await expect(details(page, 'Review copy')).toContainText('StateApplied')
})

test('marks a layout chosen in the tree until another is applied, and keeps focus on the row after rename and delete', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')
  const panel = await saveFromPanel(page, 'Alpha')
  await saveFromPanel(page, 'Beta')
  const current = (name: string) =>
    panel.getByRole('row', { name: `${name} (current)` })
  await expect(current('Beta')).toBeVisible()

  // Choosing Alpha in the asset tree marks its row; applying Beta marks Beta.
  const assetsTab = page.getByRole('tab', { name: 'Assets', exact: true })
  if ((await assetsTab.getAttribute('aria-selected')) !== 'true') {
    await assetsTab.click()
  }
  const tree = page.getByRole('treegrid', { name: 'Project assets' })
  await tree.getByRole('row', { name: 'Alpha', exact: true }).click()
  await page.keyboard.press('Enter')
  await expect(current('Alpha')).toBeVisible()
  await layoutRow(page, 'Beta')
    .getByRole('button', { name: 'Apply the layout Beta' })
    .click()
  await expect(current('Beta')).toBeVisible()
  await expect(current('Alpha')).toHaveCount(0)

  // Escape cancels Rename; focus goes back to the row's actions menu.
  const menu = (name: string) =>
    layoutRow(page, name).getByRole('button', {
      name: `More actions for the layout ${name}`,
    })
  const prompt = page.getByRole('dialog', { name: 'Rename layout' })
  await rowAction(page, 'Beta', 'Rename')
  const rename = prompt.getByRole('textbox', { name: /New name for/ })
  await expect(rename).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(rename).toHaveCount(0)
  await expect(menu('Beta')).toBeFocused()
  // Cancel and a saved rename do the same.
  await rowAction(page, 'Beta', 'Rename')
  await prompt.getByRole('button', { name: 'Cancel' }).click()
  await expect(menu('Beta')).toBeFocused()
  await rowAction(page, 'Beta', 'Rename')
  await rename.fill('Gamma')
  await page.keyboard.press('Enter')
  await expect(menu('Gamma')).toBeFocused()

  // Cancel and Escape keep the layout and return to its menu.
  const confirm = page.getByRole('alertdialog', { name: 'Delete "Gamma"?' })
  await rowAction(page, 'Gamma', 'Delete')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(menu('Gamma')).toBeFocused()
  await rowAction(page, 'Gamma', 'Delete')
  await expect(
    confirm.getByRole('button', { name: 'Delete layout' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(menu('Gamma')).toBeFocused()
  await expect(layoutRow(page, 'Gamma')).toHaveCount(1)
  // The confirmation never pushes the table down: it is a dialog.
  const grid = panel.getByRole('grid', { name: 'Layouts' })
  const before = await grid.boundingBox()
  await rowAction(page, 'Gamma', 'Delete')
  await expect(confirm).toBeVisible()
  expect((await grid.boundingBox())!.y).toBe(before!.y)
  // Once deleted, focus stays in the table.
  await confirm.getByRole('button', { name: 'Delete layout' }).click()
  await expect(layoutRow(page, 'Gamma')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.closest('[role="grid"]')?.ariaLabel ?? null,
      ),
    )
    .toBe('Layouts')
})

test("shows a chosen layout's details under the table, with times", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-10-29T09:30:00') })
  await page.goto('/?fixture=complete')
  await saveFromPanel(page, 'Morning')
  await page.clock.setSystemTime(new Date('2026-10-29T10:05:00'))
  await saveFromPanel(page, 'Later')
  // The applied layout is chosen; clicking a row chooses another.
  await expect(details(page, 'Later')).toContainText('StateApplied')
  await layoutRow(page, 'Morning').getByRole('rowheader').click()
  await expect(details(page, 'Morning')).toContainText('StateNot applied')
  await expect(details(page, 'Morning')).toContainText('DefaultNo')
  await expect(details(page, 'Morning')).toContainText(/Created.*9:30/)
  // Times left the table, so the side panel never scrolls sideways for them.
  const grid = layoutsPanel(page).getByRole('grid', { name: 'Layouts' })
  await expect(
    grid.getByRole('columnheader', { name: /^Updated/ }),
  ).toHaveCount(0)
})

test('saves from the View menu prompt and keeps layouts and the default with the project', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createProjectFromStart(page, 'Layouts project')

  await runFromPalette(page, 'place map beside table')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  // View > Layouts > Save layout… asks for the name in a prompt.
  await page
    .getByRole('toolbar', { name: 'Workbench commands' })
    .getByRole('button', { name: 'View', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Layouts', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Save layout/ }).click()
  const prompt = page.getByRole('dialog', { name: 'Save layout' })
  await expect(
    prompt.getByRole('textbox', { name: 'Layout name' }),
  ).toBeFocused()
  expect(await seriousViolations(page)).toEqual([])
  await page.keyboard.type('Team view')
  await page.keyboard.press('Enter')
  await expect(prompt).toBeHidden()
  await expect(notice(page)).toContainText('Saved the layout "Team view".')

  const panel = await openLayouts(page)
  const opensWith = layoutRow(page, 'Team view').getByRole('checkbox', {
    name: 'Open the project with the layout Team view',
  })
  // Focus entering the table lands on the row first, as React Aria's grid does.
  await opensWith.locator('xpath=ancestor::label[1]').click()
  await expect(opensWith).toBeChecked()
  await expect(notice(page)).toContainText(
    'The project opens with the layout "Team view".',
  )

  // A different arrangement before saving: reopening restores the default.
  await runFromPalette(page, 'reset layout')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'false')
  await saveAndReopen(page)
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true')
  const status = page.getByRole('contentinfo', { name: 'Status bar' })
  await expect(status).not.toContainText('unsaved changes')

  // The project's layouts are View assets in the asset tree.
  const assetsTab = page.getByRole('tab', { name: 'Assets', exact: true })
  if ((await assetsTab.getAttribute('aria-selected')) !== 'true') {
    await assetsTab.click()
  }
  const layoutsTab = page.getByRole('tab', { name: 'Layouts', exact: true })
  if ((await layoutsTab.getAttribute('aria-selected')) === 'true') {
    await layoutsTab.click()
  }
  await expect(panel).toBeHidden()
  const tree = page.getByRole('treegrid', { name: 'Project assets' })
  // Arrowing through the layout rows opens nothing.
  await tree.getByRole('row', { name: /^Reports/ }).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    tree.getByRole('row', { name: 'Team view (default)' }),
  ).toBeFocused()
  await expect(panel).toBeHidden()
  // Enter shows the Layouts panel with the layout marked.
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await expect(layoutRow(page, 'Team view').getByRole('checkbox')).toBeChecked()
  await expect(details(page, 'Team view')).toContainText('StateApplied')
  await expect(details(page, 'Team view')).toContainText(
    'DefaultOpens with the project',
  )
  expect(await seriousViolations(page)).toEqual([])
})
