import { z } from 'zod'
import { GROUP, upsertAsset } from './assets.ts'
import {
  assignBuilding,
  defaultRuleDrafts,
  generatesDefaultRules,
  missingDefaults,
  prepareAssignmentRules,
} from './archetypes/assignment.ts'
import {
  ARCHETYPE_LIBRARY,
  FALLBACK_ARCHETYPE_ID,
  PART_LIBRARY,
  SCHEDULE_LIBRARY,
} from './archetypes/library.ts'
import {
  PART_LABELS,
  effectivePartIds,
  overrideKey,
} from './archetypes/parts.ts'
import {
  CONDITION_FIELDS,
  CONDITION_FIELD_IDS,
  CONDITION_OPERATORS,
  conditionIssue,
} from './rules/conditions.ts'
import {
  adoptBlocker,
  calibratedResult,
  unitWarning,
  findMeter,
  fitBlocker,
  fitFactor,
  meteredKwh,
  modeledSource,
} from './calibration/calibration.ts'
import { findDataset } from './intake/datasets.ts'
import { recognise, suggestMatches } from './mapping/mapping.ts'
import {
  computedOverrides,
  schemaRunBlocker,
  sourceCollection,
} from './schema/matching.ts'
import {
  BUILT_IN_RULE_SET,
  customNameIssue,
  sameMappingConfig,
  copyValueMaps,
  createSchemaMatching,
  customTargetId,
  findSchemaTarget,
  schemaTargets,
} from './schema/registry.ts'
import {
  currentMappings,
  checkRuleSet,
  ruleSetFileSchema,
  type RuleSetFile,
} from './schema/ruleSets.ts'
import { MEASURE_LIBRARY } from './scenarios/library.ts'
import {
  publishScenarioResults,
  reaggregateScenario,
  scenarioItem,
  validateScenarioResults,
} from './scenarios/modeling.ts'
import {
  DEFAULT_ADOPTION_SEED,
  kindNoun,
  emptyMeasures,
  scenarioMeasureIds,
} from './scenarios/rules.ts'
import {
  fusionSubmitBlocker,
  prepareDataset,
  publishFusion,
  validateFusion,
} from './intake/fusion.ts'
import {
  captureSignature,
  groupOf,
  isItemGroup,
  isItemStage,
  outstandingItems,
  retryBlocker,
  retryScope,
  signatureMismatch,
} from './jobs/runGroups.ts'
import {
  preprocessBuilding,
  publishAssignment,
  publishPreprocessing,
  validateAssignment,
  runSimulatedStage,
  validatePreprocessing,
  type StageRunResult,
} from './simulation.ts'
import type {
  Building,
  CommandSource,
  EditValue,
  Archetype,
  CalibrationInput,
  DefinitionSource,
  EditableBuildingField,
  HeldAssignmentOutput,
  HeldFusionOutput,
  HeldOutput,
  HeldScenarioOutput,
  Measure,
  MeasureKind,
  HeldPreprocessingOutput,
  PartKind,
  RunGroup,
  Scenario,
  ScenarioRule,
  StageRecord,
  Task,
  WorkbenchState,
} from './types.ts'
import {
  MEASURE_KINDS,
  PART_KINDS,
  SELECTABLE_ENTITIES,
  type SelectableEntity,
} from './types.ts'
import { selectableExists } from './selection.ts'
import {
  BUILDING_ZONING_CHOICES,
  BUILDING_ZONING_LABELS,
  MAX_PERIMETER_DEPTH_M,
  MIN_PERIMETER_DEPTH_M,
  ZONING_MODES,
  ZONING_MODE_LABELS,
  describeBuildingZoning,
  depthOverrides,
  describeZoning,
  plannedZoning,
  projectZoningChanges,
  resolveBuildingZoning,
  sameBuildingZoning,
} from './zoning/zoning.ts'
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
  task.status = 'failed'
  task.message = message
  task.updatedAt = context.now
  task.log.push({ at: context.now, message: `Failed: ${message}` })
  // Fusions and fits run beside their stage: they report on the job, not the stage.
  const kind = task.groupId ? state.runGroups[task.groupId]?.kind : 'stage'
  if (kind && kind !== 'stage') return
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

const SELECTION_NOUNS: Record<SelectableEntity, string> = {
  building: 'building(s)',
  gridElement: 'grid element(s)',
  archetype: 'archetype(s)',
  schedule: 'schedule(s)',
  measure: 'measure(s)',
  scenario: 'scenario(s)',
  asset: 'asset(s)',
  stage: 'stage(s)',
  libraryArchetype: 'library archetype(s)',
  librarySchedule: 'library schedule(s)',
  libraryMeasure: 'library measure(s)',
  archetypePart: 'archetype part(s)',
  assignmentRule: 'assignment rule(s)',
  scenarioRule: 'scenario rule(s)',
  floor: 'floor(s)',
  zone: 'zone(s)',
}

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
  if (stageId === STAGE_IDS.archetypes) return definitionsBlocker(state)
  if (stageId === STAGE_IDS.schema) return schemaRunBlocker(state)
  if (stageId === STAGE_IDS.scenarioModeling) {
    return Object.values(state.scenarios).some((scenario) => scenario.included)
      ? null
      : 'Include at least one scenario in the comparison set. Open Scenarios to include one.'
  }
  if (stageId !== STAGE_IDS.preprocessing) return null
  const missing = state.buildingIds.filter(
    (id) => (state.buildings[id]?.floors ?? null) === null,
  ).length
  return missing > 0
    ? `Floor counts are missing for ${missing} building${missing === 1 ? '' : 's'}. Run "Geospatial data enriching" first.`
    : null
}

/** Why archetype definitions cannot be assigned, or null; definitions are validated before assignment. */
export function definitionsBlocker(state: WorkbenchState): string | null {
  if (state.buildingIds.some((id) => state.buildings[id]?.use === null)) {
    return 'Building use is missing. Run "Geospatial data enriching".'
  }
  for (const part of Object.values(state.parts)) {
    if (
      part.kind === 'spaceLoads' &&
      part.scheduleId !== null &&
      !state.schedules[part.scheduleId]
    ) {
      return `"${part.name}" uses a schedule that no longer exists. Choose another schedule first.`
    }
  }
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  if (state.ruleIds.length === 0 && stage?.lastRun) {
    return 'There are no assignment rules. Generate the default rules or add a rule first.'
  }
  if (
    state.ruleIds.length > 0 &&
    state.ruleIds.every((id) => state.rules[id]?.enabled === false)
  ) {
    return 'Every assignment rule is off. Switch one on first.'
  }
  for (const archetype of Object.values(state.archetypes)) {
    if (
      archetype.yearFrom !== null &&
      archetype.yearTo !== null &&
      archetype.yearFrom > archetype.yearTo
    ) {
      return `"${archetype.name}" has an empty construction-year range.`
    }
  }
  return null
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

/** A fusion group's record plans by source key, prepared now; null for other groups. */
function fusionPlans(
  state: WorkbenchState,
  group: RunGroup,
): Map<string, HeldFusionOutput> | null {
  if (group.kind !== 'fusion' || !group.fusion) return null
  const dataset = findDataset(group.fusion.datasetId)
  if (!dataset) return new Map()
  const prepared = prepareDataset(state, dataset, group.fusion.mapping)
  return new Map(prepared.plans.map((plan) => [plan.sourceKey, plan]))
}

/** Held outputs of one kind, for the publisher that understands them. */
function heldOf<Output extends HeldOutput>(
  group: RunGroup,
  matches: (output: HeldOutput) => boolean,
): Record<string, Output> {
  return Object.fromEntries(
    Object.entries(group.held).filter(([, output]) => matches(output)),
  ) as Record<string, Output>
}

const isFusionOutput = (output: HeldOutput) =>
  'kind' in output && output.kind === 'fusion'

const isAssignmentOutput = (output: HeldOutput) =>
  'kind' in output && output.kind === 'assignment'

const isScenarioOutput = (output: HeldOutput) =>
  'kind' in output && output.kind === 'scenarioVersions'

/** One building's held item output for an item stage, or why it has none. */
function stageItem(
  state: WorkbenchState,
  stageId: string,
  buildingId: string,
): { output: HeldOutput | null; missing: string | null } {
  if (stageId === STAGE_IDS.scenarioModeling) {
    return scenarioItem(state, buildingId)
  }
  const building = state.buildings[buildingId]
  if (!building) {
    return { output: null, missing: 'The building no longer exists.' }
  }
  if (stageId === STAGE_IDS.archetypes) {
    const { prepared } = prepareAssignmentRules(state)
    return {
      output: {
        kind: 'assignment',
        parts: assignBuilding(prepared, building).parts,
      },
      missing: null,
    }
  }
  const output = preprocessBuilding(
    building,
    computedOverrides(state, building),
    resolveBuildingZoning(state.zoning, building.id),
    state.zoning.drawn[building.id] ?? null,
  )
  return { output, missing: output ? null : 'The floor count is missing.' }
}

/** Provenance after a save: new or edited in this project, remembering a library origin. */
function editedSource(
  previous: DefinitionSource | null,
  operationId: string,
): DefinitionSource {
  const libraryId =
    previous?.kind === 'library'
      ? previous.libraryId
      : previous?.kind === 'project'
        ? previous.libraryId
        : undefined
  return libraryId
    ? { kind: 'project', operationId, libraryId }
    : { kind: 'project', operationId }
}

/** Why source-attribute commands cannot run before footprints are captured. */
const NO_SOURCES =
  'There are no source attributes yet. Run "Location setup / footprint capturing" first.'

/** The id that loads the built-in rule set again. */
export const BUILT_IN_RULE_SET_ID = 'ruleSet:builtin'

/** Bumps Schema matching's inputs: its mapping is outdated, and so is everything after it. */
function touchSchemaInputs(state: WorkbenchState) {
  const stage = state.workflow.stages[STAGE_IDS.schema]
  if (stage) stage.editRevision = nextRevision(state)
  state.schemaMatching.loadedFrom = null
}

/** Bumps the inputs Archetype modeling owns, so assignments become outdated. */
function touchArchetypeInputs(state: WorkbenchState) {
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  if (stage) stage.editRevision = nextRevision(state)
}

/**
 * Copies library parts the project lacks, with the schedules their space
 * loads use. A copied part or schedule whose name is taken gets a
 * "(library)" suffix, so names stay unique and both stay editable.
 */
function addLibraryParts(state: WorkbenchState, ids: (string | null)[]) {
  for (const id of ids) {
    if (id === null || state.parts[id]) continue
    const entry = PART_LIBRARY.find((item) => item.id === id)
    if (!entry) continue
    const part = structuredClone(entry)
    if (!uniqueName(Object.values(state.parts), part.name)) {
      part.name = `${part.name} (library)`
    }
    state.parts[part.id] = part
    if (part.kind !== 'spaceLoads') continue
    const schedule = SCHEDULE_LIBRARY.find(
      (item) => item.id === part.scheduleId,
    )
    if (schedule && !state.schedules[schedule.id]) {
      const copy = structuredClone(schedule)
      if (!uniqueName(Object.values(state.schedules), copy.name)) {
        copy.name = `${copy.name} (library)`
      }
      state.schedules[copy.id] = copy
    }
  }
}

/** Copies a library archetype into the project with the parts and schedules it bundles. */
function addLibraryArchetype(state: WorkbenchState, entry: Archetype) {
  state.archetypes[entry.id] = structuredClone(entry)
  addLibraryParts(
    state,
    PART_KINDS.map((kind) => entry.parts[kind]),
  )
}

/**
 * Replaces the generated rules with fresh ones from the project's
 * archetypes, below the project's own rules, with the fallback last. The
 * fallback's library parts come into the project when it lacks them.
 */
function generateDefaultRules(state: WorkbenchState): {
  added: number
  kept: string[]
} {
  for (const id of state.ruleIds) {
    if (state.rules[id]?.origin === 'default') delete state.rules[id]
  }
  state.ruleIds = state.ruleIds.filter((id) => id in state.rules)
  const fallback = ARCHETYPE_LIBRARY.find(
    (entry) => entry.id === FALLBACK_ARCHETYPE_ID,
  )
  if (fallback && !state.archetypes[FALLBACK_ARCHETYPE_ID]) {
    addLibraryParts(
      state,
      PART_KINDS.map((kind) => fallback.parts[kind]),
    )
  }
  // A generated rule edited into the project's own keeps its name; the
  // default of the same name is left out, so names stay unique.
  const kept: string[] = []
  let added = 0
  for (const draft of defaultRuleDrafts(state.archetypes)) {
    if (!uniqueName(Object.values(state.rules), draft.rule.name)) {
      kept.push(draft.rule.name)
      continue
    }
    const id = allocateId(state, 'rule')
    state.rules[id] = { id, ...draft.rule }
    state.ruleIds.push(id)
    added += 1
  }
  return { added, kept }
}

/** Whether rules, overrides, or published assignments use a part, so editing it changes results. */
function partInUse(state: WorkbenchState, partId: string): boolean {
  return (
    Object.values(state.rules).some((rule) =>
      PART_KINDS.some((kind) => rule.parts[kind] === partId),
    ) ||
    Object.values(state.overrides).some(
      (override) => override.field !== 'floors' && override.value === partId,
    ) ||
    Object.values(state.buildings).some((building) =>
      PART_KINDS.some((kind) => building.parts[kind]?.partId === partId),
    )
  )
}

/** Why a stage run cannot be submitted, including item-input checks; shared by commands and controls. */
export function stageSubmitBlocker(
  state: WorkbenchState,
  stageId: string,
): string | null {
  return (
    stageRunBlocker(state.workflow, state.tasks, stageId) ??
    itemInputBlocker(state, stageId)
  )
}

const hourlyProfileSchema = z
  .array(
    z
      .number({ error: 'Enter a number from 0 to 1 in every hour.' })
      .min(0, 'Hourly values cannot be below 0.')
      .max(1, 'Hourly values cannot be above 1.'),
  )
  .length(24, 'Give exactly 24 hourly values.')

const dayProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Name every day type.').max(40),
  hours: hourlyProfileSchema,
})

const weekSchema = z
  .array(z.string().min(1, 'Choose a day type for every day.'))
  .length(7, 'Choose a day type for each day from Monday to Sunday.')

const yearSchema = z
  .number({ error: 'Enter a whole year, or leave it empty.' })
  .int('Use a whole year.')
  .min(1600, 'Use a year from 1600.')
  .max(2030, 'Use a year up to 2030.')
  .nullable()

/** Runs a calibration fit and publishes its variant, leaving the working baseline as it is. */
function publishFit(
  state: WorkbenchState,
  input: CalibrationInput,
  task: Task,
  context: CommandContext,
): { ok: true; summary: string } | { ok: false; message: string } {
  const series = findMeter(input.meterId)
  const metered = series ? meteredKwh(series, input.unit) : null
  const source = modeledSource(state)
  if (!series || !metered || !source) {
    return {
      ok: false,
      message: 'The meter series or baseline is no longer available.',
    }
  }
  const fit = fitFactor(source.result.monthlyKwh, metered)
  const id = allocateId(state, 'variant')
  const number = state.calibration.variantIds.length + 1
  state.calibration.variants[id] = {
    id,
    label: `Calibrated baseline ${number} (${series.label})`,
    meterId: input.meterId,
    unit: input.unit,
    runId: task.runId,
    operationId: context.operationId,
    createdAt: context.now,
    factor: fit.factor,
    before: fit.before,
    after: fit.after,
    meteredKwh: fit.metered,
    modeledKwh: fit.modeled,
    calibratedKwh: fit.calibrated,
    baselineRunId: source.result.runId,
    unitMismatch: unitWarning(series, input.unit),
    result: calibratedResult(source.result, fit.factor, task.runId),
  }
  state.calibration.variantIds.push(id)
  upsertAsset(state, {
    id: `asset:${id}`,
    kind: 'energyModel',
    name: state.calibration.variants[id].label,
    parentId: GROUP.energyModel,
    provenance: {
      kind: 'operation',
      source: context.source,
      operationId: context.operationId,
    },
    capability: 'calibration.fit',
    summary: `Factor ${fit.factor}; CV(RMSE) ${fit.before.cvrmsePercent}% to ${fit.after.cvrmsePercent}%, NMBE ${fit.before.nmbePercent}% to ${fit.after.nmbePercent}% (synthetic)`,
  })
  return {
    ok: true,
    summary: `Fitted factor ${fit.factor}: CV(RMSE) ${fit.before.cvrmsePercent}% to ${fit.after.cvrmsePercent}%, NMBE ${fit.before.nmbePercent}% to ${fit.after.nmbePercent}%. The working baseline is unchanged until you adopt the variant.`,
  }
}

/** Notes on the baseline result asset what the working baseline now is. */
function upsertBaselineAsset(
  state: WorkbenchState,
  context: CommandContext,
  change: string,
) {
  const asset = state.assets['asset:result-baseline']
  const baseline = state.results.baseline
  if (!asset || !baseline) return
  asset.summary = `${Math.round(baseline.totalKwh / 1000).toLocaleString('en-US')} MWh/yr, peak ${baseline.peakKw.toLocaleString('en-US')} kW (synthetic); ${change}`
  asset.provenance = {
    kind: 'operation',
    source: context.source,
    operationId: context.operationId,
  }
}

/** Closes a stage's open runs of one kind when a fresh run replaces them. */
function supersedeOpenGroups(
  state: WorkbenchState,
  stageId: string,
  kind: RunGroup['kind'],
) {
  for (const group of Object.values(state.runGroups)) {
    if (
      group.stageId === stageId &&
      group.kind === kind &&
      group.status === 'open'
    ) {
      group.status = 'superseded'
      group.statusReason =
        kind === 'fusion'
          ? 'A newer data fusion replaced it.'
          : kind === 'calibration'
            ? 'A newer calibration fit replaced it.'
            : 'A fresh run of this stage replaced it.'
      group.held = {}
    }
  }
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
  const dataset =
    group?.kind === 'fusion' && group.fusion
      ? findDataset(group.fusion.datasetId)
      : null
  const meter =
    group?.kind === 'calibration' && group.calibration
      ? findMeter(group.calibration.meterId)
      : null
  if (group?.kind === 'stage') stage.runCount += 1
  const taskId = allocateId(state, 'task')
  const runId = allocateId(state, 'run')
  const attempt = (group?.attemptIds.length ?? 0) + 1
  const { context, items } = options
  const noun = dataset ? 'records' : 'items'
  const task: Task = {
    id: taskId,
    label: dataset
      ? `Data fusion: ${dataset.label}`
      : meter
        ? `Calibration fit: ${meter.label}`
        : stage.name,
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
            ? `Queued${items ? ` with ${items.length} ${noun}` : ''}.`
            : `Queued as attempt ${attempt}${items ? ` for ${items.length} ${noun}` : ''}.`,
      },
    ],
    groupId,
    attempt,
    parentTaskId: options.parentTaskId,
    requestId: options.requestId,
    items: items
      ? { ids: [...items], processed: 0, succeeded: 0, failures: {} }
      : null,
    sideRun: group ? group.kind !== 'stage' : false,
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

const partIdSchema = z.string().min(1).nullable()

const partIdsSchema = z.object({
  construction: partIdSchema,
  systems: partIdSchema,
  spaceLoads: partIdSchema,
  externalLoads: partIdSchema,
})

/** A part reference of the wrong kind or to nothing, on its field. */
function partIdsIssue(
  state: WorkbenchState,
  parts: Record<PartKind, string | null>,
): CommandOutcome | null {
  for (const kind of PART_KINDS) {
    const partId = parts[kind]
    if (partId !== null && state.parts[partId]?.kind !== kind) {
      return rejected(
        `Choose an existing ${PART_LABELS[kind].toLowerCase()} part, or none.`,
        `parts.${kind}`,
      )
    }
  }
  return null
}

const measured = (label: string, min: number, max: number, unit = '') =>
  z
    .number({ error: `Enter ${label} as a number.` })
    .min(
      min,
      `${label[0]?.toUpperCase()}${label.slice(1)} must be at least ${min}${unit}.`,
    )
    .max(
      max,
      `${label[0]?.toUpperCase()}${label.slice(1)} must be at most ${max}${unit}.`,
    )

const partBase = {
  id: z.string().min(1).optional(),
  name: nameSchema,
}

const partInputSchema = z.discriminatedUnion('kind', [
  z.object({
    ...partBase,
    kind: z.literal('construction'),
    wallU: measured('the wall U-value', 0.1, 4, ' W/m²K'),
    roofU: measured('the roof U-value', 0.1, 4, ' W/m²K'),
    windowU: measured('the window U-value', 0.5, 6, ' W/m²K'),
    windowRatio: measured('the window ratio', 0, 0.9),
    infiltrationAch: measured('infiltration', 0, 3, ' ACH'),
  }),
  z.object({
    ...partBase,
    kind: z.literal('systems'),
    fuel: z.enum(['gas', 'electric', 'district']),
    heatingEfficiency: measured('the heating efficiency', 0.5, 5),
    coolingCop: measured('the cooling COP', 1, 7),
    hotWaterKwhPerM2: measured('hot water', 0, 80, ' kWh/m²'),
  }),
  z.object({
    ...partBase,
    kind: z.literal('spaceLoads'),
    lightingWPerM2: measured('lighting', 0, 30, ' W/m²'),
    equipmentWPerM2: measured('equipment', 0, 60, ' W/m²'),
    m2PerPerson: measured('the floor area per person', 2, 200, ' m²'),
    scheduleId: z.string().min(1).nullable(),
  }),
  z.object({
    ...partBase,
    kind: z.literal('externalLoads'),
    exteriorLightingKwhPerM2: measured('exterior lighting', 0, 30, ' kWh/m²'),
    processKwhPerM2: measured('process loads', 0, 200, ' kWh/m²'),
  }),
])

const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELD_IDS).nullable(),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.string().max(200, 'Use at most 200 characters.'),
})

const measureInputSchema = z.object({
  name: nameSchema,
  kind: z.enum(MEASURE_KINDS),
  savingsPercent: z
    .number({ error: 'Enter savings as a number.' })
    .min(0, 'Savings cannot be negative.')
    .max(60, 'Savings must be at most 60%.'),
})

const adoptionSchema = z
  .number({ error: 'Enter adoption as a number.' })
  .min(0, 'Adoption cannot be negative.')
  .max(100, 'Adoption must be at most 100%.')

const seedSchema = z
  .number({ error: 'Enter the seed as a whole number.' })
  .int('Enter the seed as a whole number.')
  .min(0, 'The seed cannot be negative.')
  .max(999_999, 'Use a seed of at most 999999.')

const scenarioInputSchema = z.object({
  name: nameSchema,
  adoptionPercent: adoptionSchema,
  adoptionSeed: seedSchema.optional(),
  included: z.boolean().default(true),
})

const measureIdSchema = z.string().min(1).nullable()

const measureIdsSchema = z.object({
  envelope: measureIdSchema,
  heating: measureIdSchema,
  lighting: measureIdSchema,
  pv: measureIdSchema,
})

/** A measure input's problem, or null; `id` is the measure being changed. */
function measureIssue(
  state: WorkbenchState,
  input: z.output<typeof measureInputSchema>,
  id: string | null,
): CommandOutcome | null {
  const others = Object.values(state.measures).filter(
    (measure) => measure.id !== id,
  )
  if (!uniqueName(others, input.name)) {
    return rejected(`A measure named "${input.name}" already exists.`, 'name')
  }
  if (input.kind === 'pv' && input.savingsPercent !== 0) {
    return rejected(
      'PV measures use estimated PV yield; set savings to 0%.',
      'savingsPercent',
    )
  }
  return null
}

/** A scenario input's problem, or null; `id` is the scenario being changed. */
function scenarioIssue(
  state: WorkbenchState,
  input: { name: string },
  id: string | null,
): CommandOutcome | null {
  const others = Object.values(state.scenarios).filter(
    (scenario) => scenario.id !== id,
  )
  if (!uniqueName(others, input.name)) {
    return rejected(`A scenario named "${input.name}" already exists.`, 'name')
  }
  return null
}

/**
 * Measures for one rule by category from a list of ids, as
 * `scenario.create` takes them, or the first problem on `measureIds`.
 */
function measuresByKind(
  state: WorkbenchState,
  measureIds: string[],
):
  | { ok: true; measures: Record<MeasureKind, string | null> }
  | { ok: false; outcome: CommandOutcome } {
  const measures = emptyMeasures()
  for (const measureId of new Set(measureIds)) {
    const measure = state.measures[measureId]
    if (!measure) {
      return {
        ok: false,
        outcome: rejected(`Unknown measure "${measureId}".`, 'measureIds'),
      }
    }
    const other = measures[measure.kind]
    if (other !== null) {
      return {
        ok: false,
        outcome: rejected(
          `"${state.measures[other]?.name ?? other}" and "${measure.name}" are both ${kindNoun(measure.kind)} measures. A rule assigns at most one measure of each category.`,
          'measureIds',
        ),
      }
    }
    measures[measure.kind] = measure.id
  }
  return { ok: true, measures }
}

/** A scenario rule and the scenario that lists it, with its position. */
function ruleOwner(
  state: WorkbenchState,
  ruleId: string,
): { rule: ScenarioRule; scenario: Scenario; index: number } | null {
  const rule = state.scenarioRules[ruleId]
  const scenario = rule ? state.scenarios[rule.scenarioId] : undefined
  const index = scenario ? scenario.ruleIds.indexOf(ruleId) : -1
  return rule && scenario && index >= 0 ? { rule, scenario, index } : null
}

/** The scenario rules that assign a measure. */
function rulesUsingMeasure(
  state: WorkbenchState,
  measureId: string,
): ScenarioRule[] {
  return Object.values(state.scenarioRules).filter((rule) =>
    MEASURE_KINDS.some((kind) => rule.measures[kind] === measureId),
  )
}

/** A scenario rule's condition and measure problems, per field. */
function scenarioRuleIssues(
  state: WorkbenchState,
  input: {
    conditions: z.output<typeof conditionSchema>[]
    measures: Record<MeasureKind, string | null>
  },
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  input.conditions.forEach((condition, index) => {
    const issue = conditionIssue(CONDITION_FIELDS, condition)
    if (issue) {
      issues.push({
        path: `conditions.${index}.${issue.path}`,
        message: issue.message,
      })
    }
  })
  for (const kind of MEASURE_KINDS) {
    const measureId = input.measures[kind]
    if (measureId !== null && state.measures[measureId]?.kind !== kind) {
      issues.push({
        path: `measures.${kind}`,
        message: `Choose an existing ${kindNoun(kind)} measure, or none.`,
      })
    }
  }
  if (MEASURE_KINDS.every((kind) => input.measures[kind] === null)) {
    issues.push({
      path: 'measures',
      message: 'Choose at least one measure for the rule to assign.',
    })
  }
  return issues
}

/** A rule name not yet taken in a scenario, from a base name. */
function freeRuleName(
  state: WorkbenchState,
  scenario: Scenario,
  base: string,
  numbered = false,
): string {
  const names = scenario.ruleIds.flatMap((id) => {
    const rule = state.scenarioRules[id]
    return rule ? [rule] : []
  })
  if (!numbered && uniqueName(names, base)) return base
  let name = `${base} (copy)`
  for (let number = 2; !uniqueName(names, name); number += 1) {
    name = `${base} (copy ${number})`
  }
  return name
}

function upsertMeasureAsset(
  state: WorkbenchState,
  measure: Measure,
  context: CommandContext,
) {
  upsertAsset(state, {
    id: `asset:${measure.id}`,
    kind: 'measure',
    name: measure.name,
    parentId: GROUP.measures,
    provenance: {
      kind: 'operation',
      source: context.source,
      operationId: context.operationId,
    },
    capability: 'creator.measure',
    summary:
      measure.kind === 'pv'
        ? 'PV from estimated yield; scenario rules choose the buildings'
        : `${measure.kind}, ${measure.savingsPercent}% savings; scenario rules choose the buildings`,
    entityIds: [measure.id],
  })
}

function upsertScenarioAsset(
  state: WorkbenchState,
  scenario: Scenario,
  context: CommandContext,
) {
  upsertAsset(state, {
    id: `asset:${scenario.id}`,
    kind: 'scenario',
    name: scenario.name,
    parentId: GROUP.scenarios,
    provenance: {
      kind: 'operation',
      source: context.source,
      operationId: context.operationId,
    },
    capability: 'creator.scenario',
    summary: `${scenario.ruleIds.length} rule(s) at ${scenario.adoptionPercent}% adoption, seed ${scenario.adoptionSeed}${scenario.included ? '' : '; left out of the comparison'}`,
    entityIds: [scenario.id, ...scenarioMeasureIds(state, scenario)],
  })
}

/** Bumps the inputs Scenario definitions owns, so definitions and results become outdated. */
function touchScenarioInputs(state: WorkbenchState) {
  const definitions = state.workflow.stages[STAGE_IDS.scenarioDefinitions]
  if (definitions) definitions.editRevision = nextRevision(state)
}

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
  const from =
    field === 'floors'
      ? building.floors
      : effectivePartIds(state, building)[field]
  // For a part, null asks to drop the manual part and follow the rules again.
  const unchanged =
    field === 'floors'
      ? from === to
      : to === null
        ? !state.overrides[key]
        : state.overrides[key]?.value === to
  if (unchanged) {
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

/** Whether no two names match, ignoring case and surrounding spaces. */
function uniqueNames(names: string[]): boolean {
  const normalized = names.map((name) => name.trim().toLowerCase())
  return new Set(normalized).size === normalized.length
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
      if (
        stageId === STAGE_IDS.archetypes &&
        !stageRunBlocker(state.workflow, state.tasks, stageId)
      ) {
        // A first assignment adds the default library archetypes the
        // project lacks and, when it has no rules, generates the defaults.
        const generate = generatesDefaultRules(state)
        for (const entry of missingDefaults(state)) {
          addLibraryArchetype(state, entry)
        }
        if (generate) generateDefaultRules(state)
      }
      const blocker =
        stageRunBlocker(state.workflow, state.tasks, stageId) ??
        itemInputBlocker(state, stageId)
      const stage = state.workflow.stages[stageId]
      if (blocker || !stage) {
        return rejected(blocker ?? `Unknown stage "${stageId}".`, 'stageId')
      }
      supersedeOpenGroups(state, stageId, 'stage')
      const groupId = allocateId(state, 'group')
      const signature = captureSignature(state, stageId)
      state.runGroups[groupId] = {
        id: groupId,
        kind: 'stage',
        stageId,
        signature,
        fusion: null,
        calibration: null,
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
      const items = isItemGroup(group) ? outstandingItems(group) : null
      const retry = createAttempt(state, stage, group.id, {
        items,
        parentTaskId: parent.id,
        requestId: requestId ?? null,
        context,
      })
      state.workflow.currentStageId = stage.id
      return applied(
        `Queued attempt ${retry.attempt} of "${retry.label}": ${scope}.`,
      )
    },
  }),

  'intake.applyDataset': defineCommand({
    title: 'Apply dataset',
    description:
      'Queue a data fusion job for a synthetic dataset with a field mapping. Records match buildings by their stable source ID; matched records update attributes, new records with footprints add buildings, unmatched buildings are kept, and manual overrides win. Mapping errors or duplicate IDs are rejected. Results publish together when every record succeeds.',
    input: z.object({
      datasetId: z.string().min(1, 'Choose a dataset.'),
      mapping: z.record(
        z.string(),
        z
          .enum(['sourceId', 'name', 'use', 'yearBuilt', 'floors', 'footprint'])
          .nullable(),
      ),
      requestId: requestIdSchema,
    }),
    undoable: false,
    run(state, { datasetId, mapping, requestId }, context) {
      const repeated = repeatedSubmission(state, requestId)
      if (repeated) return repeated
      const dataset = findDataset(datasetId)
      if (!dataset)
        return rejected(`Unknown dataset "${datasetId}".`, 'datasetId')
      const stage = state.workflow.stages[STAGE_IDS.schema]
      if (!stage) return rejected('Schema matching is not in this workflow.')
      const blocker = fusionSubmitBlocker(state)
      if (blocker) return rejected(blocker, 'datasetId')
      const prepared = prepareDataset(state, dataset, mapping)
      if (prepared.schemaIssues.length > 0) {
        return { status: 'rejected', issues: prepared.schemaIssues }
      }
      if (prepared.plans.length === 0) {
        return rejected(
          'No record is valid, so there is nothing to apply. Fix the mapping or choose another dataset.',
          'mapping',
        )
      }
      supersedeOpenGroups(state, stage.id, 'fusion')
      const groupId = allocateId(state, 'group')
      const fusion = { datasetId, mapping }
      const signature = captureSignature(state, stage.id, fusion)
      state.runGroups[groupId] = {
        id: groupId,
        kind: 'fusion',
        stageId: stage.id,
        signature,
        fusion,
        calibration: null,
        attemptIds: [],
        held: {},
        status: 'open',
        statusReason: null,
        createdAt: context.now,
      }
      state.runGroupIds.push(groupId)
      createAttempt(state, stage, groupId, {
        items: signature.membership,
        parentTaskId: null,
        requestId: requestId ?? null,
        context,
      })
      return applied(
        `Queued a data fusion of "${dataset.label}" for ${prepared.plans.length} valid records; ${prepared.counts.rejected} rejected records are not applied.`,
      )
    },
  }),

  'schema.mapTarget': defineCommand({
    title: 'Map target field',
    description:
      'Schema matching: map one target field (use, yearBuilt, floors, heightM, floorAreaM2, name, or custom:<name>) to a source attribute of the captured footprints, or to null to unmap it. Each target takes one source; a pending suggestion for the target is dropped. Applying needs a Schema matching run.',
    input: z.object({
      target: z.string().min(1, 'Choose a target field.'),
      source: z.string().min(1).nullable(),
    }),
    undoable: true,
    run(state, { target, source }) {
      const matching = state.schemaMatching
      const spec = findSchemaTarget(matching, target)
      if (!spec) return rejected(`Unknown target field "${target}".`, 'target')
      const sources = sourceCollection(state).names
      if (source !== null && sources.length === 0) {
        return rejected(NO_SOURCES, 'source')
      }
      if (source !== null && !sources.includes(source)) {
        return rejected(
          `"${source}" is not an attribute of the captured footprints. Choose one of ${sources.join(', ')}.`,
          'source',
        )
      }
      if (spec.tier === 'custom' && source === null) {
        return rejected(
          `${spec.label} is a custom target; remove it instead of unmapping it.`,
          'source',
        )
      }
      const previous = matching.mapping[target] ?? null
      delete matching.suggestions[target]
      if (previous === source) {
        return applied(
          source
            ? `${spec.label} already takes "${source}".`
            : `${spec.label} is already unmapped.`,
        )
      }
      if (source === null) delete matching.mapping[target]
      else matching.mapping[target] = source
      touchSchemaInputs(state)
      return applied(
        source
          ? `${spec.label} now takes "${source}"${previous ? ` instead of "${previous}"` : ''}. Run Schema matching to apply it.`
          : `${spec.label} is unmapped${spec.required ? '; it is compulsory, so Schema matching cannot run until it is mapped again' : ''}.`,
      )
    },
  }),

  'schema.reviewSuggestions': defineCommand({
    title: 'Review suggestions',
    description:
      'Schema matching: accept or reject suggested matches. Name the target fields, or give an empty list for every pending suggestion. Accepting maps the target to the suggested source attribute; rejecting drops the suggestion.',
    input: z.object({
      targets: z.array(z.string().min(1)).default([]),
      decision: z.enum(['accept', 'reject']),
    }),
    undoable: true,
    run(state, { targets, decision }) {
      const matching = state.schemaMatching
      const pending = Object.keys(matching.suggestions)
      if (pending.length === 0) {
        return rejected('There are no suggestions to review.', 'targets')
      }
      const chosen = targets.length > 0 ? targets : pending
      const unknown = chosen.find((target) => !matching.suggestions[target])
      if (unknown) {
        return rejected(
          `${findSchemaTarget(matching, unknown)?.label ?? `"${unknown}"`} has no suggestion to review.`,
          'targets',
        )
      }
      const sources = sourceCollection(state).names
      const labels: string[] = []
      for (const target of chosen) {
        const suggestion = matching.suggestions[target]
        delete matching.suggestions[target]
        if (!suggestion || decision === 'reject') {
          labels.push(findSchemaTarget(matching, target)?.label ?? target)
          continue
        }
        if (!sources.includes(suggestion.source)) continue
        matching.mapping[target] = suggestion.source
        labels.push(
          `${findSchemaTarget(matching, target)?.label ?? target} from "${suggestion.source}"`,
        )
      }
      if (decision === 'accept' && labels.length > 0) touchSchemaInputs(state)
      return applied(
        decision === 'accept'
          ? `Accepted ${labels.length} suggestion${labels.length === 1 ? '' : 's'}: ${labels.join(', ')}. Run Schema matching to apply them.`
          : `Rejected ${labels.length} suggestion${labels.length === 1 ? '' : 's'}: ${labels.join(', ')}.`,
      )
    },
  }),

  'schema.suggest': defineCommand({
    title: 'Suggest matches',
    description:
      'Schema matching: suggest a source attribute for every unmapped target field from attribute names (RC\'s "Fuzzy Match All"). Suggestions replace pending ones and wait for review; nothing is mapped until they are accepted.',
    input: z.object({}),
    undoable: true,
    run(state) {
      const matching = state.schemaMatching
      const names = sourceCollection(state).names
      if (names.length === 0) return rejected(NO_SOURCES)
      matching.suggestions = suggestMatches(
        schemaTargets(matching),
        names,
        matching.mapping,
      )
      const count = Object.keys(matching.suggestions).length
      return applied(
        count > 0
          ? `Suggested ${count} match${count === 1 ? '' : 'es'} to review.`
          : 'No unmapped target field has a likely attribute.',
      )
    },
  }),

  'schema.mapValue': defineCommand({
    title: 'Map unrecognised value',
    description:
      'Schema matching: read an unrecognised value of an enumerated target (such as the building tag "yes" for use) as one of its allowed values, or give null to stop reading it. Buildings with unread values keep their enriched values.',
    input: z.object({
      target: z.string().min(1, 'Choose a target field.'),
      value: z.string().trim().min(1, 'Name the value to map.'),
      to: z.string().min(1).nullable(),
    }),
    undoable: true,
    run(state, { target, value, to }) {
      const matching = state.schemaMatching
      const spec = findSchemaTarget(matching, target)
      if (!spec || spec.type !== 'enum') {
        return rejected(
          `"${target}" is not an enumerated target field.`,
          'target',
        )
      }
      if (to !== null && !(spec.allowed ?? []).includes(to)) {
        return rejected(
          `"${to}" is not allowed for ${spec.label}. Choose one of ${(spec.allowed ?? []).join(', ')}.`,
          'to',
        )
      }
      if (recognise(spec, value)) {
        return rejected(
          `"${value}" is already recognised as ${recognise(spec, value)}.`,
          'value',
        )
      }
      const map = (matching.valueMaps[target] ??= {})
      if ((map[value] ?? null) === to) {
        return applied(
          to
            ? `"${value}" is already read as ${to}.`
            : `"${value}" is already unmapped.`,
        )
      }
      if (to === null) delete map[value]
      else map[value] = to
      if (Object.keys(map).length === 0) delete matching.valueMaps[target]
      touchSchemaInputs(state)
      return applied(
        to
          ? `${spec.label}: "${value}" is now read as ${to}. Run Schema matching to apply it.`
          : `${spec.label}: "${value}" is no longer read; those buildings keep their enriched values.`,
      )
    },
  }),

  'schema.addCustomTarget': defineCommand({
    title: 'Add custom target',
    description:
      "Schema matching: add a custom target field that copies a source attribute as text and keeps it with each building (RC's Custom tab). No model calculation reads it.",
    input: z.object({
      name: z.string().trim().min(1, 'Name the custom target.'),
      source: z.string().min(1, 'Choose a source attribute.'),
    }),
    undoable: true,
    run(state, { name, source }) {
      const matching = state.schemaMatching
      const sources = sourceCollection(state).names
      if (sources.length === 0) return rejected(NO_SOURCES, 'source')
      if (!sources.includes(source)) {
        return rejected(
          `"${source}" is not an attribute of the captured footprints.`,
          'source',
        )
      }
      const nameIssue = customNameIssue(matching.customTargets, name)
      if (nameIssue) return rejected(nameIssue, 'name')
      matching.customTargets.push(name)
      matching.mapping[customTargetId(name)] = source
      touchSchemaInputs(state)
      return applied(
        `Added the custom target "${name}" from "${source}". Run Schema matching to copy it.`,
      )
    },
  }),

  'schema.removeCustomTarget': defineCommand({
    title: 'Remove custom target',
    description:
      'Schema matching: remove a custom target field and its mapping. Values copied by an earlier run stay until Schema matching runs again.',
    input: z.object({ name: z.string().min(1, 'Choose a custom target.') }),
    undoable: true,
    run(state, { name }) {
      const matching = state.schemaMatching
      if (!matching.customTargets.includes(name)) {
        return rejected(`There is no custom target "${name}".`, 'name')
      }
      matching.customTargets = matching.customTargets.filter(
        (item) => item !== name,
      )
      delete matching.mapping[customTargetId(name)]
      delete matching.suggestions[customTargetId(name)]
      touchSchemaInputs(state)
      return applied(`Removed the custom target "${name}".`)
    },
  }),

  'schema.saveRuleSet': defineCommand({
    title: 'Save rule set',
    description:
      'Schema matching: save the accepted mapping and value maps as a named rule set kept with the project. A rule set of the same name is replaced. Pending suggestions are not saved.',
    input: z.object({
      name: z
        .string()
        .trim()
        .min(1, 'Name the rule set.')
        .max(80, 'Use at most 80 characters.'),
    }),
    undoable: true,
    run(state, { name }, context) {
      const matching = state.schemaMatching
      const mappings = currentMappings(matching)
      if (mappings.length === 0) {
        return rejected(
          'Map at least one target field before saving a rule set.',
          'name',
        )
      }
      if (name.toLowerCase() === BUILT_IN_RULE_SET.toLowerCase()) {
        return rejected('The built-in rule set cannot be replaced.', 'name')
      }
      const existing = Object.values(matching.ruleSets).find(
        (ruleSet) => ruleSet.name.toLowerCase() === name.toLowerCase(),
      )
      const id = existing?.id ?? allocateId(state, 'ruleSet')
      matching.ruleSets[id] = {
        id,
        name,
        version: 1,
        mappings,
        valueMaps: copyValueMaps(matching.valueMaps),
        savedAt: context.now,
        operationId: context.operationId,
      }
      if (!existing) matching.ruleSetIds.push(id)
      matching.loadedFrom = name
      return applied(
        `${existing ? 'Replaced' : 'Saved'} the rule set "${name}" with ${mappings.length} mapping${mappings.length === 1 ? '' : 's'}.`,
      )
    },
  }),

  'schema.loadRuleSet': defineCommand({
    title: 'Load rule set',
    description:
      'Schema matching: replace the mapping with a rule set, named by ruleSetId (a saved one, or "ruleSet:builtin" for the built-in OpenStreetMap tags) or given as a file in RC\'s shape {version: 1, mappings: [{target, source, tier, transform}], valueMaps}. Entries naming targets or sources that do not exist, or a transform, are skipped and reported. Pending suggestions are dropped.',
    input: z
      .object({
        ruleSetId: z.string().min(1).optional(),
        file: ruleSetFileSchema.optional(),
      })
      .refine(
        (input) =>
          (input.ruleSetId === undefined) !== (input.file === undefined),
        { message: 'Choose a saved rule set or a file, not both.' },
      ),
    undoable: true,
    run(state, { ruleSetId, file }) {
      const matching = state.schemaMatching
      if (sourceCollection(state).names.length === 0) {
        return rejected(NO_SOURCES, 'ruleSetId')
      }
      let name: string
      let content: Pick<RuleSetFile, 'mappings' | 'valueMaps'>
      if (ruleSetId === BUILT_IN_RULE_SET_ID) {
        const builtIn = createSchemaMatching()
        name = BUILT_IN_RULE_SET
        content = {
          mappings: currentMappings(builtIn),
          valueMaps: builtIn.valueMaps,
        }
      } else if (ruleSetId !== undefined) {
        const saved = matching.ruleSets[ruleSetId]
        if (!saved) {
          return rejected(`Unknown rule set "${ruleSetId}".`, 'ruleSetId')
        }
        name = saved.name
        content = saved
      } else if (file) {
        name = file.name ?? 'Rule set file'
        content = file
      } else {
        return rejected('Choose a saved rule set or a file.', 'ruleSetId')
      }
      const check = checkRuleSet(state, content)
      if (check.applicable.length === 0) {
        return rejected(
          `Nothing in "${name}" can be loaded: ${check.skipped.join(' ') || 'it has no mappings.'}`,
          file ? 'file' : 'ruleSetId',
        )
      }
      const next = {
        mapping: Object.fromEntries(
          check.applicable.map((entry) => [entry.target, entry.source]),
        ),
        customTargets: check.customTargets,
        valueMaps: check.valueMaps,
      }
      // Loading what is already mapped outdates nothing.
      const changed = !sameMappingConfig(matching, next)
      matching.mapping = next.mapping
      matching.customTargets = next.customTargets
      matching.valueMaps = next.valueMaps
      matching.suggestions = {}
      if (changed) touchSchemaInputs(state)
      matching.loadedFrom = name
      const loaded = `Loaded "${name}": ${check.applicable.length} mapping${check.applicable.length === 1 ? '' : 's'}`
      return applied(
        check.skipped.length > 0
          ? `${loaded}; skipped ${check.skipped.length}: ${check.skipped.join(' ')}`
          : changed
            ? `${loaded}. Run Schema matching to apply it.`
            : `${loaded}; the mapping already matched it, so nothing is outdated.`,
      )
    },
  }),

  'schema.deleteRuleSet': defineCommand({
    title: 'Delete rule set',
    description:
      'Schema matching: delete a saved rule set. The current mapping does not change.',
    input: z.object({ ruleSetId: z.string().min(1, 'Choose a rule set.') }),
    undoable: true,
    run(state, { ruleSetId }) {
      const matching = state.schemaMatching
      const ruleSet = matching.ruleSets[ruleSetId]
      if (!ruleSet) {
        return rejected(`Unknown rule set "${ruleSetId}".`, 'ruleSetId')
      }
      delete matching.ruleSets[ruleSetId]
      matching.ruleSetIds = matching.ruleSetIds.filter((id) => id !== ruleSetId)
      if (matching.loadedFrom === ruleSet.name) matching.loadedFrom = null
      return applied(`Deleted the rule set "${ruleSet.name}".`)
    },
  }),

  'archetype.save': defineCommand({
    title: 'Save archetype',
    description:
      'Create an archetype, or change one by id: a name, building use, optional construction-year range, and the part of each of the four kinds it bundles (construction, systems, spaceLoads, externalLoads; a part id or null). Archetypes feed the generated default rules; generate them again to use the change.',
    input: z.object({
      name: nameSchema,
      id: z.string().min(1).optional(),
      use: buildingUseSchema,
      yearFrom: yearSchema,
      yearTo: yearSchema,
      parts: partIdsSchema,
    }),
    undoable: true,
    run(state, input, context) {
      const existing = input.id ? state.archetypes[input.id] : undefined
      if (input.id && !existing) {
        return rejected(`Unknown archetype "${input.id}".`, 'id')
      }
      const others = Object.values(state.archetypes).filter(
        (archetype) => archetype.id !== input.id,
      )
      if (!uniqueName(others, input.name)) {
        return rejected(
          `An archetype named "${input.name}" already exists.`,
          'name',
        )
      }
      if (
        input.yearFrom !== null &&
        input.yearTo !== null &&
        input.yearFrom > input.yearTo
      ) {
        return rejected(
          'The first construction year must not be after the last.',
          'yearTo',
        )
      }
      const partIssue = partIdsIssue(state, input.parts)
      if (partIssue) return partIssue
      if (PART_KINDS.every((kind) => input.parts[kind] === null)) {
        return rejected('Choose at least one part.', 'parts')
      }
      const id = existing?.id ?? allocateId(state, 'archetype')
      state.archetypes[id] = {
        id,
        name: input.name,
        use: input.use,
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        parts: { ...input.parts },
        source: editedSource(existing?.source ?? null, context.operationId),
      }
      return applied(
        existing
          ? `Updated archetype "${input.name}"; generate the default rules again to use it.`
          : `Created archetype "${input.name}"; generate the default rules again to assign it.`,
      )
    },
  }),

  'archetype.addFromLibrary': defineCommand({
    title: 'Add archetype from library',
    description:
      'Copy an archetype from the synthetic library into the project, with the four parts it bundles and their schedules. The copy keeps its library provenance and can then be edited; generate the default rules again to assign it.',
    input: z.object({
      libraryId: z.string().min(1, 'Choose a library archetype.'),
    }),
    undoable: true,
    run(state, { libraryId }) {
      const entry = ARCHETYPE_LIBRARY.find(
        (archetype) => archetype.id === libraryId,
      )
      if (!entry)
        return rejected(
          `Unknown library archetype "${libraryId}".`,
          'libraryId',
        )
      if (state.archetypes[entry.id]) {
        return rejected(
          `"${entry.name}" is already in the project.`,
          'libraryId',
        )
      }
      if (!uniqueName(Object.values(state.archetypes), entry.name)) {
        return rejected(
          `An archetype named "${entry.name}" already exists.`,
          'libraryId',
        )
      }
      addLibraryArchetype(state, entry)
      return applied(
        `Added "${entry.name}" and its parts from the synthetic library.`,
      )
    },
  }),

  'part.save': defineCommand({
    title: 'Save archetype part',
    description:
      'Create an archetype part, or change one by id. kind is construction (wallU, roofU, windowU in W/m²K, windowRatio 0 to 0.9, infiltrationAch), systems (fuel gas, electric, or district; heatingEfficiency 0.5 to 5, coolingCop 1 to 7, hotWaterKwhPerM2), spaceLoads (lightingWPerM2, equipmentWPerM2, m2PerPerson, scheduleId or null), or externalLoads (exteriorLightingKwhPerM2, processKwhPerM2). A part used by rules or buildings outdates Archetype modeling.',
    input: partInputSchema,
    undoable: true,
    run(state, input, context) {
      const existing = input.id ? state.parts[input.id] : undefined
      if (input.id && !existing) {
        return rejected(`Unknown part "${input.id}".`, 'id')
      }
      if (existing && existing.kind !== input.kind) {
        return rejected(
          `"${existing.name}" is a ${PART_LABELS[existing.kind].toLowerCase()} part; its kind cannot change.`,
          'kind',
        )
      }
      const others = Object.values(state.parts).filter(
        (part) => part.id !== input.id,
      )
      if (!uniqueName(others, input.name)) {
        return rejected(`A part named "${input.name}" already exists.`, 'name')
      }
      if (
        input.kind === 'spaceLoads' &&
        input.scheduleId !== null &&
        !state.schedules[input.scheduleId]
      ) {
        return rejected('Choose an existing schedule or none.', 'scheduleId')
      }
      const id = existing?.id ?? allocateId(state, 'part')
      const { id: _id, ...fields } = input
      void _id
      state.parts[id] = {
        ...fields,
        id,
        source: editedSource(existing?.source ?? null, context.operationId),
      }
      if (existing && partInUse(state, id)) touchArchetypeInputs(state)
      return applied(
        existing
          ? `Updated part "${input.name}".`
          : `Created ${PART_LABELS[input.kind].toLowerCase()} part "${input.name}".`,
      )
    },
  }),

  'schedule.save': defineCommand({
    title: 'Save schedule',
    description:
      'Create a schedule, or change one by id: a name, one to seven day types (such as Weekday, Saturday, Sunday) each with 24 hourly fractions from 0 to 1, and the day type each day of the week uses, Monday first. Space-loads parts using it, and so Archetype modeling, become outdated.',
    input: z.object({
      name: nameSchema,
      id: z.string().min(1).optional(),
      days: z
        .array(dayProfileSchema)
        .min(1, 'Add at least one day type.')
        .max(7, 'Use at most seven day types, one per day.'),
      week: weekSchema,
    }),
    undoable: true,
    run(state, input, context) {
      const existing = input.id ? state.schedules[input.id] : undefined
      if (input.id && !existing) {
        return rejected(`Unknown schedule "${input.id}".`, 'id')
      }
      const others = Object.values(state.schedules).filter(
        (schedule) => schedule.id !== input.id,
      )
      if (!uniqueName(others, input.name)) {
        return rejected(
          `A schedule named "${input.name}" already exists.`,
          'name',
        )
      }
      const ids = input.days.map((day) => day.id)
      if (new Set(ids).size !== ids.length) {
        return rejected('Each day type needs its own id.', 'days')
      }
      if (!uniqueNames(input.days.map((day) => day.name))) {
        return rejected('Give each day type a different name.', 'days')
      }
      const unknownDay = input.week.find((id) => !ids.includes(id))
      if (unknownDay !== undefined) {
        return rejected(
          `The week uses a day type that is not defined ("${unknownDay}").`,
          'week',
        )
      }
      const unused = input.days.find((day) => !input.week.includes(day.id))
      if (unused) {
        return rejected(
          `"${unused.name}" is not used on any day; assign it to a day or remove it.`,
          'week',
        )
      }
      if (input.days.every((day) => day.hours.every((value) => value === 0))) {
        return rejected('A schedule needs at least one hour above 0.', 'days')
      }
      const id = existing?.id ?? allocateId(state, 'schedule')
      state.schedules[id] = {
        id,
        name: input.name,
        days: input.days.map((day) => ({
          id: day.id,
          name: day.name.trim(),
          hours: [...day.hours],
        })),
        week: [...input.week],
        source: editedSource(existing?.source ?? null, context.operationId),
      }
      // Only space loads that follow the schedule, and are in use, are affected.
      if (
        Object.values(state.parts).some(
          (part) =>
            part.kind === 'spaceLoads' &&
            part.scheduleId === id &&
            partInUse(state, part.id),
        )
      ) {
        touchArchetypeInputs(state)
      }
      return applied(
        existing
          ? `Updated schedule "${input.name}".`
          : `Created schedule "${input.name}".`,
      )
    },
  }),

  'rule.save': defineCommand({
    title: 'Save assignment rule',
    description:
      'Create an archetype assignment rule, or change one by id: a name, enabled (left out: on for a new rule, unchanged for an existing one), logic (all, any, or none of the conditions), conditions of field (use, yearBuilt, floors, floorAreaM2, heightM, footprintAreaM2, name, or null for a blank one), operator (larger, smaller, equals, contains, notContains; numbers take larger, smaller, equals; use takes equals, notContains; text takes contains, notContains, equals), and value, and the part of each kind it sets (a part id or null). No conditions match every building. Rules are tried top first and each part takes the first enabled matching rule that sets it; a new rule goes to position (default 0, the top), and a changed rule moves only when position is given. Archetype modeling becomes outdated.',
    input: z.object({
      name: nameSchema,
      id: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      logic: z.enum(['all', 'any', 'none']),
      conditions: z
        .array(conditionSchema)
        .max(20, 'Use at most 20 conditions.'),
      parts: partIdsSchema,
      position: z.number().int().min(0).optional(),
    }),
    undoable: true,
    run(state, input) {
      const existing = input.id ? state.rules[input.id] : undefined
      if (input.id && !existing) {
        return rejected(`Unknown rule "${input.id}".`, 'id')
      }
      const others = Object.values(state.rules).filter(
        (rule) => rule.id !== input.id,
      )
      if (!uniqueName(others, input.name)) {
        return rejected(`A rule named "${input.name}" already exists.`, 'name')
      }
      const issues: ValidationIssue[] = []
      input.conditions.forEach((condition, index) => {
        const issue = conditionIssue(CONDITION_FIELDS, condition)
        if (issue) {
          issues.push({
            path: `conditions.${index}.${issue.path}`,
            message: issue.message,
          })
        }
      })
      for (const kind of PART_KINDS) {
        const partId = input.parts[kind]
        if (partId !== null && state.parts[partId]?.kind !== kind) {
          issues.push({
            path: `parts.${kind}`,
            message: `Choose an existing ${PART_LABELS[kind].toLowerCase()} part, or none.`,
          })
        }
      }
      if (PART_KINDS.every((kind) => input.parts[kind] === null)) {
        issues.push({
          path: 'parts',
          message: 'Choose at least one part for the rule to set.',
        })
      }
      if (issues.length > 0) return { status: 'rejected', issues }
      const id = existing?.id ?? allocateId(state, 'rule')
      state.rules[id] = {
        id,
        name: input.name,
        // Left out, a new rule is on and a changed rule keeps its switch.
        enabled: input.enabled ?? existing?.enabled ?? true,
        logic: input.logic,
        conditions: input.conditions.map((condition) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value.trim(),
        })),
        parts: { ...input.parts },
        // An edited generated rule becomes the project's own.
        origin: 'project',
      }
      if (!existing) {
        const position = Math.min(input.position ?? 0, state.ruleIds.length)
        state.ruleIds.splice(position, 0, id)
      } else if (input.position !== undefined) {
        // A changed rule moves only when a position is given.
        const others = state.ruleIds.filter((ruleId) => ruleId !== id)
        others.splice(Math.min(input.position, others.length), 0, id)
        state.ruleIds = others
      }
      touchArchetypeInputs(state)
      return applied(
        existing
          ? `Updated rule "${input.name}" at position ${state.ruleIds.indexOf(id) + 1}; run Archetype modeling to reassign parts.`
          : `Created rule "${input.name}" at position ${state.ruleIds.indexOf(id) + 1}; run Archetype modeling to assign it.`,
      )
    },
  }),

  'rule.move': defineCommand({
    title: 'Move assignment rule',
    description:
      'Move an assignment rule to a position counted from the top (0 is the highest priority). Archetype modeling becomes outdated.',
    input: z.object({
      ruleId: z.string().min(1, 'Choose a rule.'),
      position: z.number().int().min(0),
    }),
    undoable: true,
    run(state, { ruleId, position }) {
      const rule = state.rules[ruleId]
      const from = state.ruleIds.indexOf(ruleId)
      if (!rule || from < 0)
        return rejected(`Unknown rule "${ruleId}".`, 'ruleId')
      if (position >= state.ruleIds.length) {
        return rejected(
          `Choose a position from 1 to ${state.ruleIds.length}.`,
          'position',
        )
      }
      if (position === from) {
        return rejected(`"${rule.name}" is already there.`, 'position')
      }
      state.ruleIds.splice(from, 1)
      state.ruleIds.splice(position, 0, ruleId)
      touchArchetypeInputs(state)
      return applied(
        `Moved "${rule.name}" to position ${position + 1} of ${state.ruleIds.length}.`,
      )
    },
  }),

  'rule.setEnabled': defineCommand({
    title: 'Switch assignment rule',
    description:
      'Switch an assignment rule on or off; a rule that is off is skipped. Archetype modeling becomes outdated.',
    input: z.object({
      ruleId: z.string().min(1, 'Choose a rule.'),
      enabled: z.boolean(),
    }),
    undoable: true,
    run(state, { ruleId, enabled }) {
      const rule = state.rules[ruleId]
      if (!rule) return rejected(`Unknown rule "${ruleId}".`, 'ruleId')
      if (rule.enabled === enabled) {
        return rejected(
          `"${rule.name}" is already ${enabled ? 'on' : 'off'}.`,
          'enabled',
        )
      }
      rule.enabled = enabled
      touchArchetypeInputs(state)
      return applied(`Switched "${rule.name}" ${enabled ? 'on' : 'off'}.`)
    },
  }),

  'rule.duplicate': defineCommand({
    title: 'Duplicate assignment rule',
    description:
      'Copy an assignment rule just below it, as the project’s own rule. Archetype modeling becomes outdated.',
    input: z.object({ ruleId: z.string().min(1, 'Choose a rule.') }),
    undoable: true,
    run(state, { ruleId }) {
      const rule = state.rules[ruleId]
      const from = state.ruleIds.indexOf(ruleId)
      if (!rule || from < 0)
        return rejected(`Unknown rule "${ruleId}".`, 'ruleId')
      const names = Object.values(state.rules)
      let name = `${rule.name} (copy)`
      for (let number = 2; !uniqueName(names, name); number += 1) {
        name = `${rule.name} (copy ${number})`
      }
      const id = allocateId(state, 'rule')
      // The rule is a draft here, so it is copied field by field.
      state.rules[id] = {
        id,
        name,
        enabled: rule.enabled,
        logic: rule.logic,
        conditions: rule.conditions.map((condition) => ({ ...condition })),
        parts: { ...rule.parts },
        origin: 'project',
      }
      state.ruleIds.splice(from + 1, 0, id)
      touchArchetypeInputs(state)
      return applied(`Duplicated "${rule.name}" as "${name}".`)
    },
  }),

  'rule.remove': defineCommand({
    title: 'Remove assignment rule',
    description:
      'Remove an assignment rule. Buildings keep their published parts until Archetype modeling runs again; undo brings the rule back.',
    input: z.object({ ruleId: z.string().min(1, 'Choose a rule.') }),
    undoable: true,
    run(state, { ruleId }) {
      const rule = state.rules[ruleId]
      if (!rule) return rejected(`Unknown rule "${ruleId}".`, 'ruleId')
      delete state.rules[ruleId]
      state.ruleIds = state.ruleIds.filter((id) => id !== ruleId)
      touchArchetypeInputs(state)
      return applied(`Removed "${rule.name}".`)
    },
  }),

  'rule.generateDefaults': defineCommand({
    title: 'Generate default rules',
    description:
      'Replace the generated assignment rules with one rule per project archetype (its use and construction-year range, narrowest range first) and a fallback rule without conditions last, as RC does. Rules written in the project are kept above them.',
    input: z.object({}),
    undoable: true,
    run(state) {
      if (Object.keys(state.archetypes).length === 0) {
        return rejected(
          'There are no archetypes to generate rules from. Add archetypes from the library first.',
        )
      }
      const { added, kept } = generateDefaultRules(state)
      touchArchetypeInputs(state)
      return applied(
        `Generated ${added} default rules from ${Object.keys(state.archetypes).length} archetypes, with the fallback last${kept.length > 0 ? `; kept the project's own ${kept.map((name) => `"${name}"`).join(', ')} instead of a default of the same name` : ''}.`,
      )
    },
  }),

  'calibration.fit': defineCommand({
    title: 'Fit baseline to meters',
    description:
      'Queue a calibration fit of the modeled baseline to a synthetic monthly meter series in kWh or MWh. The fit publishes a separate calibrated variant with before and after residuals; the working baseline changes only when the variant is adopted.',
    input: z.object({
      meterId: z.string().min(1, 'Choose a meter series.'),
      unit: z.enum(['kWh', 'MWh']),
      requestId: requestIdSchema,
    }),
    undoable: false,
    run(state, { meterId, unit, requestId }, context) {
      const repeated = repeatedSubmission(state, requestId)
      if (repeated) return repeated
      const input = { meterId, unit }
      const blocker = fitBlocker(state, input)
      if (blocker) return rejected(blocker, 'meterId')
      const stage = state.workflow.stages[STAGE_IDS.baseline]
      if (!stage)
        return rejected('Baseline model setup is not in this workflow.')
      supersedeOpenGroups(state, stage.id, 'calibration')
      const groupId = allocateId(state, 'group')
      state.runGroups[groupId] = {
        id: groupId,
        kind: 'calibration',
        stageId: stage.id,
        signature: captureSignature(state, stage.id, null, input),
        fusion: null,
        calibration: input,
        attemptIds: [],
        held: {},
        status: 'open',
        statusReason: null,
        createdAt: context.now,
      }
      state.runGroupIds.push(groupId)
      createAttempt(state, stage, groupId, {
        items: null,
        parentTaskId: null,
        requestId: requestId ?? null,
        context,
      })
      return applied(
        `Queued a calibration fit to "${findMeter(meterId)?.label ?? meterId}" in ${unit}.`,
      )
    },
  }),

  'calibration.adopt': defineCommand({
    title: 'Adopt calibrated baseline',
    description:
      'Make a calibrated variant the working baseline. Results that depend on the baseline (scenarios, grid, dashboard) become outdated. The modeled baseline is kept so the change can be reverted.',
    input: z.object({ variantId: z.string().min(1, 'Choose a variant.') }),
    undoable: false,
    run(state, { variantId }, context) {
      const blocker = adoptBlocker(state, variantId)
      if (blocker) return rejected(blocker, 'variantId')
      const variant = state.calibration.variants[variantId]
      const source = modeledSource(state)
      const stage = state.workflow.stages[STAGE_IDS.baseline]
      if (!variant || !source || !stage) return rejected('Nothing to adopt.')
      state.calibration.modeled = source
      state.calibration.adoptedVariantId = variantId
      state.results.baseline = { ...variant.result }
      stage.revision = nextRevision(state)
      upsertBaselineAsset(state, context, `adopted "${variant.label}"`)
      return applied(
        `Adopted "${variant.label}" as the working baseline; dependent results are now outdated.`,
      )
    },
  }),

  'calibration.revert': defineCommand({
    title: 'Revert to modeled baseline',
    description:
      'Return the working baseline to the modeled baseline kept when a calibrated variant was adopted. Dependent results become outdated.',
    input: z.object({}),
    undoable: false,
    run(state, _input, context) {
      const modeled = state.calibration.modeled
      const stage = state.workflow.stages[STAGE_IDS.baseline]
      if (!state.calibration.adoptedVariantId || !modeled || !stage) {
        return rejected('No calibrated variant is adopted.')
      }
      state.results.baseline = { ...modeled.result }
      state.calibration.adoptedVariantId = null
      state.calibration.modeled = null
      stage.revision = nextRevision(state)
      upsertBaselineAsset(state, context, 'reverted to the modeled baseline')
      return applied(
        'The working baseline is the modeled baseline again; dependent results are now outdated.',
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

  'zoning.set': defineCommand({
    title: 'Set zoning',
    description: `Set how "Geospatial preprocessing" divides buildings into thermal zones, in RC's three modes: single (${ZONING_MODE_LABELS.single.toLowerCase()}), floors (${ZONING_MODE_LABELS.floors.toLowerCase()}), or perimeterCore (a core and one perimeter zone per footprint edge on every floor; short edges join the zone before them). perimeterDepthM, ${MIN_PERIMETER_DEPTH_M} to ${MAX_PERIMETER_DEPTH_M} m, is the perimeter band's depth and is kept for perimeterCore. Buildings whose footprint cannot be inset fall back to one zone per floor with a warning. Geospatial preprocessing and every later stage become outdated until it runs again; zones are display only.`,
    input: z.object({
      mode: z.enum(ZONING_MODES, {
        error: 'Choose single, floors, or perimeterCore.',
      }),
      perimeterDepthM: z
        .number({ error: 'Enter a depth in metres.' })
        .min(
          MIN_PERIMETER_DEPTH_M,
          `Use a depth from ${MIN_PERIMETER_DEPTH_M} to ${MAX_PERIMETER_DEPTH_M} m.`,
        )
        .max(
          MAX_PERIMETER_DEPTH_M,
          `Use a depth from ${MIN_PERIMETER_DEPTH_M} to ${MAX_PERIMETER_DEPTH_M} m.`,
        )
        .optional(),
    }),
    undoable: true,
    run(state, { mode, perimeterDepthM }) {
      const stage = state.workflow.stages[STAGE_IDS.preprocessing]
      if (!stage) {
        return rejected('The workflow has no "Geospatial preprocessing" stage.')
      }
      if (hasActiveTask(state.tasks, stage.id)) {
        return rejected(
          `"${stage.name}" is running. Wait for it to finish before changing the zoning.`,
        )
      }
      const next = {
        mode,
        perimeterDepthM:
          perimeterDepthM === undefined
            ? state.zoning.perimeterDepthM
            : Math.round(perimeterDepthM * 10) / 10,
      }
      if (
        next.mode === state.zoning.mode &&
        next.perimeterDepthM === state.zoning.perimeterDepthM
      ) {
        return rejected(
          `The zoning is already ${describeZoning(next).toLowerCase()}.`,
          perimeterDepthM === undefined ? 'mode' : 'perimeterDepthM',
        )
      }
      const zonesChange = projectZoningChanges(state, next)
      // Buildings overridden to perimeter and core use the project's depth
      // whatever its mode (decision 0034).
      const depthUsers = depthOverrides(state)
      const depthOnly =
        next.mode === state.zoning.mode &&
        next.mode !== 'perimeterCore' &&
        next.perimeterDepthM !== state.zoning.perimeterDepthM
      state.zoning.mode = next.mode
      state.zoning.perimeterDepthM = next.perimeterDepthM
      if (!zonesChange) {
        // A depth kept for perimeter and core changes no zone today.
        return applied(
          `Perimeter depth set to ${next.perimeterDepthM} m for perimeter and core zoning; the current zoning, ${describeZoning(next).toLowerCase()}, does not use it, and no building is zoned by perimeter and core of its own.`,
        )
      }
      stage.editRevision = nextRevision(state)
      if (depthOnly) {
        return applied(
          `Perimeter depth set to ${next.perimeterDepthM} m. The project's zoning, ${describeZoning(next).toLowerCase()}, does not use it, but ${depthUsers.length} building${depthUsers.length === 1 ? ' zoned' : 's zoned'} by perimeter and core of ${depthUsers.length === 1 ? 'its' : 'their'} own do (${depthUsers.slice(0, 5).join(', ')}${depthUsers.length > 5 ? ', …' : ''}). "${stage.name}" and the stages after it are outdated until it runs again.`,
        )
      }
      const own = Object.keys(state.zoning.overrides).filter(
        (id) => state.buildings[id],
      ).length
      return applied(
        `Zoning set to ${describeZoning(next).toLowerCase()}. "${stage.name}" and the stages after it are outdated until it runs again.${own > 0 ? ` ${own} building${own === 1 ? ' keeps its' : 's keep their'} own zoning.` : ''}`,
      )
    },
  }),

  'zoning.setBuilding': defineCommand({
    title: 'Set a building’s zoning',
    description: `Zone one building its own way instead of the project's zoning (decision 0034), or return it to the project default. mode is default (follow the project's zoning), single (${BUILDING_ZONING_LABELS.single.toLowerCase()}), floors (${BUILDING_ZONING_LABELS.floors.toLowerCase()}), perimeterCore (${BUILDING_ZONING_LABELS.perimeterCore.toLowerCase()}, at the project's perimeter depth), or drawn (the building's drawn zone outlines stored with the project, synthetic). A building set to perimeterCore or drawn whose footprint or drawn zones do not allow it falls back to one zone per floor with a coded reason. When the building's zones change, "Geospatial preprocessing" and every later stage become outdated until it runs again; zones are display only.`,
    input: z.object({
      buildingId: z.string().min(1, 'Choose a building.'),
      mode: z.enum(BUILDING_ZONING_CHOICES, {
        error:
          'Choose default, single, floors, perimeterCore, or drawn for the building.',
      }),
    }),
    undoable: true,
    run(state, { buildingId, mode }) {
      const stage = state.workflow.stages[STAGE_IDS.preprocessing]
      if (!stage) {
        return rejected('The workflow has no "Geospatial preprocessing" stage.')
      }
      const building = state.buildings[buildingId]
      if (!building) {
        return rejected(`Building ${buildingId} does not exist.`, 'buildingId')
      }
      if (hasActiveTask(state.tasks, stage.id)) {
        return rejected(
          `"${stage.name}" is running. Wait for it to finish before changing a building's zoning.`,
          'mode',
        )
      }
      const label = `${building.name} (${building.id})`
      const current = state.zoning.overrides[buildingId] ?? 'default'
      if (current === mode) {
        return rejected(
          mode === 'default'
            ? `${label} already follows the project's zoning, ${describeZoning(state.zoning).toLowerCase()}.`
            : `${label} is already zoned by ${BUILDING_ZONING_LABELS[mode].toLowerCase()}.`,
          'mode',
        )
      }
      const before = resolveBuildingZoning(state.zoning, buildingId)
      if (mode === 'default') delete state.zoning.overrides[buildingId]
      else state.zoning.overrides[buildingId] = mode
      const after = resolveBuildingZoning(state.zoning, buildingId)
      const what =
        mode === 'default'
          ? `${label} follows the project's zoning again, ${describeZoning(state.zoning).toLowerCase()}.`
          : `${label} is zoned by ${describeBuildingZoning(after).toLowerCase()}, overriding the project's ${describeZoning(state.zoning).toLowerCase()}.`
      // A planned fallback is said now rather than discovered after the run.
      const planned = plannedZoning(state, buildingId)
      const fallback =
        planned?.fallback ??
        (planned === null &&
        after.mode === 'drawn' &&
        !state.zoning.drawn[buildingId]
          ? {
              code: 'drawn_zones_missing',
              message:
                'Drawn zones fell back to one zone per floor: this building has no drawn zones.',
            }
          : null)
      const fallbackNote =
        fallback && (after.mode === 'drawn' || after.mode === 'perimeterCore')
          ? ` ${fallback.message} (${fallback.code})`
          : ''
      if (sameBuildingZoning(before, after)) {
        return applied(
          `${what} Its zones are unchanged, so nothing is outdated.${fallbackNote}`,
        )
      }
      stage.editRevision = nextRevision(state)
      return applied(
        `${what} "${stage.name}" and the stages after it are outdated until it runs again.${fallbackNote}`,
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
      const plans = fusionPlans(state, group)
      let failed = 0
      for (const id of batch) {
        let output: HeldOutput | null
        let missing: string | null
        if (plans) {
          output = plans.get(id) ?? null
          missing = output ? null : 'The record no longer validates.'
        } else {
          ;({ output, missing } = stageItem(state, group.stageId, id))
        }
        const reason = failures[id] ?? missing
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
      const isFusion = group?.kind === 'fusion'
      if (!group || group.kind === 'stage') {
        state.issues = state.issues.filter(
          (issue) => issue.stageId !== stage.id,
        )
      }
      task.updatedAt = context.now

      const changed = group ? signatureMismatch(state, group) : null
      if (group && changed) {
        group.status = 'invalidated'
        group.statusReason = `Not published: ${changed} during the run.`
        group.held = {}
        const message = `${group.statusReason} Start a fresh run.`
        failRun(state, task, stage, message, inputRevisions, context)
        return applied(`"${task.label}" was not published: ${changed}.`)
      }

      if (group?.kind === 'calibration' && group.calibration) {
        const published = publishFit(state, group.calibration, task, context)
        if (!published.ok) {
          failRun(
            state,
            task,
            stage,
            published.message,
            inputRevisions,
            context,
          )
          return applied(`"${task.label}" failed: ${published.message}`)
        }
        group.status = 'published'
        group.statusReason = null
        task.status = 'succeeded'
        task.progress = 1
        task.message = published.summary
        task.log.push({
          at: context.now,
          message: `Completed. ${published.summary}`,
        })
        return applied(published.summary)
      }

      let result: StageRunResult
      if (group && task.items) {
        const failures = Object.keys(task.items.failures).length
        const noun = isFusion ? 'records' : 'items'
        if (failures > 0) {
          const held = Object.keys(group.held).length
          const message = `${failures} of ${task.items.ids.length} ${noun} failed. ${held} successful results are held and not published until the failed ${noun} are retried.`
          failRun(state, task, stage, message, inputRevisions, context)
          return applied(`"${task.label}" partly failed: ${message}`)
        }
        const membership = group.signature.membership
        const fusionHeld = heldOf<HeldFusionOutput>(group, isFusionOutput)
        const assignmentHeld = heldOf<HeldAssignmentOutput>(
          group,
          isAssignmentOutput,
        )
        const scenarioHeld = heldOf<HeldScenarioOutput>(group, isScenarioOutput)
        const preprocessingHeld = heldOf<HeldPreprocessingOutput>(
          group,
          (output) => !('kind' in output),
        )
        const isAssignment = group.stageId === STAGE_IDS.archetypes && !isFusion
        const isScenarioSet =
          group.stageId === STAGE_IDS.scenarioModeling && !isFusion
        const invalid =
          failPublication ??
          (isFusion
            ? validateFusion(state, membership, fusionHeld)
            : isAssignment
              ? validateAssignment(state, membership, assignmentHeld)
              : isScenarioSet
                ? validateScenarioResults(state, membership, scenarioHeld)
                : validatePreprocessing(state, membership, preprocessingHeld))
        if (invalid) {
          group.statusReason = `Publication failed: ${invalid}`
          const message = `Publication failed: ${invalid}. All ${membership.length} results stay held; retry publication once the cause is resolved.`
          failRun(state, task, stage, message, inputRevisions, context)
          return applied(`"${task.label}" was not published: ${invalid}.`)
        }
        const dataset = group.fusion
          ? findDataset(group.fusion.datasetId)
          : null
        if (isFusion && group.fusion && dataset) {
          const published = publishFusion(
            state,
            dataset,
            group.fusion.mapping,
            membership,
            fusionHeld,
            context,
          )
          // New buildings change footprint capture's output; attributes change enrichment's.
          if (published.added > 0) {
            const location = state.workflow.stages[STAGE_IDS.location]
            if (location) location.revision = nextRevision(state)
          }
          if (published.updated > 0) {
            const enrichment = state.workflow.stages[STAGE_IDS.enrichment]
            if (enrichment) enrichment.revision = nextRevision(state)
          }
          group.status = 'published'
          group.statusReason = null
          group.held = {}
          task.status = 'succeeded'
          task.progress = 1
          task.message = published.summary
          task.log.push({
            at: context.now,
            message: `Completed. ${published.summary}`,
          })
          return applied(published.summary)
        }
        const runContext = {
          runId: task.runId,
          operationId: context.operationId,
          attempt: stage.runCount,
        }
        result = isAssignment
          ? publishAssignment(state, membership, assignmentHeld, runContext)
          : isScenarioSet
            ? publishScenarioResults(
                state,
                membership,
                scenarioHeld,
                runContext,
              )
            : publishPreprocessing(
                state,
                membership,
                preprocessingHeld,
                runContext,
              )
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
      if ((groupOf(state, task)?.kind ?? 'stage') === 'stage') {
        state.issues = state.issues.filter(
          (issue) => issue.stageId !== stage.id,
        )
      }
      failRun(state, task, stage, message, inputRevisions, context)
      return applied(`"${task.label}" failed: ${message}`)
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
      'Replace the shared selection with buildings, grid elements, floors (ids <building>:F<n>) or zones (ids <building>:Z1 or <building>:F<n>:Z<k>, core first) of the published zoning, or one definition (archetype, schedule, measure, scenario, or asset) for the Properties panel, or one entry of the synthetic archetype, schedule, or measure library to show read-only. Unknown ids are rejected.',
    input: z.object({
      entityType: z.enum(SELECTABLE_ENTITIES),
      ids: z.array(z.string().min(1)).max(10_000),
    }),
    undoable: false,
    run(state, { entityType, ids }) {
      const unknown = ids.filter(
        (id) => !selectableExists(state, entityType, id),
      )
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
          : `Selected ${unique.length} ${SELECTION_NOUNS[entityType]}.`,
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
      'Validate a building edit and hold it as pending until applied or discarded: floors, or a manual archetype part (field construction, systems, spaceLoads, or externalLoads with a part id; null follows the rules again). Manual parts win over the rules.',
    input: z.object({
      entityId: z.string().min(1, 'Choose a building.'),
      field: z.enum(['floors', ...PART_KINDS]),
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

      const label = PART_LABELS[field].toLowerCase()
      if (!Object.values(state.parts).some((part) => part.kind === field)) {
        return rejected(
          `There are no ${label} parts yet. Run "Archetype modeling" or add one on the Archetypes page.`,
          'field',
        )
      }
      if (
        value !== null &&
        (typeof value !== 'string' || state.parts[value]?.kind !== field)
      ) {
        return rejected(
          `Choose an existing ${label} part, or follow the rules.`,
          'value',
        )
      }
      return setPendingEdit(state, building, field, value)
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
        } else if (edit.field !== 'floors' && edit.to === null) {
          // Back to the rules: the published rule part applies again.
          delete state.overrides[overrideKey(edit.entityId, edit.field)]
          ownerStageIds.add(STAGE_IDS.archetypes)
          continue
        } else if (
          edit.field !== 'floors' &&
          typeof edit.to === 'string' &&
          state.parts[edit.to]?.kind === edit.field
        ) {
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
    input: measureInputSchema,
    undoable: true,
    run(state, input, context) {
      const invalid = measureIssue(state, input, null)
      if (invalid) return invalid
      const id = allocateId(state, 'measure')
      state.measures[id] = {
        id,
        ...input,
        source: { kind: 'project', operationId: context.operationId },
      }
      upsertMeasureAsset(state, state.measures[id], context)
      touchScenarioInputs(state)
      return applied(`Created measure "${input.name}".`)
    },
  }),

  'measure.update': defineCommand({
    title: 'Change measure',
    description:
      'Change a measure by id: name, kind (its category), and savings. Scenario rules choose the buildings that take it. Scenario definitions and results become outdated. A kind change is rejected while a scenario rule assigns the measure, because each rule slot holds one category.',
    input: measureInputSchema.extend({
      id: z.string().min(1, 'Choose a measure.'),
    }),
    undoable: true,
    run(state, { id, ...input }, context) {
      const existing = state.measures[id]
      if (!existing) return rejected(`Unknown measure "${id}".`, 'id')
      const invalid = measureIssue(state, input, id)
      if (invalid) return invalid
      if (input.kind !== existing.kind) {
        const using = rulesUsingMeasure(state, id)
        if (using.length > 0) {
          const named = using
            .slice(0, 3)
            .map(
              (rule) =>
                `"${rule.name}" in "${state.scenarios[rule.scenarioId]?.name ?? rule.scenarioId}"`,
            )
            .join(', ')
          return rejected(
            `${named}${using.length > 3 ? ` and ${using.length - 3} more` : ''} assign${using.length === 1 ? 's' : ''} it as a ${kindNoun(existing.kind)} measure. Choose another measure in ${using.length === 1 ? 'that rule' : 'those rules'} first, or create a new measure of the other kind.`,
            'kind',
          )
        }
      }
      state.measures[id] = {
        ...existing,
        ...input,
        source: editedSource(existing.source, context.operationId),
      }
      upsertMeasureAsset(state, state.measures[id], context)
      touchScenarioInputs(state)
      return applied(`Changed measure "${input.name}".`)
    },
  }),

  'measure.addFromLibrary': defineCommand({
    title: 'Add measure from library',
    description:
      'Copy a measure from the synthetic measure library into the project, keeping its library provenance.',
    input: z.object({
      libraryId: z.string().min(1, 'Choose a library measure.'),
    }),
    undoable: true,
    run(state, { libraryId }, context) {
      const entry = MEASURE_LIBRARY.find(
        (candidate) => candidate.libraryId === libraryId,
      )
      if (!entry) {
        return rejected(`Unknown library measure "${libraryId}".`, 'libraryId')
      }
      if (!uniqueName(Object.values(state.measures), entry.name)) {
        return rejected(
          `A measure named "${entry.name}" already exists.`,
          'libraryId',
        )
      }
      const id = allocateId(state, 'measure')
      state.measures[id] = {
        id,
        name: entry.name,
        kind: entry.kind,
        savingsPercent: entry.savingsPercent,
        source: { kind: 'library', libraryId: entry.libraryId },
      }
      upsertMeasureAsset(state, state.measures[id], context)
      touchScenarioInputs(state)
      return applied(`Added "${entry.name}" from the synthetic library.`)
    },
  }),

  'scenario.create': defineCommand({
    title: 'Create scenario',
    description:
      'Create a scenario: a name, an adoption rate (the share of affected buildings that adopt, sampled when results are aggregated), an optional adoption seed (default 42), and whether the comparison set includes it (default yes). Optional measureIds (at most one of each kind) start the scenario with one rule without conditions, "All buildings", that assigns them; otherwise add rules with scenarioRule.save.',
    input: scenarioInputSchema.extend({
      measureIds: z.array(z.string().min(1)).default([]),
    }),
    undoable: true,
    run(state, input, context) {
      const invalid = scenarioIssue(state, input, null)
      if (invalid) return invalid
      const start = measuresByKind(state, input.measureIds)
      if (!start.ok) return start.outcome
      const id = allocateId(state, 'scenario')
      const scenario: Scenario = {
        id,
        name: input.name,
        ruleIds: [],
        adoptionPercent: input.adoptionPercent,
        adoptionSeed: input.adoptionSeed ?? DEFAULT_ADOPTION_SEED,
        included: input.included,
      }
      state.scenarios[id] = scenario
      if (input.measureIds.length > 0) {
        const ruleId = allocateId(state, 'scenarioRule')
        state.scenarioRules[ruleId] = {
          id: ruleId,
          scenarioId: id,
          name: 'All buildings',
          enabled: true,
          logic: 'all',
          conditions: [],
          measures: start.measures,
        }
        scenario.ruleIds.push(ruleId)
      }
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(
        `Created scenario "${input.name}"${scenario.ruleIds.length > 0 ? ' with the rule "All buildings"' : ' without rules; add a rule to choose buildings and measures'}.`,
      )
    },
  }),

  'scenario.update': defineCommand({
    title: 'Change scenario',
    description:
      'Change a scenario by id: name, adoption, adoption seed, and whether Scenario modeling includes it in the comparison set. Adoption and seed are applied when results are aggregated: a modeled scenario is re-aggregated at once without modeling again, and nothing becomes outdated. A new name or inclusion outdates Scenario definitions and results. Rules change with the scenarioRule commands.',
    input: scenarioInputSchema.extend({
      id: z.string().min(1, 'Choose a scenario.'),
      adoptionSeed: seedSchema,
      included: z.boolean(),
    }),
    undoable: true,
    run(state, { id, ...input }, context) {
      const existing = state.scenarios[id]
      if (!existing) return rejected(`Unknown scenario "${id}".`, 'id')
      const invalid = scenarioIssue(state, input, id)
      if (invalid) return invalid
      const definitions =
        existing.name !== input.name || existing.included !== input.included
      const sampling =
        existing.adoptionPercent !== input.adoptionPercent ||
        existing.adoptionSeed !== input.adoptionSeed
      if (!definitions && !sampling) {
        return rejected(`"${existing.name}" already has these values.`)
      }
      existing.name = input.name
      existing.included = input.included
      existing.adoptionPercent = input.adoptionPercent
      existing.adoptionSeed = input.adoptionSeed
      const reaggregated = sampling && reaggregateScenario(state, existing)
      upsertScenarioAsset(state, existing, context)
      // A result saved before versions cannot be re-aggregated; it is
      // outdated instead. Without a result, nothing depends on adoption.
      if (
        definitions ||
        (sampling && !reaggregated && state.results.scenarios[id] !== undefined)
      ) {
        touchScenarioInputs(state)
      }
      return applied(
        `Changed scenario "${input.name}"${reaggregated ? `; its published result was re-aggregated at ${input.adoptionPercent}% adoption, seed ${input.adoptionSeed}, without modeling again` : ''}.`,
      )
    },
  }),

  'scenario.setAdoption': defineCommand({
    title: 'Set scenario adoption',
    description:
      'Change a scenario adoption rate: the share of affected buildings that adopt their alternative version, sampled by the scenario seed when results are aggregated. A modeled scenario is re-aggregated at once, without modeling again, and no stage becomes outdated.',
    input: z.object({
      scenarioId: z.string().min(1, 'Choose a scenario.'),
      adoptionPercent: adoptionSchema,
    }),
    undoable: true,
    run(state, { scenarioId, adoptionPercent }, context) {
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
      const reaggregated = reaggregateScenario(state, scenario)
      upsertScenarioAsset(state, scenario, context)
      // A result saved before versions cannot be re-aggregated; it is outdated instead.
      if (!reaggregated && state.results.scenarios[scenarioId]) {
        touchScenarioInputs(state)
      }
      return applied(
        `Set adoption for "${scenario.name}" from ${previous}% to ${adoptionPercent}%${reaggregated ? '; its published result was re-aggregated without modeling again' : ''}.`,
      )
    },
  }),

  'scenarioRule.save': defineCommand({
    title: 'Save scenario rule',
    description:
      'Create a rule in a scenario, or change one by id: a name (unique in the scenario), enabled (left out: on for a new rule, unchanged for an existing one), logic (all, any, or none of the conditions), conditions of field (use, yearBuilt, floors, floorAreaM2, heightM, footprintAreaM2, name, or null for a blank one), operator (larger, smaller, equals, contains, notContains; numbers take larger, smaller, equals; use takes equals, notContains; text takes contains, notContains, equals), and value, and the measure of each category it assigns (envelope, heating, lighting, pv: a measure id of that kind, or null). No conditions match every building. A scenario’s rules are tried top first and each category takes the first enabled matching rule that sets it; a new rule goes to position (default 0, the top), and a changed rule moves only when position is given. Scenario definitions and results become outdated.',
    input: z.object({
      scenarioId: z.string().min(1, 'Choose a scenario.'),
      id: z.string().min(1).optional(),
      name: nameSchema,
      enabled: z.boolean().optional(),
      logic: z.enum(['all', 'any', 'none']),
      conditions: z
        .array(conditionSchema)
        .max(20, 'Use at most 20 conditions.'),
      measures: measureIdsSchema,
      position: z.number().int().min(0).optional(),
    }),
    undoable: true,
    run(state, input, context) {
      const scenario = state.scenarios[input.scenarioId]
      if (!scenario) {
        return rejected(`Unknown scenario "${input.scenarioId}".`, 'scenarioId')
      }
      const existing = input.id ? state.scenarioRules[input.id] : undefined
      if (input.id && (!existing || existing.scenarioId !== scenario.id)) {
        return rejected(`"${scenario.name}" has no rule "${input.id}".`, 'id')
      }
      const others = scenario.ruleIds
        .filter((ruleId) => ruleId !== input.id)
        .flatMap((ruleId) => {
          const rule = state.scenarioRules[ruleId]
          return rule ? [rule] : []
        })
      if (!uniqueName(others, input.name)) {
        return rejected(
          `"${scenario.name}" already has a rule named "${input.name}".`,
          'name',
        )
      }
      const issues = scenarioRuleIssues(state, input)
      if (issues.length > 0) return { status: 'rejected', issues }
      const id = existing?.id ?? allocateId(state, 'scenarioRule')
      state.scenarioRules[id] = {
        id,
        scenarioId: scenario.id,
        name: input.name,
        // Left out, a new rule is on and a changed rule keeps its switch.
        enabled: input.enabled ?? existing?.enabled ?? true,
        logic: input.logic,
        conditions: input.conditions.map((condition) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value.trim(),
        })),
        measures: { ...input.measures },
      }
      if (!existing) {
        const position = Math.min(input.position ?? 0, scenario.ruleIds.length)
        scenario.ruleIds.splice(position, 0, id)
      } else if (input.position !== undefined) {
        const rest = scenario.ruleIds.filter((ruleId) => ruleId !== id)
        rest.splice(Math.min(input.position, rest.length), 0, id)
        scenario.ruleIds = rest
      }
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(
        `${existing ? 'Updated' : 'Created'} rule "${input.name}" at position ${scenario.ruleIds.indexOf(id) + 1} of "${scenario.name}"; run Scenario modeling to model it.`,
      )
    },
  }),

  'scenarioRule.move': defineCommand({
    title: 'Move scenario rule',
    description:
      'Move a scenario rule to a position counted from the top of its scenario (0 is tried first). Scenario definitions and results become outdated.',
    input: z.object({
      ruleId: z.string().min(1, 'Choose a rule.'),
      position: z.number().int().min(0),
    }),
    undoable: true,
    run(state, { ruleId, position }, context) {
      const owner = ruleOwner(state, ruleId)
      if (!owner)
        return rejected(`Unknown scenario rule "${ruleId}".`, 'ruleId')
      const { rule, scenario, index } = owner
      if (position >= scenario.ruleIds.length) {
        return rejected(
          `Choose a position from 1 to ${scenario.ruleIds.length}.`,
          'position',
        )
      }
      if (position === index) {
        return rejected(`"${rule.name}" is already there.`, 'position')
      }
      scenario.ruleIds.splice(index, 1)
      scenario.ruleIds.splice(position, 0, ruleId)
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(
        `Moved "${rule.name}" to position ${position + 1} of ${scenario.ruleIds.length} in "${scenario.name}".`,
      )
    },
  }),

  'scenarioRule.setEnabled': defineCommand({
    title: 'Switch scenario rule',
    description:
      'Switch a scenario rule on or off; a rule that is off is skipped. Scenario definitions and results become outdated.',
    input: z.object({
      ruleId: z.string().min(1, 'Choose a rule.'),
      enabled: z.boolean(),
    }),
    undoable: true,
    run(state, { ruleId, enabled }, context) {
      const owner = ruleOwner(state, ruleId)
      if (!owner)
        return rejected(`Unknown scenario rule "${ruleId}".`, 'ruleId')
      const { rule, scenario } = owner
      if (rule.enabled === enabled) {
        return rejected(
          `"${rule.name}" is already ${enabled ? 'on' : 'off'}.`,
          'enabled',
        )
      }
      rule.enabled = enabled
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(
        `Switched "${rule.name}" in "${scenario.name}" ${enabled ? 'on' : 'off'}.`,
      )
    },
  }),

  'scenarioRule.duplicate': defineCommand({
    title: 'Duplicate scenario rule',
    description:
      'Copy a scenario rule just below it in the same scenario. Scenario definitions and results become outdated.',
    input: z.object({ ruleId: z.string().min(1, 'Choose a rule.') }),
    undoable: true,
    run(state, { ruleId }, context) {
      const owner = ruleOwner(state, ruleId)
      if (!owner)
        return rejected(`Unknown scenario rule "${ruleId}".`, 'ruleId')
      const { rule, scenario, index } = owner
      const name = freeRuleName(state, scenario, rule.name, true)
      const id = allocateId(state, 'scenarioRule')
      // The rule is a draft here, so it is copied field by field.
      state.scenarioRules[id] = {
        id,
        scenarioId: scenario.id,
        name,
        enabled: rule.enabled,
        logic: rule.logic,
        conditions: rule.conditions.map((condition) => ({ ...condition })),
        measures: { ...rule.measures },
      }
      scenario.ruleIds.splice(index + 1, 0, id)
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(`Duplicated "${rule.name}" as "${name}".`)
    },
  }),

  'scenarioRule.remove': defineCommand({
    title: 'Remove scenario rule',
    description:
      'Remove a scenario rule. Published results keep the measures it assigned until Scenario modeling runs again; undo brings the rule back.',
    input: z.object({ ruleId: z.string().min(1, 'Choose a rule.') }),
    undoable: true,
    run(state, { ruleId }, context) {
      const owner = ruleOwner(state, ruleId)
      if (!owner)
        return rejected(`Unknown scenario rule "${ruleId}".`, 'ruleId')
      const { rule, scenario } = owner
      delete state.scenarioRules[ruleId]
      scenario.ruleIds = scenario.ruleIds.filter((id) => id !== ruleId)
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
      return applied(`Removed "${rule.name}" from "${scenario.name}".`)
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
