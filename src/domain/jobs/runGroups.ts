import { findDataset } from '../intake/datasets.ts'
import { fusionOptions, prepareDataset } from '../intake/fusion.ts'
import type {
  FusionInput,
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
  STAGE_IDS.archetypes,
  STAGE_IDS.scenarioModeling,
])

/** Item stages whose items are buildings, which can be selected on the map and table. */
export const BUILDING_ITEM_STAGES: ReadonlySet<string> = new Set([
  STAGE_IDS.preprocessing,
  STAGE_IDS.archetypes,
])

export function isItemStage(stageId: string): boolean {
  return ITEM_STAGES.has(stageId)
}

/** Item groups hold per-item outputs: item stages and every data fusion. */
export function isItemGroup(
  group: Pick<RunGroup, 'kind' | 'stageId'>,
): boolean {
  return group.kind === 'fusion' || isItemStage(group.stageId)
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
  if (stageId === STAGE_IDS.scenarioModeling) {
    // The requested comparison set: included scenarios, in creation order.
    return Object.values(state.scenarios)
      .filter((scenario) => scenario.included)
      .map((scenario) => scenario.id)
  }
  return isItemStage(stageId) ? [...state.buildingIds] : []
}

/**
 * What a run consumes now. A fusion also consumes its dataset and mapping
 * (options) and the records that prepare as valid (membership).
 */
export function captureSignature(
  state: WorkbenchState,
  stageId: string,
  fusion: FusionInput | null = null,
): InputSignature {
  const workflow = state.workflow
  const dataset = fusion ? findDataset(fusion.datasetId) : null
  return {
    ancestors: Object.fromEntries(
      ancestorIds(workflow, stageId)
        .sort()
        .map((id) => [id, workflow.stages[id]?.revision ?? 0]),
    ),
    ancestorEdits: Object.fromEntries(
      ancestorIds(workflow, stageId)
        .sort()
        .map((id) => [id, workflow.stages[id]?.editRevision ?? 0]),
    ),
    editRevision: workflow.stages[stageId]?.editRevision ?? 0,
    membership: fusion
      ? dataset
        ? prepareDataset(state, dataset, fusion.mapping).plans.map(
            (plan) => plan.sourceKey,
          )
        : []
      : currentMembership(state, stageId),
    options: fusion ? fusionOptions(fusion.datasetId, fusion.mapping) : '',
  }
}

/** Names the first consumed input that changed since `group` was submitted, or null. */
export function signatureMismatch(
  state: WorkbenchState,
  group: RunGroup,
): string | null {
  const stage = state.workflow.stages[group.stageId]
  if (!stage) return 'its stage no longer exists'
  const now = captureSignature(state, group.stageId, group.fusion)
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
  // Saves from before edit revisions were recorded have none to compare.
  if (Object.keys(before.ancestorEdits).length > 0) {
    for (const id of keys) {
      if (now.ancestorEdits[id] !== before.ancestorEdits[id]) {
        const name = state.workflow.stages[id]?.name ?? id
        return `the inputs owned by "${name}" changed`
      }
    }
  }
  if (now.editRevision !== before.editRevision) {
    return `the inputs owned by "${stage.name}" changed`
  }
  if (
    now.membership.length !== before.membership.length ||
    now.membership.some((id, index) => before.membership[index] !== id)
  ) {
    return group.kind === 'fusion'
      ? 'the records that validate changed'
      : group.stageId === STAGE_IDS.scenarioModeling
        ? 'the scenarios in the comparison set changed'
        : 'the set of buildings changed'
  }
  // Retries reuse the group's own dataset and mapping, so this guards only
  // against a group whose saved options no longer match its input.
  if (now.options !== before.options) {
    return 'the dataset or its mapping changed'
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
  if (!isItemGroup(group)) return 'Retry the whole run'
  const outstanding = outstandingItems(group).length
  const noun = itemNoun(group, 1)
  return outstanding === 0
    ? 'Retry publication of held results'
    : `Retry ${outstanding} failed ${noun}${outstanding === 1 ? '' : 's'}`
}

/** The failed latest attempt of a stage's open run, which a retry would continue; null when none. */
export function openFailedAttempt(
  state: WorkbenchState,
  stageId: string,
): Task | null {
  for (const id of [...state.runGroupIds].reverse()) {
    const group = state.runGroups[id]
    if (
      !group ||
      group.stageId !== stageId ||
      group.kind !== 'stage' ||
      group.status !== 'open'
    )
      continue
    const latest = latestAttempt(state, group)
    return latest?.status === 'failed' ? latest : null
  }
  return null
}

/** Results held by a stage's open runs of one kind, which a fresh run would discard. */
export function heldCount(
  state: WorkbenchState,
  stageId: string,
  kind: RunGroup['kind'] = 'stage',
): number {
  let held = 0
  for (const group of Object.values(state.runGroups)) {
    if (
      group.stageId === stageId &&
      group.kind === kind &&
      group.status === 'open'
    ) {
      held += Object.keys(group.held).length
    }
  }
  return held
}

/** Accessible-name suffix warning that a fresh run discards held results. */
export function discardNote(
  state: WorkbenchState,
  stageId: string,
  kind: RunGroup['kind'] = 'stage',
): string {
  const held = heldCount(state, stageId, kind)
  return held > 0
    ? `, discarding ${held} held result${held === 1 ? '' : 's'}`
    : ''
}

/** What a job's items are called: fusion records or building items. */
export function itemNoun(
  group: Pick<RunGroup, 'kind' | 'stageId'> | null,
  count = 2,
): string {
  const noun =
    group?.kind === 'fusion'
      ? 'record'
      : group?.stageId === STAGE_IDS.scenarioModeling
        ? 'scenario'
        : 'item'
  return count === 1 ? noun : `${noun}s`
}
