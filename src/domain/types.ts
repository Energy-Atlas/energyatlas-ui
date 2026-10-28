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
  /**
   * The archetype parts Archetype modeling published for the building, by
   * the rule that set each one (decision 0032). A manual override in
   * `overrides` wins over these; see `effectiveParts`.
   */
  parts: BuildingParts
}

/** RC's four archetype parts, assigned separately (decision 0032). */
export type PartKind =
  'construction' | 'systems' | 'spaceLoads' | 'externalLoads'

export const PART_KINDS = [
  'construction',
  'systems',
  'spaceLoads',
  'externalLoads',
] as const satisfies readonly PartKind[]

/** A part a rule gave a building, with the rule's name when it ran. */
export type AssignedPart = { partId: string; ruleId: string; ruleName: string }

export type BuildingParts = Record<PartKind, AssignedPart | null>

/** Where a definition came from: the synthetic library, or an operation in this project. */
export type DefinitionSource =
  | { kind: 'library'; libraryId: string }
  | { kind: 'project'; operationId: string; libraryId?: string }

/**
 * A named bundle of the four parts for one use and construction-year range.
 * Default assignment rules are generated from archetypes (decision 0032).
 */
export type Archetype = {
  id: string
  name: string
  use: BuildingUse
  /** Construction years the archetype covers; null leaves that end open. */
  yearFrom: number | null
  yearTo: number | null
  /** The part of each kind the archetype bundles; null leaves it unset. */
  parts: Record<PartKind, string | null>
  source: DefinitionSource
}

/** The envelope: heat loss through walls, roof, windows, and air leakage. */
export type ConstructionPart = {
  id: string
  name: string
  kind: 'construction'
  /** U-values in W/m²K. */
  wallU: number
  roofU: number
  windowU: number
  /** Share of the facade that is glazed, 0 to 0.9. */
  windowRatio: number
  /** Air changes per hour from infiltration. */
  infiltrationAch: number
  source: DefinitionSource
}

export type FuelKind = 'gas' | 'electric' | 'district'

/** Heating, cooling, and hot water plant. */
export type SystemsPart = {
  id: string
  name: string
  kind: 'systems'
  fuel: FuelKind
  /** Seasonal heating efficiency, or a heat pump's COP above 1. */
  heatingEfficiency: number
  coolingCop: number
  /** Hot water need in kWh/m² a year, served by the heating plant. */
  hotWaterKwhPerM2: number
  source: DefinitionSource
}

/** Loads inside the building: lighting, equipment, and people, by schedule. */
export type SpaceLoadsPart = {
  id: string
  name: string
  kind: 'spaceLoads'
  lightingWPerM2: number
  equipmentWPerM2: number
  /** Floor area per occupant in m². */
  m2PerPerson: number
  /** The occupancy schedule the loads follow; null is a flat half load. */
  scheduleId: string | null
  source: DefinitionSource
}

/** Loads outside the conditioned zones, such as exterior lighting and process loads. */
export type ExternalLoadsPart = {
  id: string
  name: string
  kind: 'externalLoads'
  /** kWh per m² of floor area a year. */
  exteriorLightingKwhPerM2: number
  processKwhPerM2: number
  source: DefinitionSource
}

export type ArchetypePart =
  ConstructionPart | SystemsPart | SpaceLoadsPart | ExternalLoadsPart

/** How a rule combines its conditions, as in RC. */
export type RuleLogic = 'all' | 'any' | 'none'

/** RC's condition operators (GISSelection.cs); does not contain is `notContains`. */
export type ConditionOperator =
  'larger' | 'smaller' | 'equals' | 'contains' | 'notContains'

/** Building attributes a condition can test. */
export type ConditionField =
  | 'use'
  | 'yearBuilt'
  | 'floors'
  | 'floorAreaM2'
  | 'heightM'
  | 'footprintAreaM2'
  | 'name'

/** One condition; a blank one (no field) is dropped when rules are evaluated. */
export type RuleCondition = {
  field: ConditionField | null
  operator: ConditionOperator
  value: string
}

/**
 * An archetype assignment rule (decision 0032): conditions on building
 * attributes and the parts it sets. Rules are tried in list order, top first;
 * each part takes the first enabled matching rule that sets it.
 */
export type AssignmentRule = {
  id: string
  name: string
  enabled: boolean
  logic: RuleLogic
  conditions: RuleCondition[]
  /** The part of each kind the rule sets; null leaves that part to later rules. */
  parts: Record<PartKind, string | null>
  /** Generated from an archetype or as the fallback, or written in the project. */
  origin: 'default' | 'project'
}

/** One kind of day in a schedule, such as Weekday or Sunday: 24 hourly fractions. */
export type DayProfile = {
  /** Stable within its schedule; the week refers to it. */
  id: string
  name: string
  hours: number[]
}

/** The days of the week, Monday first, as a schedule's week lists them. */
export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/**
 * A daily and weekly schedule: one or more day profiles of 24 hourly
 * fractions, and which profile each day of the week uses.
 */
export type Schedule = {
  id: string
  name: string
  days: DayProfile[]
  /** The id of the day profile each day uses, Monday first (7 entries). */
  week: string[]
  source: DefinitionSource
}

/**
 * A measure's category: a scenario rule assigns at most one measure of each
 * (decision 0032, stage 3). The demo keeps its four kinds rather than RC's
 * seven categories; see docs/scenario-rules.md.
 */
export type MeasureKind = 'envelope' | 'heating' | 'lighting' | 'pv'

export const MEASURE_KINDS = [
  'envelope',
  'heating',
  'lighting',
  'pv',
] as const satisfies readonly MeasureKind[]

/**
 * A retrofit measure. Which buildings take it is decided by scenario rules,
 * not by the measure (decision 0032, stage 3).
 */
export type Measure = {
  id: string
  name: string
  kind: MeasureKind
  savingsPercent: number
  source: DefinitionSource
}

/**
 * A scenario rule (decision 0032, stage 3), RC's measure rule shape:
 * conditions on building attributes and at most one measure per category.
 * A scenario's rules are tried top first; each category takes the first
 * enabled matching rule that sets it.
 */
export type ScenarioRule = {
  id: string
  /** The scenario whose `ruleIds` list the rule. */
  scenarioId: string
  name: string
  enabled: boolean
  logic: RuleLogic
  conditions: RuleCondition[]
  /** The measure of each category the rule assigns; null leaves it to later rules. */
  measures: Record<MeasureKind, string | null>
}

export type Scenario = {
  id: string
  name: string
  /** The scenario's rules in `scenarioRules`, top first. */
  ruleIds: string[]
  /**
   * The share of affected buildings that adopt their alternative version,
   * applied when results are aggregated, not in the rules (RC's penetration).
   */
  adoptionPercent: number
  /** The fixed seed adoption sampling hashes with each building id. */
  adoptionSeed: number
  /** Whether Scenario modeling includes it in the requested comparison set. */
  included: boolean
}

/** A measure a rule gave a building, with the rule's name when it ran. */
export type AssignedMeasure = {
  measureId: string
  ruleId: string
  ruleName: string
}

export type BuildingMeasures = Record<MeasureKind, AssignedMeasure | null>

/**
 * What Scenario modeling publishes for a scenario: each affected building's
 * alternative version over the baseline it modeled against. Adoption is
 * sampled from these when results are aggregated.
 */
export type ScenarioVersions = {
  runId: string
  /** The baseline run the versions were modeled against. */
  baselineRunId: string
  /** Every modeled building's baseline demand, kWh a year. */
  baseKwh: Record<string, number>
  /** Each affected building's demand with its measures, kWh a year. */
  alternativeKwh: Record<string, number>
  /** The measures each affected building takes, by the rule that set each. */
  measures: Record<string, BuildingMeasures>
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
  /**
   * A data fusion or calibration fit shown under a stage. It does not make the
   * stage run, so the stage and its dependents keep their states meanwhile.
   */
  sideRun: boolean
}

/** What a run consumed when it was submitted; compared before start, retry, and publication. */
export type InputSignature = {
  /** Revisions of every stage upstream of the run's stage, transitively. */
  ancestors: Record<string, number>
  /**
   * Edit revisions of the same upstream stages: inputs they own, such as
   * scenario or archetype definitions, change before those stages run again.
   */
  ancestorEdits: Record<string, number>
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

/** One building's held part assignment by the rules, published with the whole group. */
export type HeldAssignmentOutput = {
  kind: 'assignment'
  parts: BuildingParts
}

/** One scenario's held alternative versions, published with the whole comparison set. */
export type HeldScenarioOutput = {
  kind: 'scenarioVersions'
  versions: ScenarioVersions
}

export type HeldOutput =
  | HeldPreprocessingOutput
  | HeldFusionOutput
  | HeldAssignmentOutput
  | HeldScenarioOutput

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

/** A source attribute suggested for a target, waiting for review. */
export type MappingSuggestion = {
  source: string
  score: number
  reason: string
}

/** One entry of a rule set in RC's shape (`{target, source, tier, transform}`). */
export type RuleSetMapping = {
  target: string
  source: string
  tier: 'compulsory' | 'computed' | 'optional' | 'custom'
  /** Always null: transforms are not supported, as in RC. */
  transform: string | null
}

/** A named mapping saved with the project (decision 0032, stage 4). */
export type SchemaRuleSet = {
  id: string
  name: string
  version: 1
  mappings: RuleSetMapping[]
  /** Unrecognised enumerated values mapped to allowed ones, by target. */
  valueMaps: Record<string, Record<string, string>>
  savedAt: string
  operationId: string
}

/** What a coded warning of a Schema matching run reports, as RC reports them. */
export type MappingWarning = {
  code:
    | 'enum_values_unrecognised'
    | 'values_invalid'
    | 'values_missing'
    | 'unit_not_converted'
  target: string
  count: number
  examples: string[]
  message: string
}

/** The mapping the last successful Schema matching run applied. */
export type PublishedMapping = {
  runId: string
  operationId: string
  mapping: Record<string, string>
  valueMaps: Record<string, Record<string, string>>
  customTargets: string[]
  /** Values copied per target. */
  applied: Record<string, number>
  warnings: MappingWarning[]
}

/**
 * Schema matching (decision 0032, stage 4): which source attribute of the
 * captured footprints each target field takes, suggestions waiting for
 * review, value maps for enumerated targets, named rule sets, and what the
 * last run applied. Mapped values are read from the source attributes when
 * needed, so the original attributes are kept unchanged.
 */
export type SchemaMatchingState = {
  /** Target id to source attribute name; unmapped targets are absent. */
  mapping: Record<string, string>
  suggestions: Record<string, MappingSuggestion>
  /** Custom target names, in order; their ids are `custom:<name>`. */
  customTargets: string[]
  valueMaps: Record<string, Record<string, string>>
  ruleSets: Record<string, SchemaRuleSet>
  ruleSetIds: string[]
  /** The rule set the mapping was last loaded from, until it is edited. */
  loadedFrom: string | null
  published: PublishedMapping | null
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

export type MeterUnit = 'kWh' | 'MWh'

/** What a calibration fit uses: a synthetic meter series and the unit chosen for it. */
export type CalibrationInput = { meterId: string; unit: MeterUnit }

/** Goodness of fit of modeled against metered months, in percent. */
export type FitMetrics = { cvrmsePercent: number; nmbePercent: number }

/** A published calibrated baseline variant; the working baseline changes only on Adopt. */
export type CalibratedVariant = {
  id: string
  label: string
  meterId: string
  unit: MeterUnit
  runId: string
  operationId: string
  createdAt: string
  factor: number
  before: FitMetrics
  after: FitMetrics
  meteredKwh: number[]
  modeledKwh: number[]
  calibratedKwh: number[]
  /** Run ID of the modeled baseline the fit used; it identifies that baseline. */
  baselineRunId: string
  /** Why the chosen unit contradicts the export, when it does; such a fit cannot be adopted. */
  unitMismatch: string | null
  result: ResultSet
}

export type CalibrationState = {
  variants: Record<string, CalibratedVariant>
  variantIds: string[]
  adoptedVariantId: string | null
  /** The modeled baseline kept while a calibrated variant is the working baseline. */
  modeled: { result: ResultSet } | null
}

export type RunGroupStatus =
  'open' | 'published' | 'cancelled' | 'invalidated' | 'superseded'

/** Every attempt at one stage run with one input context. */
export type RunGroup = {
  id: string
  /** A stage run, a data fusion shown under Schema matching, or a calibration fit shown under Baseline model setup. */
  kind: 'stage' | 'fusion' | 'calibration'
  stageId: string
  signature: InputSignature
  /** The dataset and mapping a fusion run applies; null for other runs. */
  fusion: FusionInput | null
  /** The meter series and unit a calibration fit uses; null for other runs. */
  calibration: CalibrationInput | null
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

/**
 * What the shared selection can hold. Buildings and grid elements are map
 * objects; definitions are shown and edited in the Properties panel; library
 * entries are shown there read-only (decision 0028).
 */
export type SelectableEntity =
  | 'building'
  | 'gridElement'
  | 'archetype'
  | 'schedule'
  | 'measure'
  | 'scenario'
  | 'asset'
  | 'stage'
  | 'libraryArchetype'
  | 'librarySchedule'
  | 'libraryMeasure'
  | 'archetypePart'
  | 'assignmentRule'
  | 'scenarioRule'

export const SELECTABLE_ENTITIES = [
  'building',
  'gridElement',
  'archetype',
  'schedule',
  'measure',
  'scenario',
  'asset',
  'stage',
  'libraryArchetype',
  'librarySchedule',
  'libraryMeasure',
  'archetypePart',
  'assignmentRule',
  'scenarioRule',
] as const satisfies readonly SelectableEntity[]

export type Selection = {
  entityType: SelectableEntity | null
  ids: string[]
}

/** Floors, or a manual archetype part that wins over the rules (decision 0032). */
export type EditableBuildingField = 'floors' | PartKind

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
  /** Archetype parts of the four kinds (decision 0032). */
  parts: Record<string, ArchetypePart>
  /** Archetype assignment rules by id; `ruleIds` orders them, top first. */
  rules: Record<string, AssignmentRule>
  ruleIds: string[]
  schedules: Record<string, Schedule>
  measures: Record<string, Measure>
  scenarios: Record<string, Scenario>
  /** Scenario rules by id (decision 0032, stage 3); each scenario orders its own. */
  scenarioRules: Record<string, ScenarioRule>
  results: {
    baseline: ResultSet | null
    /** Each modeled scenario aggregated at its adoption, read by every result view. */
    scenarios: Record<string, ResultSet>
    /** The alternative versions each modeled scenario's aggregate is sampled from. */
    scenarioVersions: Record<string, ScenarioVersions>
  }
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
  /** The Schema matching mapping and what its last run applied (decision 0032, stage 4). */
  schemaMatching: SchemaMatchingState
  calibration: CalibrationState
  issues: Issue[]
  selection: Selection
  pendingEdits: Record<string, PendingEdit>
  /** Monotonic counter for ids and revisions; never rewound by undo. */
  nextId: number
}
