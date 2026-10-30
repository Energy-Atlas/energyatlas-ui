import { describe, expect, test } from 'vitest'
import { forViewer, type AppAction } from './actions.ts'
import type { PageId } from './layout/layoutController.ts'

// The viewer's shell follows the editor's (decision 0036): every menu and
// toolbar action stays, and what a view cannot do is unavailable with a
// reason instead of left out.

function action(
  id: string,
  group: AppAction['group'],
  extra: Partial<AppAction> = {},
): AppAction {
  return {
    id,
    label: id,
    group,
    disabledReason: null,
    perform: () => undefined,
    ...extra,
  }
}

const EDITOR: AppAction[] = [
  action('file.save', 'File', { shortcut: 'Ctrl+S' }),
  action('file.openProject', 'File', { shortcut: 'Ctrl+O' }),
  action('file.saveAs', 'File'),
  action('edit.undo', 'Edit', { shortcut: 'Ctrl+Z' }),
  action('view.open.map', 'View', { pressed: true }),
  action('view.open.roadmap', 'View', { pressed: true }),
  action('view.toggleAssets', 'View'),
  action('view.toggleWorkflow', 'View', { pressed: true }),
  action('view.saveLayout', 'View'),
  action('run.current', 'Run'),
  action('help.palette', 'Help'),
  action('help.comments', 'Help', { disabledReason: 'Planned: comments.' }),
  action('account.open', 'Account'),
  action('account.logOut', 'Account'),
]

const VIEWER_PAGES = new Set<PageId>(['map', 'table', 'dashboard', 'results'])

describe('the viewer actions', () => {
  const extras = [action('viewer.openFile', 'File', { shortcut: 'Ctrl+O' })]
  const shown = forViewer(EDITOR, (page) => VIEWER_PAGES.has(page), extras)
  const byId = new Map(shown.map((each) => [each.id, each]))

  test('keeps every editor action and all five menus, with the viewer own first', () => {
    expect(shown.map((each) => each.id)).toEqual([
      'viewer.openFile',
      ...EDITOR.map((each) => each.id),
    ])
    expect(new Set(shown.map((each) => each.group))).toEqual(
      new Set(['File', 'Edit', 'View', 'Run', 'Help', 'Account']),
    )
  })

  test('marks what a view cannot do unavailable, with its reason', () => {
    expect(byId.get('file.save')?.disabledReason).toMatch(/not saved again/)
    expect(byId.get('file.saveAs')?.disabledReason).toMatch(/not saved again/)
    expect(byId.get('edit.undo')?.disabledReason).toMatch(/nothing in it/)
    expect(byId.get('run.current')?.disabledReason).toMatch(/runs nothing/)
    expect(byId.get('view.open.roadmap')?.disabledReason).toMatch(
      /no Roadmap page/,
    )
    expect(byId.get('view.open.roadmap')?.pressed).toBeUndefined()
    expect(byId.get('view.toggleWorkflow')?.disabledReason).toMatch(
      /no Workflow panel/,
    )
    expect(byId.get('view.saveLayout')?.disabledReason).toMatch(/layouts/)
    expect(byId.get('account.open')?.disabledReason).toMatch(/no Account page/)
    // A planned action keeps its own reason.
    expect(byId.get('help.comments')?.disabledReason).toBe('Planned: comments.')
  })

  test('keeps what a view can do, and gives Ctrl+O to Open view file', () => {
    for (const id of [
      'view.open.map',
      'view.toggleAssets',
      'help.palette',
      'account.logOut',
    ]) {
      expect(byId.get(id)?.disabledReason, id).toBeNull()
    }
    expect(byId.get('view.open.map')?.pressed).toBe(true)
    expect(byId.get('file.openProject')?.shortcut).toBeUndefined()
    expect(
      shown.filter((each) => each.shortcut === 'Ctrl+O').map((each) => each.id),
    ).toEqual(['viewer.openFile'])
  })
})
