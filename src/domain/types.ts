import type { CapabilityId } from './capabilities.ts'

export type CommandSource = 'manual' | 'agent' | 'system'

export type Provenance =
  | { kind: 'skeleton' }
  | { kind: 'stage'; stageId: string; runId: string; operationId: string }
  | { kind: 'operation'; source: CommandSource; operationId: string }

export type AssetKind =
  | 'group'
  | 'location'
  | 'gisDataset'
  | 'schemaRules'
  | 'buildings'
  | 'zones'
  | 'shadingResult'
  | 'pvYield'
  | 'archetypes'
  | 'weather'
  | 'energyModel'
  | 'energyResult'
  | 'measure'
  | 'scenario'
  | 'gridElements'
  | 'gridResult'
  | 'view'
  | 'report'

export type Asset = {
  id: string
  kind: AssetKind
  name: string
  parentId: string | null
  childIds: string[]
  provenance: Provenance
  /** Honest status of what this asset represents; see capabilities.ts. */
  capability: CapabilityId | null
  summary: string | null
  /** Entities this asset stands for, such as a measure or scenario. */
  entityIds: string[]
}

export type LngLat = [number, number]

export type BuildingUse =
  'residential' | 'office' | 'retail' | 'school' | 'mixed'

export type Building = {
  id: string
  name: string
  footprint: LngLat[]
  footprintAreaM2: number
  /** Where the footprint geometry came from, such as "OpenStreetMap way/123"; null for synthetic geometry. */
  sourceRef: string | null
  use: BuildingUse | null
  yearBuilt: number | null
  floors: number | null
  heightM: number | null
  floorAreaM2: number | null
  zoneCount: number | null
  shadingFactor: number | null
  pvYieldKwh: number | null
  archetypeId: string | null
}

/** Where a definition came from: the synthetic library, or an operation in this project. */
export type DefinitionSource =
  | { kind: 'library'; libraryId: string }
  | { kind: 'project'; operationId: string }

export type Archetype = {
  id: string
  name: string
  use: BuildingUse
  /** Construction years the archetype covers; null leaves that end open. */
  yearFrom: number | null
  yearTo: number | null
  euiKwhPerM2: number
  scheduleId: string | null
  source: DefinitionSource
}

/** A daily and weekly schedule: 24 hourly fractions for a weekday and a weekend day. */
export type Schedule = {
  id: string
  name: string
  weekday: number[]
  weekend: number[]
  source: DefinitionSource
}

export type MeasureKind = 'envelope' | 'heating' | 'lighting' | 'pv'

export type Measure = {
  id: string
  name: string
  kind: MeasureKind
  savingsPercent: number
  appliesTo: BuildingUse | 'all'
}

export type Scenario = {
  id: string
  name: string
  measureIds: string[]
  adoptionPercent: number
}

export type ResultSet = {
  id: string
  label: string
  runId: string
  totalKwh: number
  peakKw: number
  monthlyKwh: number[]
  byBuildingKwh: Record<string, number>
}

export type GridElementKind =
  'bus' | 'line' | 'transformer' | 'utilityPv' | 'load'

export type GridElement = {
  id: string
  kind: GridElementKind
  name: string
  coordinates: LngLat[]
  ratingKva: number | null
  buildingIds: string[]
}

export type GridResult = {
  runId: string
  transformerLoadingPercent: Record<string, number>
}

export type StageRun = {
  runId: string
  operationId: string
  outcome: 'succeeded' | 'failed'
  message: string | null
  /** Upstream stage revisions this run consumed. */
  inputRevisions: Record<string, number>
  /** This stage's own edit revision when the run consumed it. */
  inputEditRevision: number
  finishedAt: string
}

export type StageRecord = {
  id: string
  name: string
  description: string
  capability: CapabilityId
  skippable: boolean
  custom: boolean
  skipped: boolean
  /** Changes whenever this stage's outputs change: a run, an edit of data it owns, or a skip toggle. */
  revision: number
  /** Changes whenever inputs owned by this stage change, such as new measures. */
  editRevision: number
  runCount: number
  lastRun: StageRun | null
  unavailableReason: string | null
}

export type StageEdge = { from: string; to: string }

export type WorkflowState = {
  stageIds: string[]
  stages: Record<string, StageRecord>
  edges: StageEdge[]
  /** The stage the user is focused on; shown as a marker over its derived state. */
  currentStageId: string | null
}

export type StageState =
  | 'future'
  | 'ready'
  | 'running'
  | 'executed'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'unavailable'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  /** Finished without executing because its captured inputs changed first. */
  | 'invalidated'

/** One line of a job's log, as RC keeps for each job. */
export type TaskLogLine = { at: string; message: string }

/**
 * The items one attempt works through, in order. Outcomes are compact: items
 * before `processed` succeeded unless listed in `failures`.
 */
export type TaskItems = {
  ids: string[]
  processed: number
  succeeded: number
  failures: Record<string, string>
}

/** One immutable attempt of a run group; the UI calls it a job. */
export type Task = {
  id: string
  label: string
  stageId: string
  runId: string
  status: TaskStatus
  progress: number
  message: string | null
  source: CommandSource
  createdAt: string
  updatedAt: string
  log: TaskLogLine[]
  /** The run group (input context) this attempt belongs to; null for jobs saved before groups. */
  groupId: string | null
  /** 1 for a fresh run, then one more for each retry in the same group. */
  attempt: number
  /** The attempt this one retries. */
  parentTaskId: string | null
  /** The client's key for the submission, so a repeated delivery creates nothing new. */
  requestId: string | null
  /** Item-level work; null for whole-stage jobs. */
  items: TaskItems | null
}

/** What a run consumed when it was submitted; compared before start, retry, and publication. */
export type InputSignature = {
  /** Revisions of every stage upstream of the run's stage, transitively. */
  ancestors: Record<string, number>
  /** The stage's own edit revision. */
  editRevision: number
  /** Item membership, in order; empty for whole-stage runs. */
  membership: string[]
  /** Run options that change results, such as a fusion's dataset and mapping. */
  options: string
}

/** A held item output from geospatial preprocessing, published only with the whole group. */
export type HeldPreprocessingOutput = {
  heightM: number
  floorAreaM2: number
  zoneCount: number
}

/** Attributes a dataset supplies for one building; absent fields are not supplied. */
export type ImportedFields = {
  name?: string
  use?: BuildingUse
  yearBuilt?: number
  floors?: number
}

/** One record's held fusion result: update a matched building or add a new one. */
export type HeldFusionOutput = {
  kind: 'fusion'
  action: 'update' | 'add'
  /** The stable source ID the record carries, normalized. */
  sourceKey: string
  buildingId: string
  /** Values the record changes; manual overrides are already left out. */
  fields: ImportedFields
  /** Fields where a manual override wins over the imported value. */
  conflicts: { field: 'floors'; manual: number | null; imported: number }[]
  footprint: LngLat[] | null
}

/** One building's held archetype assignment, published with the whole group. */
export type HeldAssignmentOutput = {
  kind: 'assignment'
  archetypeId: string | null
}

export type HeldOutput =
  HeldPreprocessingOutput | HeldFusionOutput | HeldAssignmentOutput

/** Dataset field name to model field, or null to ignore the field. */
export type FieldMapping = Record<string, TargetField | null>

export type TargetField =
  'sourceId' | 'name' | 'use' | 'yearBuilt' | 'floors' | 'footprint'

/** What a fusion run applies: a synthetic dataset and the mapping chosen for it. */
export type FusionInput = { datasetId: string; mapping: FieldMapping }

/** A published source record; stage reruns reapply it under manual overrides. */
export type SourceRecord = {
  sourceKey: string
  datasetId: string
  buildingId: string
  fields: ImportedFields
  /** Geometry for a building the dataset added; null when it matched an existing one. */
  footprint: LngLat[] | null
  operationId: string
  source: CommandSource
}

/** A dataset whose fusion was published into the project. */
export type AppliedDataset = {
  datasetId: string
  label: string
  mapping: FieldMapping
  updated: number
  added: number
  conflicts: number
  appliedAt: string
  operationId: string
}

export type RunGroupStatus =
  'open' | 'published' | 'cancelled' | 'invalidated' | 'superseded'

/** Every attempt at one stage run with one input context. */
export type RunGroup = {
  id: string
  /** A stage run, or a data fusion run shown under Schema matching. */
  kind: 'stage' | 'fusion'
  stageId: string
  signature: InputSignature
  /** The dataset and mapping a fusion run applies; null for stage runs. */
  fusion: FusionInput | null
  attemptIds: string[]
  /** Successful item outputs, kept out of the project until the group publishes. */
  held: Record<string, HeldOutput>
  status: RunGroupStatus
  /** Why the group is closed, or why its last publication failed. */
  statusReason: string | null
  createdAt: string
}

export type IssueSeverity = 'info' | 'warning' | 'error'

export type Issue = {
  id: string
  severity: IssueSeverity
  message: string
  stageId: string | null
  createdAt: string
}

export type SelectableEntity = 'building' | 'gridElement'

export type Selection = {
  entityType: SelectableEntity | null
  ids: string[]
}

export type EditableBuildingField = 'floors' | 'archetypeId'

export type EditValue = number | string | null

export type PendingEdit = {
  entityId: string
  field: EditableBuildingField
  from: EditValue
  to: EditValue
}

/** An applied manual edit that survives reruns of the stage that generated the field. */
export type ManualOverride = {
  entityId: string
  field: EditableBuildingField
  value: EditValue
  operationId: string
  source: CommandSource
}

export type WorkbenchState = {
  project: {
    id: string
    name: string
    location: { name: string; center: LngLat } | null
  }
  assets: Record<string, Asset>
  rootAssetIds: string[]
  buildings: Record<string, Building>
  buildingIds: string[]
  archetypes: Record<string, Archetype>
  schedules: Record<string, Schedule>
  measures: Record<string, Measure>
  scenarios: Record<string, Scenario>
  results: { baseline: ResultSet | null; scenarios: Record<string, ResultSet> }
  gridElements: Record<string, GridElement>
  gridResult: GridResult | null
  overrides: Record<string, ManualOverride>
  workflow: WorkflowState
  tasks: Record<string, Task>
  taskIds: string[]
  runGroups: Record<string, RunGroup>
  runGroupIds: string[]
  /** Published source records by normalized source ID (decision D9). */
  sourceRecords: Record<string, SourceRecord>
  sourceRecordIds: string[]
  /** Datasets fused into the project, by dataset ID. */
  datasets: Record<string, AppliedDataset>
  issues: Issue[]
  selection: Selection
  pendingEdits: Record<string, PendingEdit>
  /** Monotonic counter for ids and revisions; never rewound by undo. */
  nextId: number
}
