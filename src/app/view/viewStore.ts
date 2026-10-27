import { produce } from 'immer'
import type { z } from 'zod'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CommandSource, WorkbenchState } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'
import {
  createInitialViewState,
  viewOperationDefinitions,
  type ViewOperation,
  type ViewOutcome,
  type ViewState,
} from './viewOperations.ts'

export type ViewResult = { operationId: string; outcome: ViewOutcome }

export type ViewStore = {
  store: StoreApi<ViewState>
  getState: () => ViewState
  /** Validates and applies a view operation, and records it in the operation log. */
  execute: (operation: ViewOperation, source?: CommandSource) => ViewResult
}

// Definitions differ per operation, so the registry entry is used through this
// shape; inputs are validated by the entry's own schema before `run`.
type RegistryEntry = {
  title: string
  input: z.ZodType
  run: (view: ViewState, input: unknown, project: WorkbenchState) => ViewOutcome
}

/**
 * View state for the open project. Table arrangements are saved with the
 * project (decision 0028): `view.resetForProject` restores them when a
 * project opens, and saving sends them with the project.
 */
export function createViewStore(workbench: Workbench): ViewStore {
  const store = createStore<ViewState>()(() => createInitialViewState())

  function execute(
    operation: ViewOperation,
    source: CommandSource = 'manual',
  ): ViewResult {
    const definition = viewOperationDefinitions[
      operation.type
    ] as unknown as RegistryEntry
    const result: { outcome: ViewOutcome } = {
      outcome: {
        status: 'rejected',
        issues: [
          { path: '', message: 'The view operation produced no outcome.' },
        ],
      },
    }

    const parsed = definition.input.safeParse(operation.input)
    if (parsed.success) {
      const next = produce(store.getState(), (draft) => {
        result.outcome = definition.run(
          draft,
          parsed.data,
          workbench.getState(),
        )
      })
      if (result.outcome.status === 'applied') store.setState(next, true)
    } else {
      result.outcome = {
        status: 'rejected',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      }
    }

    const { outcome } = result
    const operationId = workbench.record({
      type: operation.type,
      title: definition.title,
      input: operation.input,
      source,
      status: outcome.status,
      summary: outcome.status === 'applied' ? outcome.summary : '',
      issues: outcome.status === 'rejected' ? outcome.issues : [],
    })
    return { operationId, outcome }
  }

  return { store, getState: () => store.getState(), execute }
}
