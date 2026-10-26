import type {
  StageEdge,
  StageRecord,
  StageState,
  Task,
  WorkflowState,
} from './types.ts'

// Default stages from decision 0005. Stage state is derived, never stored, so
// staleness and blocking cannot drift from the facts that cause them.

export const STAGE_IDS = {
  location: 'stage:location-setup',
  enrichment: 'stage:data-enrichment',
  schema: 'stage:schema-matching',
  preprocessing: 'stage:geospatial-preprocessing',
  shading: 'stage:shading-pv',
  archetypes: 'stage:archetype-modeling',
  baseline: 'stage:baseline-model',
  scenarioDefinitions: 'stage:scenario-definitions',
  scenarioModeling: 'stage:scenario-modeling',
  gridDefinitions: 'stage:grid-definitions',
  gridModeling: 'stage:grid-modeling',
  dashboard: 'stage:dashboard',
} as const

type StageDefinition = Pick<
  StageRecord,
  'id' | 'name' | 'description' | 'skippable'
>

export const DEFAULT_STAGES: readonly StageDefinition[] = [
  {
    id: STAGE_IDS.location,
    name: 'Location setup / footprint capturing',
    description: 'Set the project location and capture building footprints.',
    skippable: false,
  },
  {
    id: STAGE_IDS.enrichment,
    name: 'Geospatial data enriching',
    description:
      'Attach use, construction year, and floor counts to footprints.',
    skippable: false,
  },
  {
    id: STAGE_IDS.schema,
    name: 'Schema matching',
    description: 'Map dataset attributes to the model schema.',
    skippable: false,
  },
  {
    id: STAGE_IDS.preprocessing,
    name: 'Geospatial preprocessing',
    description: 'Derive heights, floor areas, and thermal zones.',
    skippable: false,
  },
  {
    id: STAGE_IDS.shading,
    name: 'Shading calculation / PV yield estimation',
    description: 'Estimate roof shading and rooftop PV yield.',
    skippable: true,
  },
  {
    id: STAGE_IDS.archetypes,
    name: 'Archetype modeling',
    description: 'Assign building archetypes by use and construction era.',
    skippable: false,
  },
  {
    id: STAGE_IDS.baseline,
    name: 'Baseline model setup',
    description: 'Select weather and compute the baseline energy model.',
    skippable: false,
  },
  {
    id: STAGE_IDS.scenarioDefinitions,
    name: 'Scenario definitions',
    description: 'Confirm the measures and scenarios to model.',
    skippable: false,
  },
  {
    id: STAGE_IDS.scenarioModeling,
    name: 'Scenario modeling',
    description: 'Model each scenario against the baseline.',
    skippable: false,
  },
  {
    id: STAGE_IDS.gridDefinitions,
    name: 'Grid definitions',
    description:
      'Define lines, buses, transformers, utility PV, and load centers.',
    skippable: true,
  },
  {
    id: STAGE_IDS.gridModeling,
    name: 'Grid modeling',
    description: 'Estimate transformer loading from modeled demand.',
    skippable: true,
  },
  {
    id: STAGE_IDS.dashboard,
    name: 'Dashboard / visualization',
    description: 'Assemble comparison views and the summary report.',
    skippable: false,
  },
]

export function createDefaultWorkflow(): WorkflowState {
  const stages: Record<string, StageRecord> = {}
  const edges: StageEdge[] = []
  let previousId: string | null = null
  for (const definition of DEFAULT_STAGES) {
    stages[definition.id] = {
      ...definition,
      capability: 'workflow.stageRuns',
      custom: false,
      skipped: false,
      revision: 0,
      editRevision: 0,
      runCount: 0,
      lastRun: null,
      unavailableReason: null,
    }
    if (previousId) edges.push({ from: previousId, to: definition.id })
    previousId = definition.id
  }
  return {
    stageIds: DEFAULT_STAGES.map((definition) => definition.id),
    stages,
    edges,
    currentStageId: STAGE_IDS.location,
  }
}

export function upstreamIds(
  workflow: WorkflowState,
  stageId: string,
): string[] {
  return workflow.edges
    .filter((edge) => edge.to === stageId)
    .map((edge) => edge.from)
}

export function downstreamIds(
  workflow: WorkflowState,
  stageId: string,
): string[] {
  return workflow.edges
    .filter((edge) => edge.from === stageId)
    .map((edge) => edge.to)
}

/** Stable topological order following `stageIds`; null when edges form a cycle or name unknown stages. */
export function topologicalOrder(
  stageIds: readonly string[],
  edges: readonly StageEdge[],
): string[] | null {
  const indegree = new Map(stageIds.map((id) => [id, 0]))
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) return null
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const remaining = new Set(stageIds)
  const order: string[] = []
  while (remaining.size > 0) {
    const next = stageIds.find(
      (id) => remaining.has(id) && indegree.get(id) === 0,
    )
    if (next === undefined) return null
    remaining.delete(next)
    order.push(next)
    for (const edge of edges) {
      if (edge.from === next) {
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) - 1)
      }
    }
  }
  return order
}

export function hasActiveTask(
  tasks: Record<string, Task>,
  stageId: string,
): boolean {
  return Object.values(tasks).some(
    (task) =>
      task.stageId === stageId &&
      !task.sideRun &&
      (task.status === 'queued' || task.status === 'running'),
  )
}

function isSatisfied(state: StageState | undefined): boolean {
  return state === 'executed' || state === 'skipped'
}

function deriveStage(
  workflow: WorkflowState,
  stage: StageRecord,
  upstream: string[],
  upstreamStates: StageState[],
  tasks: Record<string, Task>,
): StageState {
  if (stage.unavailableReason) return 'unavailable'
  if (hasActiveTask(tasks, stage.id)) return 'running'
  if (stage.skipped) return 'skipped'
  const run = stage.lastRun
  if (run?.outcome === 'failed') return 'failed'
  if (run?.outcome === 'succeeded') {
    const inputsChanged =
      run.inputEditRevision !== stage.editRevision ||
      upstream.some(
        (id) => run.inputRevisions[id] !== workflow.stages[id]?.revision,
      )
    const upstreamUnsound = upstreamStates.some((state) => !isSatisfied(state))
    return inputsChanged || upstreamUnsound ? 'stale' : 'executed'
  }
  if (
    upstreamStates.some(
      (state) =>
        state === 'failed' || state === 'blocked' || state === 'unavailable',
    )
  ) {
    return 'blocked'
  }
  return upstreamStates.every(isSatisfied) ? 'ready' : 'future'
}

export function deriveStageStates(
  workflow: WorkflowState,
  tasks: Record<string, Task>,
): Record<string, StageState> {
  const order =
    topologicalOrder(workflow.stageIds, workflow.edges) ?? workflow.stageIds
  const states: Record<string, StageState> = {}
  for (const id of order) {
    const stage = workflow.stages[id]
    if (!stage) continue
    const upstream = upstreamIds(workflow, id)
    const upstreamStates = upstream.map((upId) => states[upId] ?? 'future')
    states[id] = deriveStage(workflow, stage, upstream, upstreamStates, tasks)
  }
  return states
}

/** Why a stage cannot run now, or null when it can. Shared by commands and UI. */
export function stageRunBlocker(
  workflow: WorkflowState,
  tasks: Record<string, Task>,
  stageId: string,
): string | null {
  const stage = workflow.stages[stageId]
  if (!stage) return `Unknown stage "${stageId}".`
  if (stage.unavailableReason) return stage.unavailableReason
  if (hasActiveTask(tasks, stageId))
    return `"${stage.name}" is already running.`
  if (stage.skipped) {
    return `"${stage.name}" is skipped. Restore it before running.`
  }
  const states = deriveStageStates(workflow, tasks)
  const pending = upstreamIds(workflow, stageId).filter(
    (id) => !isSatisfied(states[id]),
  )
  if (pending.length > 0) {
    const names = pending
      .map((id) => `"${workflow.stages[id]?.name ?? id}"`)
      .join(', ')
    return `Complete or skip earlier stages first: ${names}.`
  }
  return null
}
