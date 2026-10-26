import {
  applyPatches,
  enablePatches,
  produce,
  produceWithPatches,
  type Patch,
} from 'immer'
import type { z } from 'zod'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  commandDefinitions,
  type Command,
  type CommandContext,
  type CommandOutcome,
  type ValidationIssue,
} from './commands.ts'
import { createInitialState } from './initialState.ts'
import type { CommandSource, WorkbenchState } from './types.ts'

enablePatches()

export type OperationEntry = {
  id: string
  sequence: number
  /** A command type, a history replay, or an external operation such as a layout change. */
  type: string
  title: string
  input: unknown
  source: CommandSource
  status: 'applied' | 'rejected'
  summary: string | null
  issues: ValidationIssue[]
  at: string
  undoable: boolean
}

export type WorkbenchSnapshot = {
  state: WorkbenchState
  log: OperationEntry[]
  canUndo: boolean
  canRedo: boolean
}

export type ExecuteResult = { operationId: string; outcome: CommandOutcome }

/** An operation outside the command registry, such as a layout change, save, or blocked action. */
export type ExternalOperation = {
  type: string
  title: string
  input?: unknown
  source?: CommandSource
  status?: 'applied' | 'rejected'
  summary: string
  issues?: ValidationIssue[]
}

export type Workbench = {
  store: StoreApi<WorkbenchSnapshot>
  getState: () => WorkbenchState
  execute: (command: Command, source?: CommandSource) => ExecuteResult
  undo: (source?: CommandSource) => ExecuteResult
  redo: (source?: CommandSource) => ExecuteResult
  /** Appends an external operation to the log without changing project state. */
  record: (operation: ExternalOperation) => string
  /** Replaces project state (new project, restore) and clears undo history. */
  load: (state: WorkbenchState, operation: ExternalOperation) => string
  /**
   * Takes state decided elsewhere (the server's) and appends the operations
   * that produced it, keeping undo history; returns the new log entry ids.
   */
  adopt: (state: WorkbenchState, operations: ExternalOperation[]) => string[]
  /** Forgets undo and redo history, for example once drafts have been sent. */
  clearHistory: () => void
}

type HistoryEntry = {
  operationId: string
  title: string
  patches: Patch[]
  inversePatches: Patch[]
}

// Handler signatures differ per command, so the registry entry is used through
// this shape; inputs are validated by the entry's own schema before `run`.
type RegistryEntry = {
  title: string
  input: z.ZodType
  undoable: boolean
  run: (
    state: WorkbenchState,
    input: unknown,
    context: CommandContext,
  ) => CommandOutcome
}

export function createWorkbench(
  options: {
    initialState?: WorkbenchState
    now?: () => Date
    /** Overrides which commands are undoable; the registry decides by default. */
    isUndoable?: (type: Command['type']) => boolean
    /** Why this workbench refuses a command, or null to run it. */
    refuse?: (type: Command['type']) => string | null
  } = {},
): Workbench {
  const now = options.now ?? (() => new Date())
  const isUndoable =
    options.isUndoable ?? ((type) => commandDefinitions[type].undoable)
  const store = createStore<WorkbenchSnapshot>()(() => ({
    state: options.initialState ?? createInitialState(),
    log: [],
    canUndo: false,
    canRedo: false,
  }))
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []

  function nextOperation() {
    const sequence = store.getState().log.length + 1
    return { operationId: `op-${sequence}`, sequence, at: now().toISOString() }
  }

  function commit(state: WorkbenchState, entry: OperationEntry) {
    store.setState({
      state,
      log: [...store.getState().log, entry],
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    })
  }

  function execute(
    command: Command,
    source: CommandSource = 'manual',
  ): ExecuteResult {
    const { operationId, sequence, at } = nextOperation()
    const definition = commandDefinitions[
      command.type
    ] as unknown as RegistryEntry
    const current = store.getState().state
    const entry = {
      id: operationId,
      sequence,
      type: command.type,
      title: definition.title,
      input: command.input,
      source,
      at,
      undoable: isUndoable(command.type),
    }

    const refusal = options.refuse?.(command.type) ?? null
    if (refusal) {
      const issues = [{ path: '', message: refusal }]
      commit(current, { ...entry, status: 'rejected', summary: null, issues })
      return { operationId, outcome: { status: 'rejected', issues } }
    }

    const parsed = definition.input.safeParse(command.input)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }))
      commit(current, { ...entry, status: 'rejected', summary: null, issues })
      return { operationId, outcome: { status: 'rejected', issues } }
    }

    const context: CommandContext = { operationId, source, now: at }
    const result: { outcome: CommandOutcome } = {
      outcome: {
        status: 'rejected',
        issues: [{ path: '', message: 'The command produced no outcome.' }],
      },
    }
    const recipe = (draft: WorkbenchState) => {
      result.outcome = definition.run(draft, parsed.data, context)
    }

    let next = current
    let patches: Patch[] = []
    let inversePatches: Patch[] = []
    try {
      if (entry.undoable) {
        ;[next, patches, inversePatches] = produceWithPatches(current, recipe)
      } else {
        next = produce(current, recipe)
      }
    } catch (error) {
      result.outcome = {
        status: 'rejected',
        issues: [
          {
            path: '',
            message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      }
    }

    const outcome = result.outcome
    if (outcome.status === 'rejected') {
      commit(current, {
        ...entry,
        status: 'rejected',
        summary: null,
        issues: outcome.issues,
      })
      return { operationId, outcome }
    }

    if (entry.undoable && patches.length > 0) {
      undoStack.push({
        operationId,
        title: definition.title,
        patches,
        inversePatches,
      })
      redoStack.length = 0
    }
    commit(next, {
      ...entry,
      status: 'applied',
      summary: outcome.summary,
      issues: [],
    })
    return { operationId, outcome }
  }

  function replay(
    kind: 'history.undo' | 'history.redo',
    source: CommandSource,
  ): ExecuteResult {
    const { operationId, sequence, at } = nextOperation()
    const current = store.getState().state
    const from = kind === 'history.undo' ? undoStack : redoStack
    const to = kind === 'history.undo' ? redoStack : undoStack
    const title = kind === 'history.undo' ? 'Undo' : 'Redo'
    const history = from.pop()
    const base = {
      id: operationId,
      sequence,
      type: kind,
      title,
      source,
      at,
      undoable: false,
    }

    if (!history) {
      const issues = [
        {
          path: '',
          message:
            kind === 'history.undo' ? 'Nothing to undo.' : 'Nothing to redo.',
        },
      ]
      commit(current, {
        ...base,
        input: {},
        status: 'rejected',
        summary: null,
        issues,
      })
      return { operationId, outcome: { status: 'rejected', issues } }
    }

    const patches =
      kind === 'history.undo' ? history.inversePatches : history.patches
    // Ids and revisions stay monotonic so an undone change cannot collide with later ones.
    const next = produce(applyPatches(current, patches), (draft) => {
      draft.nextId = Math.max(draft.nextId, current.nextId)
    })
    to.push(history)
    const summary = `${title} "${history.title}" (${history.operationId}).`
    commit(next, {
      ...base,
      input: { operationId: history.operationId },
      status: 'applied',
      summary,
      issues: [],
    })
    return { operationId, outcome: { status: 'applied', summary } }
  }

  function appendExternal(
    state: WorkbenchState,
    operation: ExternalOperation,
  ): string {
    const { operationId, sequence, at } = nextOperation()
    const status = operation.status ?? 'applied'
    commit(state, {
      id: operationId,
      sequence,
      type: operation.type,
      title: operation.title,
      input: operation.input ?? {},
      source: operation.source ?? 'manual',
      at,
      undoable: false,
      status,
      summary: status === 'applied' ? operation.summary : null,
      issues: operation.issues ?? [],
    })
    return operationId
  }

  return {
    store,
    getState: () => store.getState().state,
    record: (operation) => appendExternal(store.getState().state, operation),
    load: (state, operation) => {
      undoStack.length = 0
      redoStack.length = 0
      return appendExternal(state, operation)
    },
    adopt: (state, operations) => {
      if (operations.length === 0) {
        store.setState({ state })
        return []
      }
      return operations.map((operation) => appendExternal(state, operation))
    },
    clearHistory: () => {
      undoStack.length = 0
      redoStack.length = 0
      store.setState({ canUndo: false, canRedo: false })
    },
    execute,
    undo: (source = 'manual') => replay('history.undo', source),
    redo: (source = 'manual') => replay('history.redo', source),
  }
}
