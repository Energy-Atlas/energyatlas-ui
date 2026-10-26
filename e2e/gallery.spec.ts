import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// The component gallery (decision 0027): every shared panel component in its
// states, checked in every appearance.

const APPEARANCE_IDS = [
  'light',
  'dark',
  'monochrome',
  'lieflat',
  'cleanLight',
  'darkEngineering',
]

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

async function openGallery(page: Page, appearance = 'light') {
  await page.goto(`/?gallery&appearance=${appearance}`)
  await expect(
    page.getByRole('heading', { name: 'Component gallery' }),
  ).toBeVisible()
}

test('the gallery renders every appearance without serious axe violations', async ({
  page,
}) => {
  await openGallery(page)
  for (const id of APPEARANCE_IDS) {
    await page.goto(`/?gallery&appearance=${id}`)
    await expect(page.locator('html')).toHaveAttribute('data-appearance', id)
    // Open a section and a menu so their content is checked too.
    await page.getByRole('button', { name: /Show monthly data table/ }).click()
    expect(await seriousViolations(page), id).toEqual([])
  }
})

test('the appearance choice restyles the gallery without a reload', async ({
  page,
}) => {
  await openGallery(page, 'light')
  await page.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('a toolbar moves what does not fit into More and keeps the primary action', async ({
  page,
}) => {
  await openGallery(page)
  const frame = page.getByTestId('narrow-toolbar')
  const toolbar = frame.getByRole('toolbar', { name: 'Narrow table actions' })
  const more = toolbar.getByRole('button', {
    name: 'More actions: Narrow table actions',
  })

  await frame.evaluate((element) => {
    element.style.width = '900px'
    element.style.maxWidth = 'none'
  })
  await expect(more).toHaveCount(0)
  await expect(toolbar.getByRole('button')).toHaveCount(6)

  await frame.evaluate((element) => {
    element.style.width = '220px'
  })
  await expect(more).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Run stage' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  // Every row stays inside the frame rather than spilling past it.
  const [frameBox, toolbarBox] = await Promise.all([
    frame.boundingBox(),
    toolbar.boundingBox(),
  ])
  expect(toolbarBox && frameBox).toBeTruthy()
  expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(
    frameBox!.x + frameBox!.width,
  )

  // Overflowed items run from the menu, and an unavailable one explains itself.
  await more.click()
  await page.getByRole('menuitem', { name: /Download CSV/ }).click()
  await expect(page.getByTestId('gallery-last')).toHaveText('Download pressed.')
  await more.click()
  const refresh = page.getByRole('menuitem', { name: /Refresh/ })
  await expect(refresh).toContainText(
    'Results are current; nothing to refresh.',
  )
  await refresh.click()
  await expect(page.getByTestId('gallery-last')).toHaveText(
    'Refresh is unavailable: Results are current; nothing to refresh.',
  )
})

test('toolbars, filters, menus, and sections work from the keyboard', async ({
  page,
}) => {
  await openGallery(page)
  const header = page.getByRole('toolbar', { name: 'Building table actions' })
  await header.getByRole('button', { name: 'Columns' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(header.getByRole('button', { name: 'Filter' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(
    header.getByRole('button', { name: 'Shade rows' }),
  ).toHaveAttribute('aria-pressed', 'true')

  const jobs = page.getByRole('radiogroup', { name: 'Show jobs' })
  await jobs.getByRole('radio', { name: 'All, 14' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect(jobs.getByRole('radio', { name: 'Active, 2' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  const columns = page.getByRole('button', { name: 'Choose columns' })
  await columns.focus()
  await page.keyboard.press('Enter')
  const peak = page.getByRole('menuitemcheckbox', { name: 'Peak load' })
  await expect(peak).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(peak).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('gallery-last')).toHaveText(
    'Columns: id, name, demand, peak.',
  )
  await page.keyboard.press('Escape')
  await expect(columns).toBeFocused()

  const section = page.getByRole('button', { name: /Show monthly data table/ })
  await section.focus()
  await page.keyboard.press('Enter')
  await expect(section).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('cell', { name: 'Jan' })).toBeVisible()
})
