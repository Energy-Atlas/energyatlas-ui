import { createProjectFromStart } from './test.ts'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from './test.ts'

test('workbench renders without serious or critical axe violations', async ({
  page,
}) => {
  await page.goto('/')
  await createProjectFromStart(page)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Synthetic district (demo)',
  )

  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
  test.info().annotations.push({
    type: 'all axe violations',
    description: JSON.stringify(
      results.violations.map(
        (violation) => `${violation.id}:${violation.impact ?? ''}`,
      ),
    ),
  })
  expect(serious).toEqual([])
})
