import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, notifications, toast, type Page } from './test.ts'

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => `${violation.id} (${violation.nodes.length})`)
}

// Messages (decision 0027): one store, toasts only for asynchronous events
// and failures, and the Messages panel on the right border with the history.

test('events pop up as toasts and stay in the Messages panel', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/?fixture=partway')
  const counter = page.getByTestId('unread-messages')
  const status = page.getByTestId('status-notice')

  // An applied operation reaches the status bar and the history, no popup.
  await expect(status).toContainText('Partway')
  await expect(notifications(page)).toBeHidden()
  await expect(counter).toHaveAccessibleName(
    'No unread messages. Open Messages.',
  )

  // A refused command pops up without taking focus.
  const toolbar = page.getByRole('toolbar', { name: 'Workbench commands' })
  const runCurrent = toolbar.getByRole('button', { name: 'Run current stage' })
  await runCurrent.focus()
  await page.keyboard.press('Enter')
  const refused = toast(page, 'No stage is focused.')
  await expect(refused).toHaveAttribute('data-tone', 'danger')
  await expect(runCurrent).toBeFocused()
  await expect(counter).toHaveAccessibleName('1 unread message. Open Messages.')

  // One shortcut reaches the newest toast; dismissing it returns focus to
  // the workspace and counts the message as read.
  await page.keyboard.press('Control+Alt+N')
  await expect(
    refused.getByRole('button', { name: 'Dismiss: No stage is focused.' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(notifications(page)).toBeHidden()
  await expect(page.getByRole('main', { name: 'Workspace' })).toBeFocused()
  await expect(counter).toHaveAccessibleName(
    'No unread messages. Open Messages.',
  )

  // A finished job pops up; a success stays while hovered and then leaves
  // by itself, still unread.
  await toolbar.getByRole('button', { name: 'More run options' }).click()
  await page
    .getByRole('menu', { name: 'More run options' })
    .getByRole('menuitem', { name: /Run next ready stage/ })
    .click()
  const finished = toast(page, /completed\./)
  await expect(finished).toHaveAttribute('data-tone', 'success', {
    timeout: 15_000,
  })
  await finished.hover()
  await page.waitForTimeout(7_000)
  await expect(finished).toBeVisible()
  await page.mouse.move(5, 300)
  await expect(finished).toBeHidden({ timeout: 10_000 })
  await expect(counter).toHaveAccessibleName('1 unread message. Open Messages.')

  // The counter opens the Messages panel, which marks messages read.
  await counter.click()
  const panel = page.getByRole('region', { name: 'Messages' })
  await expect(panel).toBeVisible()
  await expect(counter).toHaveAccessibleName(
    'No unread messages. Open Messages.',
  )
  const history = panel.getByRole('list', { name: 'Message history' })
  // Newest first: opening the panel is the latest operation.
  await expect(history.getByRole('listitem').first()).toContainText(
    'Showed the Messages panel.',
  )
  await expect(history).toContainText('completed.')
  await expect(history).toContainText('No stage is focused.')
  await expect(history).toContainText('Partway')
  expect(await seriousViolations(page)).toEqual([])

  // Filter by tone, then by source.
  await panel.getByRole('radio', { name: /^Problems/ }).click()
  await expect(history).toContainText('No stage is focused.')
  await expect(history).not.toContainText('completed.')
  await panel.getByRole('radio', { name: /^All/ }).click()
  await panel.getByRole('button', { name: /^Messages from:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Jobs' }).click()
  await expect(history.getByRole('listitem')).toHaveCount(1)
  await expect(history).toContainText('completed.')

  // A message's action runs again from the history.
  await history.getByRole('button', { name: 'Open job' }).click()
  await expect(
    page.getByRole('tab', { name: 'Jobs', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')

  // Clearing empties this project's history.
  await panel.getByRole('button', { name: 'Clear messages' }).click()
  await expect(history).toBeHidden()
  await expect(panel).toContainText('No messages yet.')
})
