import { z } from 'zod'
import { GROUP, upsertAsset } from './assets.ts'
import {
  captureSignature,
  groupOf,
  isItemStage,
  outstandingItems,
  retryBlocker,
  retryScope,
  signatureMismatch,
} from './jobs/runGroups.ts'
import {
  preprocessBuilding,
  publishPreprocessing,
  runSimulatedStage,
  validatePreprocessing,
  type StageRunResult,
} from './simulation.ts'
import type {
  Building,
  CommandSource,
  EditValue,
  EditableBuildingField,
  StageRecord,
  Task,
  WorkbenchState,
} from './types.ts'
import {
  STAGE_IDS,
  hasActiveTask,
  stageRunBlocker,
  topologicalOrder,
  upstreamIds,
} from './workflow.ts'

// Every change to workbench state goes through one of these commands, whether it
// comes from a manual control, the scripted agent, or the task simulator.

export type ValidationIssue = { path: string; message: string }

export type CommandOutcome =
  | { status: 'applied'; summary: string }
  | { status: 'rejected'; issues: ValidationIssue[] }

export type CommandContext = {
  operationId: string
  source: CommandSource
  now: string
}

type CommandDefinition<Schema extends z.ZodType> = {
  title: string
  description: string
  input: Schema
  /** Undoable commands change the project model; the rest change runtime, selection, or draft state. */
  undoable: boolean
  run: (
    state: WorkbenchState,
    input: z.output<Schema>,
    context: CommandContext,
  ) => CommandOutcome
}

function defineCommand<Schema extends z.ZodType>(
  definition: CommandDefinition<Schema>,
): CommandDefinition<Schema> {
  return definition
}

function applied(summary: string): CommandOutcome {
  return { status: 'applied', summary }
}

function rejected(message: string, path = ''): CommandOutcome {
  return { status: 'rejected', issues: [{ path, message }] }
}

export function allocateId(state: WorkbenchState, prefix: string): string {
  const id = `${prefix}-${state.nextId}`
  state.nextId += 1
  return id
}

/** Records a failed run on its stage, task, log, and issues. */
function failRun(
  state: WorkbenchState,
  task: Task,
  stage: StageRecord,
  message: string,
  inputRevisions: Record<string, number>,
  context: CommandContext,
) {
  stage.lastRun = {
    runId: task.runId,
    operationId: context.operationId,
    outcome: 'failed',
    message,
    inputRevisions,
    inputEditRevision: stage.editRevision,
    finishedAt: context.now,
  }
  state.issues.push({
    id: allocateId(state, 'issue'),
    severity: 'error',
    message,
    stageId: stage.id,
    createdAt: context.now,
  })
  task.status = 'failed'
  task.message = message
  task.updatedAt = context.now
  task.log.push({ at: context.now, message: `Failed: ${message}` })
}

function nextRevision(state: WorkbenchState): number {
  const revision = state.nextId
  state.nextId += 1
  return revision
}

const requestIdSchema = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Optional client key for this submission; repeating it creates nothing new.',
  )

const JOB_STATUS_WORDS: Record<Task['status'], string> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  invalidated: 'finished without running',
}

/**
 * Why an item stage's inputs cannot produce results at all. Missing data is
 * not a transient fault, so it rejects the run instead of failing items that
 * a retry with the same inputs could never fix.
 */
function itemInputBlocker(
  state: WorkbenchState,
  stageId: string,
): string | null {
  if (stageId !== STAGE_IDS.preprocessing) return null
  const missing = state.buildingIds.filter(
    (id) => (state.buildings[id]?.floors ?? null) === null,
  ).length
  return missing > 0
    ? `Floor counts are missing for ${missing} building${missing === 1 ? '' : 's'}. Run "Geospatial data enriching" first.`
    : null
}

/** An earlier submission with the same key, answered again without creating a job. */
function repeatedSubmission(
  state: WorkbenchState,
  requestId: string | undefined,
): CommandOutcome | null {
  if (!requestId) return null
  const task = Object.values(state.tasks).find(
    (candidate) => candidate.requestId === requestId,
  )
  return task
    ? applied(
        `Already accepted as attempt ${task.attempt} of "${task.label}"; nothing new was queued.`,
      )
    : null
}

/** Adds a queued attempt to a run group. */
function createAttempt(
  state: WorkbenchState,
  stage: StageRecord,
  groupId: string,
  options: {
    items: string[] | null
    parentTaskId: string | null
    requestId: string | null
    context: CommandContext
  },
): Task {
  const group = state.runGroups[groupId]
  stage.runCount += 1
  const taskId = allocateId(state, 'task')
  const runId = allocateId(state, 'run')
  const attempt = (group?.attemptIds.length ?? 0) + 1
  const { context, items } = options
  const task: Task = {
    id: taskId,
    label: stage.name,
    stageId: stage.id,
    runId,
    status: 'queued',
    progress: 0,
    message: null,
    source: context.source,
    createdAt: context.now,
    updatedAt: context.now,
    log: [
      {
        at: context.now,
        message:
          attempt === 1
            ? `Queued${items ? ` with ${items.length} items` : ''}.`
            : `Queued as attempt ${attempt}${items ? ` for ${items.length} items` : ''}.`,
      },
    ],
    groupId,
    attempt,
    parentTaskId: options.parentTaskId,
    requestId: options.requestId,
    items: items
      ? { ids: [...items], processed: 0, succeeded: 0, failures: {} }
      : null,
  }
  state.tasks[taskId] = task
  state.taskIds.push(taskId)
  group?.attemptIds.push(taskId)
  return task
}

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use at most 80 characters.')

const buildingUseSchema = z.enum([
  'residential',
  'office',
  'retail',
  'school',
  'mixed',
])

function pendingKey(entityId: string, field: EditableBuildingField): string {
  return `${entityId}:${field}`
}

function setPendingEdit(
  state: WorkbenchState,
  building: Building,
  field: EditableBuildingField,
  to: EditValue,
): CommandOutcome {
  const key = pendingKey(building.id, field)
  const from = building[field]
  if (from === to) {
    delete state.pendingEdits[key]
    return applied(
      `No change to ${field} of ${building.id}; pending edit cleared.`,
    )
  }
  state.pendingEdits[key] = { entityId: building.id, field, from, to }
  return applied(
    `Pending: ${field} of ${building.id} from ${String(from)} to ${String(to)}.`,
  )
}

function uniqueName(items: { name: string }[], name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return !items.some((item) => item.name.trim().toLowerCase() === normalized)
}

export const commandDefinitions = {
  'workflow.setCurrentStage': defineCommand({
    title: 'Focus stage',
    description: 'Make a stage the current focus of the workflow.',
    input: z.object({ stageId: z.string().min(1, 'Choose a stage.') }),
    undoable: false,
    run(state, { stageId }) {
      const stage = state.workflow.stages[stageId]
      if (!stage) return rejected(`Unknown stage "${stageId}".`, 'stageId')
      state.workflow.currentStageId = stageId
      return applied(`Focused "${stage.name}".`)
    },
  }),

  'workflow.runStage': defineCommand({
    title: 'Run stage',
    description:
      'Queue a fresh simulated run of a stage as a background job, capturing its inputs. Earlier stages must be executed or skipped. Jobs run one at a time in the order submitted.',
    input: z.object({
      stageId: z.string().min(1, 'Choose a stage.'),
      requestId: requestIdSchema,
    }),
    undoable: false,
    run(state, { stageId, requestId }, context) {
      const repeated = repeatedSubmission(state, requestId)
      if (repeated) return repeated
      const blocker =
        stageRunBlocker(state.workflow, state.tasks, stageId) ??
        itemInputBlocker(state, stageId)
      const stage = state.workflow.stages[stageId]
      if (blocker || !stage) {
        return rejected(blocker ?? `Unknown stage "${stageId}".`, 'stageId')
      }
      for (const group of Object.values(state.runGroups)) {
        if (group.stageId === stageId && group.status === 'open') {
          group.status = 'superseded'
          group.statusReason = 'A fresh run of this stage replaced it.'
          group.held = {}
        }
      }
      const groupId = allocateId(state, 'group')
      const signature = captureSignature(state, stageId)
      state.runGroups[groupId] = {
        id: groupId,
        stageId,
        signature,
        attemptIds: [],
        held: {},
        status: 'open',
        statusReason: null,
        createdAt: context.now,
      }
      state.runGroupIds.push(groupId)
      const task = createAttempt(state, stage, groupId, {
        items: isItemStage(stageId) ? signature.membership : null,
        parentTaskId: null,
        requestId: requestId ?? null,
        context,
      })
      state.workflow.currentStageId = stageId
      return applied(
        `Queued a simulated run of "${stage.name}"${task.items ? ` for ${task.items.ids.length} items` : ''}.`,
      )
    },
  }),

  'job.retry': defineCommand({
    title: 'Retry job',
    description:
      'Retry a failed run with unchanged inputs as a new linked attempt. Item runs retry only failed or unprocessed items and keep held successes; a run whose items all succeeded retries publication. Cancelled runs and runs whose inputs changed need a fresh run instead.',
    input: z.object({
      taskId: z.string().min(1, 'Choose a job.'),
      requestId: requestIdSchema,
    }),
    undoable: false,
    run(state, { taskId, requestId }, context) {
      const repeated = repeatedSubmission(state, requestId)
      if (repeated) return repeated
      const blocker = retryBlocker(state, taskId)
      if (blocker) return rejected(blocker, 'taskId')
      const task = state.tasks[taskId]
      const group = task?.groupId ? state.runGroups[task.groupId] : undefined
      const stage = group ? state.workflow.stages[group.stageId] : undefined
      if (!task || !group || !stage) return rejected('Unknown job.', 'taskId')
      const parent = state.tasks[group.attemptIds.at(-1) ?? ''] ?? task
      const scope = retryScope(group).toLowerCase()
      const items = isItemStage(group.stageId) ? outstandingItems(group) : null
      const retry = createAttempt(state, stage, group.id, {
        items,
        parentTaskId: parent.id,
        requestId: requestId ?? null,
        context,
      })
      state.workflow.currentStageId = stage.id
      return applied(
        `Queued attempt ${retry.attempt} of "${stage.name}": ${scope}.`,
      )
    },
  }),

  'workflow.setStageSkipped': defineCommand({
    title: 'Skip or restore stage',
    description:
      'Skip an optional stage, or restore a skipped stage. Downstream stages treat skipped stages as satisfied.',
    input: z.object({
      stageId: z.string().min(1, 'Choose a stage.'),
      skipped: z.boolean(),
    }),
    undoable: true,
    run(state, { stageId, skipped }) {
      const stage = state.workflow.stages[stageId]
      if (!stage) return rejected(`Unknown stage "${stageId}".`, 'stageId')
      if (skipped && !stage.skippable) {
        return rejected(
          `"${stage.name}" is required and cannot be skipped.`,
          'stageId',
        )
      }
      if (hasActiveTask(state.tasks, stageId)) {
        return rejected(`"${stage.name}" is running.`, 'stageId')
      }
      if (stage.skipped === skipped) {
        return rejected(
          skipped
            ? `"${stage.name}" is already skipped.`
            : `"${stage.name}" is not skipped.`,
          'skipped',
        )
      }
      stage.skipped = skipped
      stage.revision = nextRevision(state)
      return applied(
        skipped ? `Skipped "${stage.name}".` : `Restored "${stage.name}".`,
      )
    },
  }),

  'workflow.insertStage': defineCommand({
    title: 'Insert custom stage',
    description:
      'Insert a custom checkpoint stage after an existing stage, keeping the graph acyclic.',
    input: z.object({
      afterStageId: z.string().min(1, 'Choose a stage.'),
      name: nameSchema,
      description: z.string().trim().max(200).default(''),
    }),
    undoable: true,
    run(state, { afterStageId, name, description }) {
      const workflow = state.workflow
      const after = workflow.stages[afterStageId]
      if (!after) {
        return rejected(`Unknown stage "${afterStageId}".`, 'afterStageId')
      }
      if (!uniqueName(Object.values(workflow.stages), name)) {
        return rejected(`A stage named "${name}" already exists.`, 'name')
      }
      const id = allocateId(state, 'stage:custom')
      const outgoing = workflow.edges.filter(
        (edge) => edge.from === afterStageId,
      )
      const edges = [
        ...workflow.edges.filter((edge) => edge.from !== afterStageId),
        { from: afterStageId, to: id },
        ...outgoing.map((edge) => ({ from: id, to: edge.to })),
      ]
      const stageIds = [...workflow.stageIds]
      stageIds.splice(stageIds.indexOf(afterStageId) + 1, 0, id)
      if (topologicalOrder(stageIds, edges) === null) {
        return rejected('Inserting here would create a cycle.', 'afterStageId')
      }
      workflow.stages[id] = {
        id,
        name,
        description: description || 'Custom checkpoint added to the workflow.',
        capability: 'workflow.graph',
        skippable: true,
        custom: true,
        skipped: false,
        revision: 0,
        editRevision: 0,
        runCount: 0,
        lastRun: null,
        unavailableReason: null,
      }
      workflow.stageIds = stageIds
      workflow.edges = edges
      return applied(`Inserted "${name}" after "${after.name}".`)
    },
  }),

  'task.start': defineCommand({
    title: 'Start task',
    description:
      'Move a queued task to running after checking that its captured inputs are unchanged; otherwise finish it without running.',
    input: z.object({ taskId: z.string().min(1) }),
    undoable: false,
    run(state, { taskId }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown task "${taskId}".`, 'taskId')
      if (task.status !== 'queued') {
        return rejected(`Task is ${task.status}, not queued.`, 'taskId')
      }
      const group = groupOf(state, task)
      const changed = group ? signatureMismatch(state, group) : null
      if (group && changed) {
        const reason = `Not run: ${changed} after it was queued.`
        task.status = 'invalidated'
        task.message = `${reason} Start a fresh run.`
        task.updatedAt = context.now
        task.log.push({ at: context.now, message: task.message })
        group.status = 'invalidated'
        group.statusReason = reason
        group.held = {}
        return applied(`"${task.label}" was not run because ${changed}.`)
      }
      task.status = 'running'
      task.updatedAt = context.now
      task.log.push({ at: context.now, message: 'Started.' })
      return applied(`Started "${task.label}".`)
    },
  }),

  'task.reportProgress': defineCommand({
    title: 'Report task progress',
    description: 'Record progress for a running task.',
    input: z.object({
      taskId: z.string().min(1),
      progress: z.number().min(0).max(1),
    }),
    undoable: false,
    run(state, { taskId, progress }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown task "${taskId}".`, 'taskId')
      if (task.status !== 'running') {
        return rejected(`Task is ${task.status}, not running.`, 'taskId')
      }
      if (progress < task.progress) {
        return rejected('Progress cannot move backwards.', 'progress')
      }
      task.progress = progress
      task.updatedAt = context.now
      task.log.push({
        at: context.now,
        message: `${Math.round(progress * 100)}% complete.`,
      })
      return applied(
        `"${task.label}" is ${Math.round(progress * 100)}% complete.`,
      )
    },
  }),

  'task.processItems': defineCommand({
    title: 'Process job items',
    description:
      'Compute the next items of a running item job. Successful outputs are held on the run group, not applied to the project; failures are recorded per item.',
    input: z.object({
      taskId: z.string().min(1),
      count: z.number().int().min(1),
      /** Items the execution fails, with reasons (demo conditions). */
      failures: z.record(z.string(), z.string()).default({}),
    }),
    undoable: false,
    run(state, { taskId, count, failures }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown task "${taskId}".`, 'taskId')
      if (task.status !== 'running') {
        return rejected(`Task is ${task.status}, not running.`, 'taskId')
      }
      const items = task.items
      const group = groupOf(state, task)
      if (!items || !group) {
        return rejected('This job has no items to process.', 'taskId')
      }
      const batch = items.ids.slice(items.processed, items.processed + count)
      let failed = 0
      for (const id of batch) {
        const building = state.buildings[id]
        const output = building ? preprocessBuilding(building) : null
        const reason =
          failures[id] ??
          (!building
            ? 'The building no longer exists.'
            : !output
              ? 'The floor count is missing.'
              : null)
        if (reason || !output) {
          items.failures[id] = reason ?? 'No result.'
          failed += 1
        } else {
          group.held[id] = output
          items.succeeded += 1
        }
        items.processed += 1
      }
      const total = items.ids.length
      task.progress = total === 0 ? 1 : items.processed / total
      task.updatedAt = context.now
      task.log.push({
        at: context.now,
        message: `Processed ${items.processed} of ${total} items${failed > 0 ? `; ${failed} failed in this batch` : ''}.`,
      })
      return applied(
        `"${task.label}" processed ${items.processed} of ${total} items.`,
      )
    },
  }),

  'task.complete': defineCommand({
    title: 'Complete task',
    description:
      'Finish a running job: publish a complete, validated result once, or record why it is held or failed.',
    input: z.object({
      taskId: z.string().min(1),
      /** Fails publication with this reason (demo conditions). */
      failPublication: z.string().min(1).optional(),
    }),
    undoable: false,
    run(state, { taskId, failPublication }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown task "${taskId}".`, 'taskId')
      if (task.status !== 'running') {
        return rejected(`Task is ${task.status}, not running.`, 'taskId')
      }
      const stage = state.workflow.stages[task.stageId]
      if (!stage) {
        task.status = 'failed'
        task.message = 'The stage no longer exists.'
        task.updatedAt = context.now
        task.log.push({
          at: context.now,
          message: 'Failed: the stage no longer exists.',
        })
        return applied('Task failed because its stage no longer exists.')
      }
      if (task.items && task.items.processed < task.items.ids.length) {
        return rejected(
          `${task.items.ids.length - task.items.processed} items are still pending.`,
          'taskId',
        )
      }
      const inputRevisions = Object.fromEntries(
        upstreamIds(state.workflow, stage.id).map((id) => [
          id,
          state.workflow.stages[id]?.revision ?? 0,
        ]),
      )
      const group = groupOf(state, task)
      state.issues = state.issues.filter((issue) => issue.stageId !== stage.id)
      task.updatedAt = context.now

      const changed = group ? signatureMismatch(state, group) : null
      if (group && changed) {
        group.status = 'invalidated'
        group.statusReason = `Not published: ${changed} during the run.`
        group.held = {}
        const message = `${group.statusReason} Start a fresh run.`
        failRun(state, task, stage, message, inputRevisions, context)
        return applied(`"${stage.name}" was not published: ${changed}.`)
      }

      let result: StageRunResult
      if (group && task.items) {
        const failures = Object.keys(task.items.failures).length
        if (failures > 0) {
          const held = Object.keys(group.held).length
          const message = `${failures} of ${task.items.ids.length} items failed. ${held} successful results are held and not published until the failed items are retried.`
          failRun(state, task, stage, message, inputRevisions, context)
          return applied(`"${stage.name}" partly failed: ${message}`)
        }
        const membership = group.signature.membership
        const invalid =
          failPublication ??
          validatePreprocessing(state, membership, group.held)
        if (invalid) {
          group.statusReason = `Publication failed: ${invalid}`
          const message = `Publication failed: ${invalid}. All ${membership.length} results stay held; retry publication once the cause is resolved.`
          failRun(state, task, stage, message, inputRevisions, context)
          return applied(`"${stage.name}" was not published: ${invalid}.`)
        }
        result = publishPreprocessing(state, membership, group.held, {
          runId: task.runId,
          operationId: context.operationId,
          attempt: stage.runCount,
        })
      } else {
        result = runSimulatedStage(state, stage.id, {
          runId: task.runId,
          operationId: context.operationId,
          attempt: stage.runCount,
        })
      }

      if (!result.ok) {
        failRun(state, task, stage, result.message, inputRevisions, context)
        return applied(`"${stage.name}" failed: ${result.message}`)
      }

      stage.revision = nextRevision(state)
      stage.lastRun = {
        runId: task.runId,
        operationId: context.operationId,
        outcome: 'succeeded',
        message: result.summary,
        inputRevisions,
        inputEditRevision: stage.editRevision,
        finishedAt: context.now,
      }
      if (group) {
        group.status = 'published'
        group.statusReason = null
        group.held = {}
      }
      for (const warning of result.warnings) {
        state.issues.push({
          id: allocateId(state, 'issue'),
          severity: 'warning',
          message: warning,
          stageId: stage.id,
          createdAt: context.now,
        })
      }
      task.status = 'succeeded'
      task.progress = 1
      task.message = result.summary
      task.log.push({
        at: context.now,
        message: `Completed. ${result.summary}`,
      })
      return applied(`"${stage.name}" finished. ${result.summary}`)
    },
  }),

  'task.fail': defineCommand({
    title: 'Fail task',
    description:
      'Fail a running job without publishing, as when the server reports an error partway. Item outputs computed so far stay held.',
    input: z.object({
      taskId: z.string().min(1),
      message: z.string().min(1, 'Give a reason.'),
    }),
    undoable: false,
    run(state, { taskId, message }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown task "${taskId}".`, 'taskId')
      if (task.status !== 'running') {
        return rejected(`Task is ${task.status}, not running.`, 'taskId')
      }
      const stage = state.workflow.stages[task.stageId]
      if (!stage) return rejected('The stage no longer exists.', 'taskId')
      const inputRevisions = Object.fromEntries(
        upstreamIds(state.workflow, stage.id).map((id) => [
          id,
          state.workflow.stages[id]?.revision ?? 0,
        ]),
      )
      state.issues = state.issues.filter((issue) => issue.stageId !== stage.id)
      failRun(state, task, stage, message, inputRevisions, context)
      return applied(`"${stage.name}" failed: ${message}`)
    },
  }),

  'task.cancel': defineCommand({
    title: 'Cancel job',
    description:
      'Cancel a queued or running job. Nothing is published; completed item diagnostics stay in its record, and the run needs a fresh run rather than a retry.',
    input: z.object({ taskId: z.string().min(1, 'Choose a job.') }),
    undoable: false,
    run(state, { taskId }, context) {
      const task = state.tasks[taskId]
      if (!task) return rejected(`Unknown job "${taskId}".`, 'taskId')
      if (task.status !== 'queued' && task.status !== 'running') {
        return rejected(
          `The job is already ${JOB_STATUS_WORDS[task.status]}.`,
          'taskId',
        )
      }
      task.status = 'cancelled'
      task.message = 'Cancelled. Nothing was published; start a fresh run.'
      task.updatedAt = context.now
      task.log.push({ at: context.now, message: 'Cancelled.' })
      const group = groupOf(state, task)
      if (group && group.status === 'open') {
        group.status = 'cancelled'
        group.statusReason = 'This run was cancelled.'
        group.held = {}
      }
      return applied(`Cancelled "${task.label}". Nothing was published.`)
    },
  }),

  'selection.set': defineCommand({
    title: 'Select',
    description:
      'Replace the shared selection with buildings or grid elements. Unknown ids are rejected.',
    input: z.object({
      entityType: z.enum(['building', 'gridElement']),
      ids: z.array(z.string().min(1)).max(10_000),
    }),
    undoable: false,
    run(state, { entityType, ids }) {
      const collection: Record<string, unknown> =
        entityType === 'building' ? state.buildings : state.gridElements
      const unknown = ids.filter((id) => !(id in collection))
      if (unknown.length > 0) {
        return rejected(
          `Unknown ${entityType} id(s): ${unknown.slice(0, 5).join(', ')}.`,
          'ids',
        )
      }
      const unique = [...new Set(ids)]
      state.selection =
        unique.length === 0
          ? { entityType: null, ids: [] }
          : { entityType, ids: unique }
      return applied(
        unique.length === 0
          ? 'Selection cleared.'
          : `Selected ${unique.length} ${entityType === 'building' ? 'building(s)' : 'grid element(s)'}.`,
      )
    },
  }),

  'selection.clear': defineCommand({
    title: 'Clear selection',
    description: 'Clear the shared selection explicitly.',
    input: z.object({}),
    undoable: false,
    run(state) {
      state.selection = { entityType: null, ids: [] }
      return applied('Selection cleared.')
    },
  }),

  'edits.propose': defineCommand({
    title: 'Propose edit',
    description:
      'Validate a building edit and hold it as pending until applied or discarded.',
    input: z.object({
      entityId: z.string().min(1, 'Choose a building.'),
      field: z.enum(['floors', 'archetypeId']),
      value: z.union([z.number(), z.string(), z.null()]),
    }),
    undoable: false,
    run(state, { entityId, field, value }) {
      const building = state.buildings[entityId]
      if (!building)
        return rejected(`Unknown building "${entityId}".`, 'entityId')

      if (field === 'floors') {
        if (building.floors === null) {
          return rejected(
            'Floors are available after "Geospatial data enriching" runs.',
            'field',
          )
        }
        const parsed = z
          .number()
          .int()
          .min(1)
          .max(60)
          .safeParse(typeof value === 'string' ? Number(value) : value)
        if (!parsed.success) {
          return rejected(
            'Floors must be a whole number from 1 to 60.',
            'value',
          )
        }
        return setPendingEdit(state, building, 'floors', parsed.data)
      }

      if (Object.keys(state.archetypes).length === 0) {
        return rejected(
          'Archetypes are available after "Archetype modeling" runs.',
          'field',
        )
      }
      if (
        value !== null &&
        (typeof value !== 'string' || !state.archetypes[value])
      ) {
        return rejected('Choose an existing archetype or none.', 'value')
      }
      return setPendingEdit(state, building, 'archetypeId', value)
    },
  }),

  'edits.apply': defineCommand({
    title: 'Apply edits',
    description:
      'Apply all pending edits as manual overrides. Stages downstream of the edited data become outdated.',
    input: z.object({}),
    undoable: true,
    run(state, _input, context) {
      const edits = Object.values(state.pendingEdits)
      if (edits.length === 0) {
        return rejected('There are no pending edits to apply.')
      }
      const ownerStageIds = new Set<string>()
      for (const edit of edits) {
        const building = state.buildings[edit.entityId]
        if (!building) continue
        if (edit.field === 'floors' && typeof edit.to === 'number') {
          building.floors = edit.to
          ownerStageIds.add(STAGE_IDS.enrichment)
        } else if (
          edit.field === 'archetypeId' &&
          (edit.to === null || typeof edit.to === 'string')
        ) {
          building.archetypeId = edit.to
          ownerStageIds.add(STAGE_IDS.archetypes)
        } else {
          continue
        }
        state.overrides[pendingKey(edit.entityId, edit.field)] = {
          entityId: edit.entityId,
          field: edit.field,
          value: edit.to,
          operationId: context.operationId,
          source: context.source,
        }
      }
      for (const stageId of ownerStageIds) {
        const stage = state.workflow.stages[stageId]
        if (stage) stage.revision = nextRevision(state)
      }
      state.pendingEdits = {}
      return applied(
        `Applied ${edits.length} edit(s); stages downstream of the edited data are now outdated.`,
      )
    },
  }),

  'edits.discard': defineCommand({
    title: 'Discard edits',
    description: 'Discard all pending edits without changing the model.',
    input: z.object({}),
    undoable: false,
    run(state) {
      const count = Object.keys(state.pendingEdits).length
      if (count === 0) return rejected('There are no pending edits to discard.')
      state.pendingEdits = {}
      return applied(`Discarded ${count} pending edit(s).`)
    },
  }),

  'measure.create': defineCommand({
    title: 'Create measure',
    description:
      'Create a retrofit measure. PV measures use estimated PV yield instead of a savings percentage.',
    input: z.object({
      name: nameSchema,
      kind: z.enum(['envelope', 'heating', 'lighting', 'pv']),
      savingsPercent: z
        .number()
        .min(0, 'Savings cannot be negative.')
        .max(60, 'Savings must be at most 60%.'),
      appliesTo: z.enum([...buildingUseSchema.options, 'all']),
    }),
    undoable: true,
    run(state, input, context) {
      if (!uniqueName(Object.values(state.measures), input.name)) {
        return rejected(
          `A measure named "${input.name}" already exists.`,
          'name',
        )
      }
      if (input.kind === 'pv' && input.savingsPercent !== 0) {
        return rejected(
          'PV measures use estimated PV yield; set savings to 0%.',
          'savingsPercent',
        )
      }
      const id = allocateId(state, 'measure')
      state.measures[id] = { id, ...input }
      upsertAsset(state, {
        id: `asset:${id}`,
        kind: 'measure',
        name: input.name,
        parentId: GROUP.measures,
        provenance: {
          kind: 'operation',
          source: context.source,
          operationId: context.operationId,
        },
        capability: 'creator.measure',
        summary:
          input.kind === 'pv'
            ? `PV from estimated yield; applies to ${input.appliesTo}`
            : `${input.kind}, ${input.savingsPercent}% savings; applies to ${input.appliesTo}`,
        entityIds: [id],
      })
      const definitions = state.workflow.stages[STAGE_IDS.scenarioDefinitions]
      if (definitions) definitions.editRevision = nextRevision(state)
      return applied(`Created measure "${input.name}".`)
    },
  }),

  'scenario.create': defineCommand({
    title: 'Create scenario',
    description:
      'Create a scenario from existing measures and an adoption rate.',
    input: z.object({
      name: nameSchema,
      measureIds: z
        .array(z.string().min(1))
        .min(1, 'Choose at least one measure.'),
      adoptionPercent: z
        .number()
        .min(0, 'Adoption cannot be negative.')
        .max(100, 'Adoption must be at most 100%.'),
    }),
    undoable: true,
    run(state, input, context) {
      if (!uniqueName(Object.values(state.scenarios), input.name)) {
        return rejected(
          `A scenario named "${input.name}" already exists.`,
          'name',
        )
      }
      const unknown = input.measureIds.filter((id) => !state.measures[id])
      if (unknown.length > 0) {
        return rejected(
          `Unknown measure(s): ${unknown.join(', ')}.`,
          'measureIds',
        )
      }
      const id = allocateId(state, 'scenario')
      const measureIds = [...new Set(input.measureIds)]
      state.scenarios[id] = {
        id,
        name: input.name,
        measureIds,
        adoptionPercent: input.adoptionPercent,
      }
      upsertAsset(state, {
        id: `asset:${id}`,
        kind: 'scenario',
        name: input.name,
        parentId: GROUP.scenarios,
        provenance: {
          kind: 'operation',
          source: context.source,
          operationId: context.operationId,
        },
        capability: 'creator.scenario',
        summary: `${measureIds.length} measure(s) at ${input.adoptionPercent}% adoption`,
        entityIds: [id, ...measureIds],
      })
      const definitions = state.workflow.stages[STAGE_IDS.scenarioDefinitions]
      if (definitions) definitions.editRevision = nextRevision(state)
      return applied(`Created scenario "${input.name}".`)
    },
  }),
  'scenario.setAdoption': defineCommand({
    title: 'Set scenario adoption',
    description:
      'Change a scenario adoption rate. Scenario definitions and downstream results become outdated.',
    input: z.object({
      scenarioId: z.string().min(1, 'Choose a scenario.'),
      adoptionPercent: z
        .number()
        .min(0, 'Adoption cannot be negative.')
        .max(100, 'Adoption must be at most 100%.'),
    }),
    undoable: true,
    run(state, { scenarioId, adoptionPercent }) {
      const scenario = state.scenarios[scenarioId]
      if (!scenario) {
        return rejected(`Unknown scenario "${scenarioId}".`, 'scenarioId')
      }
      if (scenario.adoptionPercent === adoptionPercent) {
        return rejected(
          `"${scenario.name}" already uses ${adoptionPercent}% adoption.`,
          'adoptionPercent',
        )
      }
      const previous = scenario.adoptionPercent
      scenario.adoptionPercent = adoptionPercent
      const asset = state.assets[`asset:${scenarioId}`]
      if (asset) {
        asset.summary = `${scenario.measureIds.length} measure(s) at ${adoptionPercent}% adoption`
      }
      const definitions = state.workflow.stages[STAGE_IDS.scenarioDefinitions]
      if (definitions) definitions.editRevision = nextRevision(state)
      return applied(
        `Set adoption for "${scenario.name}" from ${previous}% to ${adoptionPercent}%.`,
      )
    },
  }),
}

export type CommandType = keyof typeof commandDefinitions

export type CommandInput<Type extends CommandType> = z.input<
  (typeof commandDefinitions)[Type]['input']
>

export type Command = {
  [Type in CommandType]: { type: Type; input: CommandInput<Type> }
}[CommandType]

export type CommandDescription = {
  type: CommandType
  title: string
  description: string
  undoable: boolean
  inputSchema: unknown
}

/** Command catalog with JSON Schema inputs, for future agent tool definitions. */
export function describeCommands(): CommandDescription[] {
  return (Object.keys(commandDefinitions) as CommandType[]).map((type) => {
    const definition = commandDefinitions[type]
    return {
      type,
      title: definition.title,
      description: definition.description,
      undoable: definition.undoable,
      inputSchema: z.toJSONSchema(definition.input, { io: 'input' }),
    }
  })
}
