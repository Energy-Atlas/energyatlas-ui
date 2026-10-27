import { useCallback } from 'react'
import { useServices } from '../WorkbenchContext.tsx'
import type { MessageAction } from './messageCenter.ts'

/** Where focus should go after an action, so the keyboard is never stranded. */
export function actionFocusTarget(action: MessageAction): HTMLElement | null {
  switch (action.kind) {
    case 'openJob':
      return document.querySelector<HTMLElement>(
        '[role="listbox"][aria-label="Jobs"]',
      )
    case 'openPanel':
    case 'openPage':
      return null
  }
}

/**
 * Runs a message's action through the same operations as the controls it
 * stands for: selecting a job, opening a panel, or opening a page.
 */
export function useRunMessageAction(): (action: MessageAction) => void {
  const { view, layout } = useServices()
  return useCallback(
    (action: MessageAction) => {
      switch (action.kind) {
        case 'openJob': {
          const result = view.execute({
            type: 'jobs.select',
            input: { taskId: action.taskId },
          })
          if (result.outcome.status === 'applied') {
            view.execute({ type: 'jobs.setFilter', input: { filter: 'all' } })
            layout.openPage('tasks')
          }
          return
        }
        case 'openPanel':
          if (!layout.isPanelOpen(action.panel))
            layout.togglePanel(action.panel)
          return
        case 'openPage':
          layout.openPage(action.page)
          return
      }
    },
    [view, layout],
  )
}
