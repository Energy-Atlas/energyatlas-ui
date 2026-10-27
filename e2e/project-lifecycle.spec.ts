import { AxeBuilder } from '@axe-core/playwright'
import {
  createProjectFromStart,
  expect,
  openRecentProject,
  test,
  type Page,
} from './test.ts'

async function fileAction(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}
async function save(page: Page) {
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('Saved')
}
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(
    results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
}

test('starts with an empty catalog and validates named creation', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
  await expect(
    page.getByText('No saved projects in this browser yet.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('main', { name: 'Workspace' })).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await expect(
    dialog.getByRole('textbox', { name: 'Project name' }),
  ).toBeFocused()
  await dialog
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  await expect(
    dialog.getByText('Enter a project name from 1 to 100 characters.'),
  ).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Project name' }).fill('District A')
  await dialog
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('District A')
  await expect(page.getByTestId('save-status')).toContainText('Unsaved changes')
})

test('keeps equal-name saved projects separate and opens them from Recent and Open', async ({
  page,
}) => {
  await page.goto('/')
  await createProjectFromStart(page, 'District')
  await save(page)
  await fileAction(page, /^Projects/)
  await createProjectFromStart(page, 'District')
  await save(page)
  await fileAction(page, /^Projects/)
  const recent = page.getByRole('region', { name: 'Recent projects' })
  await expect(
    recent.getByRole('option').filter({ hasText: 'District' }),
  ).toHaveCount(2)
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('eaui.projects.v1') ?? '{}') as {
        projects: { id: string }[]
      },
  )
  expect(new Set(saved.projects.map((project) => project.id)).size).toBe(2)
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Open project' })
  await dialog
    .getByRole('option')
    .filter({ hasText: 'District' })
    .last()
    .click()
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
  await openRecentProject(page, 'District')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('District')
})

test('a failed Recent open reports the error and lets the same project retry', async ({
  page,
}) => {
  await page.goto('/')
  await createProjectFromStart(page, 'Retry district')
  await save(page)
  await fileAction(page, /^Projects/)
  await page
    .getByRole('button', { name: 'Demo conditions…', exact: true })
    .click()
  const conditions = page.getByRole('dialog', { name: 'Demo conditions' })
  await conditions.getByText('Every request fails', { exact: true }).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  const recent = page.getByRole('region', { name: 'Recent projects' })
  await recent.getByRole('option').filter({ hasText: 'Retry district' }).click()
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('server failed')
  await page
    .getByRole('button', { name: 'Demo conditions…', exact: true })
    .click()
  await conditions.getByRole('button', { name: 'Back to normal' }).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  await recent.getByRole('option').filter({ hasText: 'Retry district' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Retry district',
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Stay retains drafts; explicit Apply, save and leave saves them before closing', async ({
  page,
}) => {
  await page.goto('/?fixture=partway')
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const floors = page.locator('[row-index="0"] [col-id="floors"]')
  await floors.dblclick()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('60')
  await page.keyboard.press('Enter')
  await fileAction(page, /^Projects/)
  const guard = page.getByRole('alertdialog', { name: 'Leave this project?' })
  await expect(guard).toContainText('unsent table edit')
  await axe(page)
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('1 pending edit')
  await expect(floors).toHaveText('60')
  await fileAction(page, /^Projects/)
  await guard
    .getByRole('button', { name: 'Apply, save and leave', exact: true })
    .click()
  await openRecentProject(page)
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  await expect(floors).toHaveText('60')
  await expect(page.getByTestId('pending-count')).toHaveText('0 pending edits')
})

test('a failed save keeps the project open and the exit guard available', async ({
  page,
}) => {
  await page.goto('/?fixture=partway&fault=everyRequest')
  await fileAction(page, /^Projects/)
  const guard = page.getByRole('alertdialog', { name: 'Leave this project?' })
  await guard
    .getByRole('button', { name: 'Save and leave', exact: true })
    .click()
  await expect(guard.getByRole('alert')).toContainText('server failed')
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(guard).toBeHidden()
  await expect(page.getByTestId('save-status')).toContainText('Save failed')
})

test('leaving confirms job cancellation and Stay leaves the job running', async ({
  page,
}) => {
  await page.goto('/?fixture=new&jobs=stall')
  const workflowTab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await workflowTab.getAttribute('aria-selected')) !== 'true')
    await workflowTab.click()
  await page
    .getByRole('region', { name: 'Workflow' })
    .getByRole('button', { name: 'Run Location setup / footprint capturing' })
    .click()
  await expect(
    page.getByRole('button', { name: /^1 active jobs/ }),
  ).toBeVisible()
  await fileAction(page, /^Projects/)
  const guard = page.getByRole('alertdialog', { name: 'Leave this project?' })
  await expect(guard).toContainText('will be cancelled')
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /^1 active jobs/ }),
  ).toBeVisible()
  await fileAction(page, /^Projects/)
  await guard
    .getByRole('button', { name: 'Discard and leave', exact: true })
    .click()
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
})

test('reports unreadable storage without erasing it', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('eaui.projects.v1', '{broken'),
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(
    'catalog could not be read',
  )
  expect(
    await page.evaluate(() => localStorage.getItem('eaui.projects.v1')),
  ).toBe('{broken')
  await page.getByRole('button', { name: 'Try loading projects again' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'catalog could not be read',
  )
})

test('held creation and closing can recover through Demo conditions', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByText('No saved projects in this browser yet.', { exact: false }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Demo conditions…', exact: true })
    .click()
  const conditions = page.getByRole('dialog', { name: 'Demo conditions' })
  await conditions.getByText(/^Hold requests/).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  const create = page.getByRole('dialog', { name: 'Create project' })
  await create
    .getByRole('textbox', { name: 'Project name' })
    .fill('Held project')
  await create
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  await expect(create.getByRole('status')).toContainText(
    'Waiting for the server',
  )
  await create.getByRole('button', { name: 'Change demo conditions' }).click()
  await conditions.getByText(/^Hold requests/).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Held project',
  )
  await save(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('demo conditions')
  await page.keyboard.press('Enter')
  await conditions.getByText(/^Hold requests/).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  await fileAction(page, /^Projects/)
  const changing = page.getByRole('alertdialog', { name: 'Changing project' })
  await expect(changing).toBeVisible()
  await changing.getByRole('button', { name: 'Change demo conditions' }).click()
  await conditions.getByText(/^Hold requests/).click()
  await conditions.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
})

test('start and creation render in every appearance, desktop size, and narrow layout', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/')
  for (const width of [1280, 1600, 900]) {
    await page.setViewportSize({
      width,
      height: width === 900 ? 700 : width === 1600 ? 1000 : 800,
    })
    for (const appearance of [
      'light',
      'dark',
      'monochrome',
      'lieflat',
      'cleanLight',
      'darkEngineering',
    ]) {
      // The start screen has the menu bar's View > Appearance; the stored
      // choice is set directly here to keep the loop short.
      await page.evaluate((value) => {
        localStorage.setItem('eaui.theme', value)
      }, appearance)
      await page.goto('/')
      await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute(
        'data-appearance',
        appearance,
      )
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        )
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `tmp/lifecycle-${appearance}-${width}-start.png`,
      })
      if (width === 1280) await axe(page)
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click()
      const dialog = page.getByRole('dialog', { name: 'Create project' })
      await expect(
        dialog.getByRole('textbox', { name: 'Project name' }),
      ).toBeFocused()
      await page.screenshot({
        path: `tmp/lifecycle-${appearance}-${width}-create.png`,
      })
      if (width === 1280) await axe(page)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(
        page.getByRole('button', { name: 'Create project', exact: true }),
      ).toBeFocused()
      await page.goto('/?fixture=partway')
      await fileAction(page, /^Projects/)
      const guard = page.getByRole('alertdialog', {
        name: 'Leave this project?',
      })
      await page.screenshot({
        path: `tmp/lifecycle-${appearance}-${width}-guard.png`,
      })
      if (width === 1280) await axe(page)
      await guard.getByRole('button', { name: 'Stay', exact: true }).click()
      await fileAction(page, /^Projects/)
      await guard
        .getByRole('button', { name: 'Discard and leave', exact: true })
        .click()
      await expect(page.getByRole('main', { name: 'Projects' })).toBeVisible()
    }
  }
})
