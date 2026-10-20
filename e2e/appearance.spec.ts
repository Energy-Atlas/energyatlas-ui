import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from './test.ts'

// Design alignment (decisions 0009 and 0010): Geist typeface and curated appearances.

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

async function openWorkbench(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('toolbar', { name: 'Workbench commands' }),
  ).toBeVisible()
}

test('loads the Geist typeface for workbench text', async ({ page }) => {
  await openWorkbench(page)
  const font = await page.evaluate(async () => {
    await document.fonts.ready
    const faces = Array.from(document.fonts as unknown as Iterable<FontFace>)
    return {
      body: getComputedStyle(document.body).fontFamily,
      loaded: faces.some(
        (face) =>
          face.family.replaceAll('"', '') === 'Geist Variable' &&
          face.status === 'loaded',
      ),
    }
  })
  expect(font.body).toContain('Geist Variable')
  expect(font.loaded).toBe(true)
})

// Decision 0020: Geist Mono labels the tab strips, from the app's own bundle.
test('loads Geist Mono for labels from the app bundle', async ({ page }) => {
  await openWorkbench(page)
  const mono = await page.evaluate(async () => {
    await document.fonts.ready
    const faces = Array.from(document.fonts as unknown as Iterable<FontFace>)
    const tab = document.querySelector('.flexlayout__tab_button')
    return {
      tab: tab ? getComputedStyle(tab).fontFamily : '',
      loaded: faces.some(
        (face) =>
          face.family.replaceAll('"', '') === 'Geist Mono' &&
          face.status === 'loaded',
      ),
      foreignFonts: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter(
          (url) =>
            /\.(woff2?|ttf|otf)(\?|$)/.test(url) &&
            !url.startsWith(location.origin),
        ),
    }
  })
  expect(mono.tab).toContain('Geist Mono')
  expect(mono.loaded).toBe(true)
  expect(mono.foreignFonts).toEqual([])
})

test('switches appearance from Settings and keeps it across reloads', async ({
  page,
}) => {
  await openWorkbench(page)
  // Settings can sit in the tab overflow menu at 1280 px; open it by command.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('settings')
  await page.keyboard.press('Enter')

  // React Aria keeps the native radio visually hidden; use the keyboard.
  await page.getByRole('radio', { name: /^Dark engineering/ }).focus()
  await page.keyboard.press('Space')
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-appearance', 'darkEngineering')
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('status-notice')).toContainText(
    'Appearance set to Dark engineering.',
  )

  await page.reload()
  await expect(root).toHaveAttribute('data-appearance', 'darkEngineering')
})

test('every appearance renders the workbench without serious axe violations', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openWorkbench(page)
  for (const id of APPEARANCE_IDS) {
    await page.evaluate((value) => {
      localStorage.setItem('eaui.theme', value)
    }, id)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', id)
    expect(await seriousViolations(page), id).toEqual([])
  }
})
