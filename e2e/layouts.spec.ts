import { AxeBuilder } from '@axe-core/playwright'
import {
  createProjectFromStart,
  expect,
  saveAndReopen,
  test,
  type Page,
} from './test.ts'

// Saved layouts (decision 0032): personal layouts in the browser, project
// layouts saved with the project, apply, reset, delete, and broken storage.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

function layoutsDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Layouts' })
}

async function openLayouts(page: Page) {
  // The shortcut is not taken from a text field, as typing there must work.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Alt+l')
  await expect(layoutsDialog(page)).toBeVisible()
  return layoutsDialog(page)
}

async function runFromPalette(page: Page, text: string) {
  await page.keyboard.press('Control+k')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

async function saveLayout(
  page: Page,
  name: string,
  scope: 'project' | 'personal',
) {
  const dialog = await openLayouts(page)
  await dialog.getByRole('textbox', { name: 'Layout name' }).fill(name)
  const radio = dialog.getByRole('radio', {
    name:
      scope === 'project'
        ? 'With the project'
        : 'In this browser, for every project',
  })
  await radio.focus()
  await page.keyboard.press('Space')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  const list = dialog.getByRole('listbox', {
    name: scope === 'project' ? 'Project layouts' : 'Personal layouts',
  })
  await expect(
    list.getByRole('option', { name: new RegExp(name) }),
  ).toBeVisible()
  return dialog
}

const mapTab = (page: Page) =>
  page.getByRole('tab', { name: 'Map', exact: true })
const tableTab = (page: Page) =>
  page.getByRole('tab', { name: 'Table', exact: true })
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search buildings' })

test('saves a personal layout, applies it after changes, resets to it, and deletes it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/?fixture=complete')

  // Empty states first.
  let dialog = await openLayouts(page)
  await expect(dialog).toContainText('No saved layout is applied')
  await expect(dialog).toContainText('No project layouts yet.')
  await expect(dialog).toContainText('No personal layouts yet.')
  await page.keyboard.press('Escape')

  // An arrangement and a view setting to keep.
  await runFromPalette(page, 'place map beside table')
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  await search(page).fill('office')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Filtered the buildings table by "office"',
  )

  dialog = await saveLayout(page, 'Side by side', 'personal')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Saved the personal layout "Side by side" in this browser.',
  )
  await expect(dialog).toContainText('Applied: Side by side (personal)')
  expect(await seriousViolations(page)).toEqual([])
  await page.keyboard.press('Escape')

  // Change both, then apply the layout from the list with the keyboard.
  await runFromPalette(page, 'reset layout')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'false')
  await tableTab(page).click()
  await search(page).fill('')
  await mapTab(page).click()
  dialog = await openLayouts(page)
  await expect(dialog).toContainText('changed since applied')
  const option = dialog
    .getByRole('listbox', { name: 'Personal layouts' })
    .getByRole('option', { name: /Side by side/ })
  await option.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Applied the personal layout "Side by side".',
  )
  await expect(dialog).not.toContainText('changed since applied')
  await page.keyboard.press('Escape')
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(search(page)).toHaveValue('office')

  // Reset to the layout from the palette after another change.
  await search(page).fill('school')
  await expect(page.getByTestId('status-notice')).toContainText('"school"')
  await runFromPalette(page, 'reset to layout')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Reset the panels and views to the personal layout "Side by side".',
  )
  await expect(search(page)).toHaveValue('office')

  // Personal layouts stay in this browser across reloads and projects.
  await page.reload()
  dialog = await openLayouts(page)
  const personal = dialog.getByRole('listbox', { name: 'Personal layouts' })
  await personal.getByRole('option', { name: /Side by side/ }).click()
  await dialog
    .getByRole('button', { name: 'Delete the layout Side by side' })
    .click()
  // The safe choice has focus, so Enter twice keeps the layout.
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Delete layout' }).click()
  await expect(dialog).toContainText('No personal layouts yet.')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Deleted the personal layout "Side by side".',
  )
})

test('keeps project layouts and the default with the project across save and reopen', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createProjectFromStart(page, 'Layouts project')

  await runFromPalette(page, 'place map beside table')
  await expect(tableTab(page)).toHaveAttribute('aria-selected', 'true')
  const dialog = await saveLayout(page, 'Team view', 'project')
  await dialog
    .getByRole('listbox', { name: 'Project layouts' })
    .getByRole('option', { name: /Team view/ })
    .click()
  const opensWith = dialog.getByRole('checkbox', {
    name: 'Open the project with this layout',
  })
  await opensWith.focus()
  await page.keyboard.press('Space')
  await expect(opensWith).toBeChecked()
  await expect(page.getByTestId('status-notice')).toContainText(
    'The project opens with the layout "Team view".',
  )
  await page.keyboard.press('Escape')

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
  const tree = page.getByRole('treegrid', { name: 'Project assets' })
  // Arrowing through the layout rows selects nothing and opens nothing.
  await tree.getByRole('row', { name: /^Reports/ }).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    tree.getByRole('row', { name: 'Team view (default)' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(layoutsDialog(page)).toBeHidden()
  // Enter opens the Layouts dialog on the layout.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    tree.getByRole('row', { name: 'Team view (default)' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(layoutsDialog(page)).toBeVisible()
  await expect(
    layoutsDialog(page).getByRole('option', { name: /Team view/ }),
  ).toContainText('Default · Applied')
  await expect(layoutsDialog(page)).toContainText('Opens with the project')
  expect(await seriousViolations(page)).toEqual([])
})

test('explains unreadable personal layouts and recovers only when asked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('layouts-seeded')) {
      window.localStorage.setItem('eaui.layouts.v1', '{not json')
      window.sessionStorage.setItem('layouts-seeded', '1')
    }
  })
  await page.goto('/?fixture=new')
  const dialog = await openLayouts(page)
  await expect(dialog.getByRole('alert')).toContainText(
    'Personal layouts stored in this browser could not be read.',
  )
  const radio = dialog.getByRole('radio', {
    name: 'In this browser, for every project',
  })
  await radio.focus()
  await page.keyboard.press('Space')
  await dialog.getByRole('textbox', { name: 'Layout name' }).fill('Mine')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(dialog.getByRole('alert').last()).toContainText(
    'could not be read',
  )
  expect(
    await page.evaluate(() => window.localStorage.getItem('eaui.layouts.v1')),
  ).toBe('{not json')

  await dialog
    .getByRole('button', { name: 'Remove stored personal layouts' })
    .click()
  await expect(dialog).toContainText('No personal layouts yet.')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(
    dialog
      .getByRole('listbox', { name: 'Personal layouts' })
      .getByRole('option', { name: /Mine/ }),
  ).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})
