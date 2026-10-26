import type {
  InputSignature,
  RunGroup,
  Task,
  TaskStatus,
  WorkbenchState,
  WorkflowState,
} from '../types.ts'
import { STAGE_IDS, stageRunBlocker, upstreamIds } from '../workflow.ts'

// Run groups (jobs rollout plan, shared run contract): every attempt at one
// stage run with one input context. A group captures what the run consumes
// when it is submitted and checks it again before start, retry, and
// publication. Selection, drafts, layout, and appearance are never inputs.

/** Stages whose work is split into independent items with held outputs. */
export const ITEM_STAGES: ReadonlySet<string> = new Set([
  STAGE_IDS.preprocessing,
])

export function isItemStage(stageId: string): boolean {
  return ITEM_STAGES.has(stageId)
}

export function isActiveStatus(status: TaskStatus): boolean {
  return status === 'queued' || status === 'running'
}

/** Every stage upstream of `stageId`, transitively, in no particular order. */
export function ancestorIds(
  workflow: WorkflowState,
  stageId: string,
): string[] {
  const seen = new Set<string>()
  const pending = upstreamIds(workflow, stageId)
  while (pending.length > 0) {
    const id = pending.pop() ?? ''
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...upstreamIds(workflow, id))
  }
  return [...seen]
}

/** Item membership a stage would use now. */
export function currentMembership(
  state: WorkbenchState,
  stageId: string,
): string[] {
  return isItemStage(stageId) ? [...state.buildingIds] : []
}

export function captureSignature(
  state: WorkbenchState,
  stageId: string,
): InputSignature {
  const workflow = state.workflow
  return {
    ancestors: Object.fromEntries(
      ancestorIds(workflow, stageId)
        .sort()
        .map((id) => [id, workflow.stages[id]?.revision ?? 0]),
    ),
    editRevision: workflow.stages[stageId]?.editRevision ?? 0,
    membership: currentMembership(state, stageId),
  }
}

/** Names the first consumed input that changed since `group` was submitted, or null. */
export function signatureMismatch(
  state: WorkbenchState,
  group: RunGroup,
): string | null {
  const stage = state.workflow.stages[group.stageId]
  if (!stage) return 'its stage no longer exists'
  const now = captureSignature(state, group.stageId)
  const before = group.signature
  const keys = new Set([
    ...Object.keys(now.ancestors),
    ...Object.keys(before.ancestors),
  ])
  for (const id of keys) {
    if (now.ancestors[id] !== before.ancestors[id]) {
      const name = state.workflow.stages[id]?.name ?? id
      return `the outputs of "${name}" changed`
    }
  }
  if (now.editRevision !== before.editRevision) {
    return `the inputs owned by "${stage.name}" changed`
  }
  if (
    now.membership.length !== before.membership.length ||
    now.membership.some((id, index) => before.membership[index] !== id)
  ) {
    return 'the set of buildings changed'
  }
  return null
}

export function groupOf(state: WorkbenchState, task: Task): RunGroup | null {
  return task.groupId ? (state.runGroups[task.groupId] ?? null) : null
}

export function latestAttempt(
  state: WorkbenchState,
  group: RunGroup,
): Task | null {
  const id = group.attemptIds.at(-1)
  return id ? (state.tasks[id] ?? null) : null
}

export type ItemStatus =
  'pending' | 'succeeded' | 'failed' | 'notProcessed' | 'cancelled'

/** One item's outcome within one attempt. */
export function itemStatusOf(task: Task, index: number): ItemStatus {
  const items = task.items
  if (!items) return 'pending'
  const id = items.ids[index] ?? ''
  if (index < items.processed) {
    return id in items.failures ? 'failed' : 'succeeded'
  }
  if (isActiveStatus(task.status)) return 'pending'
  return task.status === 'cancelled' ? 'cancelled' : 'notProcessed'
}

export type ItemCounts = {
  total: number
  succeeded: number
  failed: number
  pending: number
  /** Items an execution-wide failure or cancellation left unprocessed. */
  unprocessed: number
}

export function itemCounts(task: Task): ItemCounts | null {
  const items = task.items
  if (!items) return null
  const failed = Object.keys(items.failures).length
  const rest = items.ids.length - items.processed
  const active = isActiveStatus(task.status)
  return {
    total: items.ids.length,
    succeeded: items.succeeded,
    failed,
    pending: active ? rest : 0,
    unprocessed: active ? 0 : rest,
  }
}

/** Members of an item group that still need work: not held. */
export function outstandingItems(group: RunGroup): string[] {
  return group.signature.membership.filter((id) => !(id in group.held))
}

/** Why `task`'s run cannot be retried now, or null. Shared by the command and the UI. */
export function retryBlocker(
  state: WorkbenchState,
  taskId: string,
): string | null {
  const task = state.tasks[taskId]
  if (!task) return `Unknown job "${taskId}".`
  const group = groupOf(state, task)
  if (!group) {
    return 'This job was recorded before retries were possible. Start a fresh run instead.'
  }
  switch (group.status) {
    case 'published':
      return 'This run already finished and published its results.'
    case 'cancelled':
      return `${group.statusReason ?? 'This run was cancelled.'} Cancelled work is not resumed; start a fresh run.`
    case 'invalidated':
      return `${group.statusReason ?? 'Its inputs changed.'} Start a fresh run.`
    case 'superseded':
      return 'A newer run of this stage replaced this one. Retry or inspect the newer run.'
    case 'open':
      break
  }
  const latest = latestAttempt(state, group)
  if (!latest) return 'This run has no attempt to retry. Start a fresh run.'
  if (isActiveStatus(latest.status)) {
    return 'An attempt of this run is still queued or running.'
  }
  if (latest.status !== 'failed') {
    return 'Only a failed run can be retried.'
  }
  const changed = signatureMismatch(state, group)
  if (changed) {
    return `Inputs changed since this run was submitted: ${changed}. Start a fresh run; earlier successes are not combined with new inputs.`
  }
  return stageRunBlocker(state.workflow, state.tasks, group.stageId)
}

/** What a retry of the group would do, for buttons and confirmations. */
export function retryScope(group: RunGroup): string {
  if (!isItemStage(group.stageId)) return 'Retry the whole run'
  const outstanding = outstandingItems(group).length
  return outstanding === 0
    ? 'Retry publication of held results'
    : `Retry ${outstanding} failed item${outstanding === 1 ? '' : 's'}`
}

/** The failed latest attempt of a stage's open run, which a retry would continue; null when none. */
export function openFailedAttempt(
  state: WorkbenchState,
  stageId: string,
): Task | null {
  for (const id of [...state.runGroupIds].reverse()) {
    const group = state.runGroups[id]
    if (!group || group.stageId !== stageId || group.status !== 'open') continue
    const latest = latestAttempt(state, group)
    return latest?.status === 'failed' ? latest : null
  }
  return null
}

/** Results held by a stage's open run, which a fresh run would discard. */
export function heldCount(state: WorkbenchState, stageId: string): number {
  let held = 0
  for (const group of Object.values(state.runGroups)) {
    if (group.stageId === stageId && group.status === 'open') {
      held += Object.keys(group.held).length
    }
  }
  return held
}

/** Accessible-name suffix warning that a fresh run discards held results. */
export function discardNote(state: WorkbenchState, stageId: string): string {
  const held = heldCount(state, stageId)
  return held > 0
    ? `, discarding ${held} held result${held === 1 ? '' : 's'}`
    : ''
}
