import { createStore } from 'zustand/vanilla'
import type { ValidationIssue } from '../../domain/commands.ts'
import type { CommandSource } from '../../domain/types.ts'
import type { ExecuteResult, Workbench } from '../../domain/workbench.ts'
import type { FixtureId } from '../../server/fixtures.ts'
import type { ProjectClient } from './projectClient.ts'
import { projectNameSchema } from '../../server/projectValidation.ts'

export type ProjectIntent =
  | { type: 'list' }
  | { type: 'create'; name: string }
  | { type: 'open'; projectId: string }
  | { type: 'close' }
  | { type: 'save' }
  | { type: 'fixture'; fixture: FixtureId }
export type LifecycleSnapshot = {
  dialog: 'create' | 'open' | null
  guard: ProjectIntent | null
  busy: boolean
  issues: ValidationIssue[]
}
export type ProjectLifecycle = ReturnType<typeof createProjectLifecycle>

/** One guard for manual actions and agent tools. Stay never sends a request. */
export function createProjectLifecycle({
  workbench,
  client,
  viewUnsaved = () => false,
}: {
  workbench: Workbench
  client: ProjectClient
  /** Whether views saved with the project, such as tables, changed since saving. */
  viewUnsaved?: () => boolean
}) {
  const store = createStore<LifecycleSnapshot>()(() => ({
    dialog: null,
    guard: null,
    busy: false,
    issues: [],
  }))
  let waiting: {
    intent: ProjectIntent
    source: CommandSource
    resolve: (result: ExecuteResult) => void
  } | null = null

  function refused(message: string, path = ''): ExecuteResult {
    const issues = [{ path, message }]
    const operationId = workbench.record({
      type: 'project.transition',
      title: 'Change project session',
      status: 'rejected',
      summary: '',
      issues,
    })
    return { operationId, outcome: { status: 'rejected', issues } }
  }
  function activeJobs() {
    return Object.values(workbench.getState().tasks).filter(
      (task) => task.status === 'queued' || task.status === 'running',
    )
  }
  function hasDrafts() {
    return Object.keys(workbench.getState().pendingEdits).length > 0
  }
  async function perform(
    intent: ProjectIntent,
    source: CommandSource,
    mode: 'save' | 'discard' | 'appliedOnly',
  ): Promise<ExecuteResult> {
    store.setState({ busy: true, issues: [] })
    const run = async (execute: ProjectClient['execute']) => {
      if (intent.type !== 'save' && intent.type !== 'list') {
        for (const task of activeJobs()) {
          const result = await execute(
            { type: 'task.cancel', input: { taskId: task.id } },
            source,
          )
          if (result.outcome.status === 'rejected') return result
        }
      }
      if (mode === 'save') {
        if (hasDrafts()) {
          const applied = await execute(
            { type: 'edits.apply', input: {} },
            source,
          )
          if (applied.outcome.status === 'rejected') return applied
        }
        const saved = await client.save(source)
        if (saved.outcome.status === 'rejected' || intent.type === 'save')
          return saved
      }
      switch (intent.type) {
        case 'list':
          return await client.listProjects(source)
        case 'save':
          return await client.save(source)
        case 'create':
          return await client.createProject(intent.name, source)
        case 'open':
          return await client.openProject(intent.projectId, source)
        case 'close':
          return await client.closeProject(source)
        case 'fixture':
          return await client.replaceProject(intent.fixture, source)
      }
    }
    try {
      return await (intent.type === 'save' || intent.type === 'list'
        ? run(client.execute)
        : client.withTransition(run))
    } finally {
      store.setState({ busy: false })
    }
  }
  function display(result: ExecuteResult) {
    if (result.outcome.status === 'applied')
      store.setState({ dialog: null, issues: [] })
    else store.setState({ issues: result.outcome.issues })
    return result
  }
  return {
    store,
    clearIssue(path: string) {
      store.setState({
        issues: store.getState().issues.filter((issue) => issue.path !== path),
      })
    },
    openCreate() {
      if (!store.getState().busy && !waiting)
        store.setState({ dialog: 'create', issues: [] })
    },
    openCatalog() {
      if (!store.getState().busy && !waiting) {
        store.setState({ dialog: 'open', issues: [] })
        void client.listProjects()
      }
    },
    closeDialog() {
      if (!store.getState().busy && !waiting)
        store.setState({ dialog: null, issues: [] })
    },
    async request(
      intent: ProjectIntent,
      source: CommandSource = 'manual',
    ): Promise<ExecuteResult> {
      if (intent.type === 'create') {
        const parsed = projectNameSchema.safeParse(intent.name)
        if (!parsed.success)
          return display(
            refused(
              parsed.error.issues[0]?.message ?? 'Enter a project name.',
              'name',
            ),
          )
      }
      if (
        store.getState().busy ||
        waiting ||
        client.store.getState().pending.length > 0
      )
        return refused(
          'Wait for the current server request before changing the project session.',
        )
      const open = client.store.getState().meta.currentProject !== null
      const needsGuard =
        open &&
        intent.type !== 'list' &&
        (intent.type === 'save'
          ? hasDrafts()
          : client.store.getState().meta.dirty ||
            viewUnsaved() ||
            hasDrafts() ||
            activeJobs().length > 0)
      if (needsGuard) {
        return new Promise((resolve) => {
          waiting = { intent, source, resolve }
          store.setState({ guard: intent, issues: [] })
        })
      }
      return display(
        await perform(
          intent,
          source,
          intent.type === 'save' ? 'appliedOnly' : 'discard',
        ),
      )
    },
    async confirm(mode: 'save' | 'discard' | 'appliedOnly') {
      if (!waiting || store.getState().busy) return null
      const pending = waiting
      const result = display(
        await perform(pending.intent, pending.source, mode),
      )
      if (
        result.outcome.status === 'rejected' &&
        pending.intent.type === 'create' &&
        result.outcome.issues.some((issue) => issue.path === 'name')
      ) {
        waiting = null
        store.setState({ guard: null, dialog: 'create' })
        pending.resolve(result)
      }
      if (result.outcome.status === 'applied') {
        waiting = null
        store.setState({ guard: null })
        pending.resolve(result)
      }
      return result
    },
    stay() {
      if (!waiting || store.getState().busy) return
      const pending = waiting
      waiting = null
      store.setState({ guard: null, issues: [] })
      // A declined transition is a tool result, not a project change or an operation.
      pending.resolve({
        operationId: '',
        outcome: {
          status: 'rejected',
          issues: [
            {
              path: '',
              message: 'Cancelled. The current project remains open.',
            },
          ],
        },
      })
    },
  }
}
