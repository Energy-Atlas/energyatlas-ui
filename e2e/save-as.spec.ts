import { readFile } from 'node:fs/promises'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, toast, type Page } from './test.ts'

// Decision 0036: File > Save as… > Project keeps an editable copy as a new
// project in this browser and as a project file, which the start screen
// opens again; confirmations are one modal dialog, everywhere.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

const status = (page: Page) =>
  page.getByRole('contentinfo', { name: 'Status bar' })

test('saves a project copy, downloads it, opens the copy, and opens the file again', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/?fixture=complete')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()

  // Ctrl+Shift+S opens Save as with Project chosen and the name to edit.
  await page.getByRole('main', { name: 'Workspace' }).focus()
  await page.keyboard.press('Control+Shift+S')
  const dialog = page.getByRole('dialog', { name: 'Save as' })
  await expect(dialog.getByRole('radio', { name: /^Project/ })).toBeChecked()
  const name = dialog.getByRole('textbox', { name: 'Project name' })
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('Synthetic district (demo) copy')
  await expect(dialog).toContainText('unsaved changes included')
  expect(await seriousViolations(page)).toEqual([])

  // A name is required, at the field.
  await name.fill(' ')
  await dialog.getByRole('button', { name: 'Save project copy' }).click()
  await expect(
    dialog.getByRole('textbox', { name: 'Project name' }),
  ).toHaveAttribute('aria-invalid', 'true')
  await name.fill('District study B')
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText(
    '"District study B" is a new project in this browser.',
  )
  await expect(page.getByTestId('status-notice')).toContainText(
    'Saved a copy of "Synthetic district (demo)" as the project "District study B"',
  )
  // The open project stays open.
  await expect(status(page)).toContainText('Synthetic district (demo)')

  const downloading = page.waitForEvent('download')
  await dialog
    .getByRole('button', {
      name: 'Download the project file of District study B',
    })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^district-study-b-\d{4}-\d{2}-\d{2}\.project\.json$/,
  )
  const text = await readFile(await download.path(), 'utf8')
  expect(JSON.parse(text)).toMatchObject({
    format: 'energyatlas-ui.project',
    project: { name: 'District study B' },
  })

  // Opening the copy leaves the demo, which asks first in the dialog.
  await dialog
    .getByRole('button', { name: 'Open the project District study B' })
    .click()
  const leave = page.getByRole('alertdialog', { name: 'Leave this project?' })
  await expect(
    leave.getByRole('button', { name: 'Save and leave' }),
  ).toBeFocused()
  await leave.getByRole('button', { name: 'Discard and leave' }).click()
  await expect(status(page)).toContainText('District study B')

  // The start screen opens a project file; a view file is refused with a reason.
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Projects', level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open project file…' }),
  ).toBeVisible()
  const input = page.locator('#project-file-input')
  await input.setInputFiles({
    name: 'view.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'energyatlas-ui.handover' })),
  })
  await expect(page.getByRole('main')).toContainText('This file is a view')
  await input.setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  // This browser keeps that project already, so the file opens as a copy.
  await expect(page.getByTestId('status-notice')).toContainText(
    'as a copy, as this browser already keeps that project',
  )
  await expect(status(page)).toContainText('District study B')
})

test('asks before removing a rule, and a removed rule leaves the list', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/?fixture=failed')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Archetypes')
  await page.keyboard.press('Enter')
  const rules = page.getByRole('grid', {
    name: 'Assignment rules',
    exact: true,
  })
  await rules.getByRole('row').filter({ hasText: 'Retail' }).first().click()
  const remove = page.getByRole('button', { name: 'Remove Retail' })
  await remove.click()
  const confirm = page.getByRole('alertdialog', { name: 'Remove "Retail"?' })
  await expect(
    confirm.getByRole('button', { name: 'Remove rule' }),
  ).toBeFocused()
  expect(await seriousViolations(page)).toEqual([])
  // Escape keeps it and gives focus back to Remove.
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(remove).toBeFocused()
  await expect(
    rules.getByRole('row').filter({ hasText: 'Retail' }),
  ).toHaveCount(1)
  // Enter removes it.
  await remove.click()
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(confirm).toBeHidden()
  await expect(
    rules.getByRole('row').filter({ hasText: 'Retail' }),
  ).toHaveCount(0)
})

test('an asset without a page is a note in the editor, not a failure', async ({
  page,
}) => {
  await page.goto('/?fixture=complete')
  const assets = page.getByRole('tab', { name: 'Assets', exact: true })
  if ((await assets.getAttribute('aria-selected')) !== 'true')
    await assets.click()
  const rules = page
    .getByRole('treegrid', { name: 'Project assets' })
    .getByRole('row', { name: 'Attribute mapping rules' })
  await rules.click()
  await page.keyboard.press('Enter')
  await expect(toast(page, 'has no page of its own')).toHaveAttribute(
    'data-tone',
    'info',
  )
  await expect(page.locator('[data-tone="danger"]')).toHaveCount(0)
})
