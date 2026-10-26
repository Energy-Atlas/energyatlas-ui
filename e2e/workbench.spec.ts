import { createProjectFromStart, openRecentProject } from './test.ts'
import { expect, test, type Page } from './test.ts'

// First-slice build stage 2: the workbench shell (decisions 0004, 0006, 0008).

function workflowPanel(page: Page) {
  return page.getByRole('region', { name: 'Workflow' })
}

async function showWorkflow(page: Page) {
  const tab = page.getByRole('tab', { name: 'Workflow', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(workflowPanel(page)).toBeVisible()
}

async function runFirstStage(page: Page) {
  await showWorkflow(page)
  await workflowPanel(page)
    .getByRole('button', { name: 'Run Location setup / footprint capturing' })
    .click()
}

test.describe('workbench shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await createProjectFromStart(page)
    await expect(
      page.getByRole('toolbar', { name: 'Workbench commands' }),
    ).toBeVisible()
  })

  test('shows the ribbon, docked panels and pages, and the status bar', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic district (demo)',
    )
    for (const name of [
      'Map',
      'Table',
      'Dashboard',
      'Roadmap',
      'Creator',
      'Settings',
      'Assets',
      'Workflow',
      'Reasoning',
      'Inspection',
    ]) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible()
    await expect(
      page.getByRole('contentinfo', { name: 'Status bar' }),
    ).toBeVisible()
    await expect(
      page.getByRole('log', { name: 'Agent transcript' }),
    ).toBeVisible()
    // Working behavior carries no label (guidelines section 8).
    await expect(
      page.getByText('Working', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
  })

  test('shows only the EnergyAtlas mark at the start of the ribbon', async ({
    page,
  }) => {
    const banner = page.getByRole('banner')
    await expect(banner.getByRole('img', { name: 'EnergyAtlas' })).toBeVisible()
    await expect(banner.getByText('EnergyAtlas UI')).toHaveCount(0)
    // The project name stays the page heading for assistive technology only.
    await expect(page.getByRole('heading', { level: 1 })).toHaveClass(
      'visually-hidden',
    )
  })

  test('ticks every page and panel on screen in View > Panels', async ({
    page,
  }) => {
    const toolbar = page.getByRole('toolbar', { name: 'Workbench commands' })
    const panelsMenu = async () => {
      await toolbar.getByRole('button', { name: 'View', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Panels' }).click()
      // React Aria names a submenu after its trigger item.
      return page.getByRole('menu', { name: 'Panels' })
    }
    const item = (menu: ReturnType<Page['getByRole']>, name: string) =>
      menu.getByRole('menuitem', { name: new RegExp(`^${name}\\b`) })

    let menu = await panelsMenu()
    for (const name of ['Map', 'Assets', 'Reasoning']) {
      await expect(item(menu, name)).toContainText('(on)')
    }
    for (const name of ['Table', 'Workflow', 'Inspection']) {
      await expect(item(menu, name)).not.toContainText('(on)')
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
    menu = await panelsMenu()
    for (const name of ['Table', 'Workflow', 'Reasoning']) {
      await expect(item(menu, name)).toContainText('(on)')
    }
    for (const name of ['Map', 'Assets']) {
      await expect(item(menu, name)).not.toContainText('(on)')
    }
  })

  test('opens the Account page from the initials, and explains Log out', async ({
    page,
  }) => {
    const account = page
      .getByRole('banner')
      .getByRole('button', { name: 'Account: Avery Chen (demo)' })
    await expect(account).toHaveText('AC')

    await account.click()
    // React Aria names the menu after its trigger button.
    const menu = page.getByRole('menu', { name: /^Account/ })
    const items = menu.getByRole('menuitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText('Account')
    await expect(items.nth(1)).toHaveText('Log out')
    await items.nth(0).click()

    const tab = page.getByRole('tab', { name: 'Account', exact: true })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const accountPage = page.getByRole('region', { name: 'Account' })
    await expect(accountPage).toContainText('Avery Chen')

    // The Account page is a page like any other in View > Panels.
    await page
      .getByRole('toolbar', { name: 'Workbench commands' })
      .getByRole('button', { name: 'View', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Panels' }).click()
    await expect(
      page
        .getByRole('menu', { name: 'Panels' })
        .getByRole('menuitem', { name: /^Account/ }),
    ).toContainText('(on)')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Nobody is signed in, so Log out says why in the status bar.
    await account.click()
    await page
      .getByRole('menu', { name: /^Account/ })
      .getByRole('menuitem', { name: 'Log out' })
      .click()
    await expect(page.getByTestId('status-notice')).toContainText(
      'this demo has no account to log out of.',
    )
  })

  test('runs stages from the Run split button and its menu', async ({
    page,
  }) => {
    const toolbar = page.getByRole('toolbar', { name: 'Workbench commands' })
    await expect(
      toolbar.getByRole('button', { name: 'Run current stage' }),
    ).toContainText('Run')

    await toolbar.getByRole('button', { name: 'More run options' }).click()
    // React Aria names the menu after its trigger button.
    const menu = page.getByRole('menu', { name: 'More run options' })
    await expect(
      menu.getByRole('menuitem', { name: /Cancel running jobs/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    await menu.getByRole('menuitem', { name: /Run next ready stage/ }).click()
    await expect(
      page.getByRole('progressbar', {
        name: 'Location setup / footprint capturing progress',
      }),
    ).toBeVisible()
  })

  test('runs a stage as a background task with visible progress', async ({
    page,
  }) => {
    await runFirstStage(page)
    await expect(
      page.getByRole('progressbar', {
        name: 'Location setup / footprint capturing progress',
      }),
    ).toBeVisible()
    await expect(
      workflowPanel(page).getByRole('listitem').first(),
    ).toContainText('Complete', { timeout: 10_000 })

    await page.getByRole('button', { name: /Open Jobs/ }).click()
    await expect(
      page.getByRole('tab', { name: 'Jobs', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    const jobs = page.getByRole('table', { name: 'Jobs' })
    await expect(jobs).toContainText('Completed')
    // Each job keeps a log, as RC's jobs do (decision 0023).
    await jobs.locator('summary').first().click()
    await expect(
      jobs.getByRole('list', {
        name: 'Log of Location setup / footprint capturing',
      }),
    ).toContainText('Started.')
  })

  test('explains blocked and planned actions instead of doing nothing', async ({
    page,
  }) => {
    // These buttons use aria-disabled so they stay focusable; Playwright's
    // click waits for enabled elements, so activate them from the keyboard.
    await showWorkflow(page)
    await workflowPanel(page)
      .getByRole('button', { name: 'Run Geospatial data enriching' })
      .focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('status-notice')).toContainText(
      'Complete or skip earlier stages first',
    )

    await page.getByRole('button', { name: 'Comments (planned)' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('status-notice')).toContainText('Planned:')
  })

  test('opens pages from the command palette and toggles panels by keyboard', async ({
    page,
  }) => {
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await page.keyboard.type('jobs')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(
      page.getByRole('tab', { name: 'Jobs', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')

    const assetsTab = page.getByRole('tab', { name: 'Assets', exact: true })
    await expect(assetsTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+b')
    await expect(assetsTab).toHaveAttribute('aria-selected', 'false')
    await page.keyboard.press('Control+b')
    await expect(assetsTab).toHaveAttribute('aria-selected', 'true')
  })

  test('undoes draft edits with Ctrl+Z, but not changes the server applied', async ({
    page,
  }) => {
    // Decision 0023: only unsent drafts can be undone.
    await page.goto('/?fixture=partway')
    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    const floors = page.locator('[row-index="0"] [col-id="floors"]')
    const original = (await floors.innerText()).trim()
    const edited = original === '11' ? '10' : String(Number(original) + 1)
    await floors.dblclick()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(edited)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pending-count')).toHaveText('1 pending edit')

    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('pending-count')).toHaveText(
      '0 pending edits',
    )
    await expect(floors).toHaveText(original)

    await showWorkflow(page)
    const shading = workflowPanel(page)
      .getByRole('listitem')
      .filter({ hasText: 'Shading calculation / PV yield estimation' })
    await shading
      .getByRole('button', {
        name: 'Skip Shading calculation / PV yield estimation',
      })
      .click()
    await expect(shading).toContainText('Skipped')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('status-notice')).toContainText(
      'Nothing to undo.',
    )
    await expect(shading).toContainText('Skipped')
  })

  test('keeps a saved project and the layout across reloads', async ({
    page,
  }) => {
    await runFirstStage(page)
    await expect(
      workflowPanel(page).getByRole('listitem').first(),
    ).toContainText('Complete', { timeout: 10_000 })
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('status-notice')).toContainText(
      'Saved the project',
    )

    await page.reload()
    await openRecentProject(page)
    await expect(
      page.getByRole('tab', { name: 'Workflow', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      workflowPanel(page).getByRole('listitem').first(),
    ).toContainText('Complete')
    await expect(page.getByTestId('status-notice')).toContainText('Opened')
  })

  test('opens side panels as overlays in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    const assetsTab = page.getByRole('tab', { name: 'Assets', exact: true })
    await expect(assetsTab).toHaveAttribute('aria-selected', 'false')

    const pages = page.locator('[data-layout-path="/ts0"]')
    const width = (await pages.boundingBox())?.width ?? 0
    expect(width).toBeGreaterThan(700)

    await assetsTab.click()
    await expect(page.getByRole('region', { name: 'Assets' })).toBeVisible()
    expect((await pages.boundingBox())?.width ?? 0).toBe(width)
    await expect(page.getByTestId('status-notice')).toContainText(
      'Selected "Assets"',
    )
  })

  test('places pages side by side and moves tabs from the command palette', async ({
    page,
  }) => {
    await page.keyboard.press('Control+k')
    await page.keyboard.type('place map beside table')
    await page.keyboard.press('Enter')
    const mapTab = page.getByRole('tab', { name: 'Map', exact: true })
    const tableTab = page.getByRole('tab', { name: 'Table', exact: true })
    await expect(mapTab).toHaveAttribute('aria-selected', 'true')
    await expect(tableTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('status-notice')).toContainText(
      'Placed the Map page to the right of the Table page.',
    )

    await mapTab.click()
    await page.keyboard.press('Control+k')
    await page.keyboard.type('move active tab')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('status-notice')).toContainText(
      'Moved "Map" to the next tab group.',
    )
    await expect(mapTab).toHaveAttribute('aria-selected', 'true')
    await expect(tableTab).toHaveAttribute('aria-selected', 'false')
  })

  test('restores a closed page with Reset layout', async ({ page }) => {
    const tableTab = page.getByRole('tab', { name: 'Table', exact: true })
    await tableTab.focus()
    await page.keyboard.press('Control+Delete')
    await expect(tableTab).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.keyboard.type('reset layout')
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('tab', { name: 'Table', exact: true }),
    ).toBeVisible()
  })
})

// React Aria's Autocomplete replays field keys on the focused menu item, which
// cancelled Backspace in the palette while Delete kept working.
test('edits the command palette query with Backspace', async ({ page }) => {
  await page.goto('/')
  await createProjectFromStart(page)
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
  await page.keyboard.press('Control+k')
  const query = page.getByPlaceholder('Type a command')
  await expect(query).toBeVisible()
  await query.pressSequentially('map')
  await page.keyboard.press('Backspace')
  await expect(query).toHaveValue('ma')
  await page.keyboard.press('Backspace')
  await expect(query).toHaveValue('m')
})
