import { z } from 'zod'
import { GROUP, upsertAsset } from './assets.ts'
import { matchArchetype, missingDefaults } from './archetypes/assignment.ts'
import { ARCHETYPE_LIBRARY, SCHEDULE_LIBRARY } from './archetypes/library.ts'
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
import { compositionConflict } from './scenarios/comparison.ts'
import { MEASURE_LIBRARY } from './scenarios/library.ts'
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
  computeScenarioResult,
  preprocessBuilding,
  publishAssignment,
  publishPreprocessing,
  publishScenarioResults,
  validateAssignment,
  validateScenarioResults,
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
  HeldPreprocessingOutput,
  RunGroup,
  Scenario,
  StageRecord,
  Task,
  WorkbenchState,
} from './types.ts'
import { SELECTABLE_ENTITIES, type SelectableEntity } from './types.ts'
import { selectableCollection } from './selection.ts'
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
  if (stageId === STAGE_IDS.scenarioModeling) {
    return Object.values(state.scenarios).some((scenario) => scenario.included)
      ? null
      : 'Include at least one scenario in the comparison set. Open Measures and scenarios to include one.'
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
  for (const archetype of Object.values(state.archetypes)) {
    if (
      archetype.scheduleId !== null &&
      !state.schedules[archetype.scheduleId]
    ) {
      return `"${archetype.name}" uses a schedule that no longer exists. Choose another schedule first.`
    }
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
  'kind' in output && output.kind === 'scenarioResult'

/** One building's held item output for an item stage, or why it has none. */
function stageItem(
  state: WorkbenchState,
  stageId: string,
  buildingId: string,
): { output: HeldOutput | null; missing: string | null } {
  if (stageId === STAGE_IDS.scenarioModeling) {
    const scenario = state.scenarios[buildingId]
    const result = scenario
      ? computeScenarioResult(state, scenario, { runId: 'held' })
      : null
    return result
      ? { output: { kind: 'scenarioResult', result }, missing: null }
      : {
          output: null,
          missing: scenario
            ? 'There are no baseline results to model against.'
            : 'The scenario no longer exists.',
        }
  }
  const building = state.buildings[buildingId]
  if (!building) {
    return { output: null, missing: 'The building no longer exists.' }
  }
  if (stageId === STAGE_IDS.archetypes) {
    return {
      output: {
        kind: 'assignment',
        archetypeId: matchArchetype(state.archetypes, building),
      },
      missing: null,
    }
  }
  const output = preprocessBuilding(building)
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

/** Bumps the inputs Archetype modeling owns, so assignments become outdated. */
function touchArchetypeInputs(state: WorkbenchState) {
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  if (stage) stage.editRevision = nextRevision(state)
}

/**
 * Copies a library archetype and the schedule it uses into the project. A
 * copied schedule whose name is taken gets a "(library)" suffix, so names
 * stay unique and both stay editable.
 */
function addLibraryArchetype(state: WorkbenchState, entry: Archetype) {
  state.archetypes[entry.id] = structuredClone(entry)
  const schedule = SCHEDULE_LIBRARY.find((item) => item.id === entry.scheduleId)
  if (schedule && !state.schedules[schedule.id]) {
    const copy = structuredClone(schedule)
    if (!uniqueName(Object.values(state.schedules), copy.name)) {
      copy.name = `${copy.name} (library)`
    }
    state.schedules[copy.id] = copy
  }
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

const measureInputSchema = z.object({
  name: nameSchema,
  kind: z.enum(['envelope', 'heating', 'lighting', 'pv']),
  savingsPercent: z
    .number({ error: 'Enter savings as a number.' })
    .min(0, 'Savings cannot be negative.')
    .max(60, 'Savings must be at most 60%.'),
  appliesTo: z.enum([...buildingUseSchema.options, 'all']),
})

const scenarioInputSchema = z.object({
  name: nameSchema,
  measureIds: z.array(z.string().min(1)).min(1, 'Choose at least one measure.'),
  adoptionPercent: z
    .number({ error: 'Enter adoption as a number.' })
    .min(0, 'Adoption cannot be negative.')
    .max(100, 'Adoption must be at most 100%.'),
  included: z.boolean().default(true),
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
  input: z.output<typeof scenarioInputSchema>,
  id: string | null,
): CommandOutcome | null {
  const others = Object.values(state.scenarios).filter(
    (scenario) => scenario.id !== id,
  )
  if (!uniqueName(others, input.name)) {
    return rejected(`A scenario named "${input.name}" already exists.`, 'name')
  }
  const unknown = input.measureIds.filter(
    (measureId) => !state.measures[measureId],
  )
  if (unknown.length > 0) {
    return rejected(`Unknown measure(s): ${unknown.join(', ')}.`, 'measureIds')
  }
  const conflict = compositionConflict(state.measures, input.measureIds)
  return conflict ? rejected(conflict, 'measureIds') : null
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
        ? `PV from estimated yield; applies to ${measure.appliesTo}`
        : `${measure.kind}, ${measure.savingsPercent}% savings; applies to ${measure.appliesTo}`,
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
    summary: `${scenario.measureIds.length} measure(s) at ${scenario.adoptionPercent}% adoption${scenario.included ? '' : '; left out of the comparison'}`,
    entityIds: [scenario.id, ...scenario.measureIds],
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
        // A first assignment adds the default library archetypes the project lacks.
        for (const entry of missingDefaults(state)) {
          addLibraryArchetype(state, entry)
        }
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

  'archetype.save': defineCommand({
    title: 'Save archetype',
    description:
      'Create an archetype, or change one by id: name, building use, optional construction-year range, energy use intensity (kWh/m² per year), and an optional schedule. Archetype modeling becomes outdated so buildings are reassigned with the new definitions.',
    input: z.object({
      id: z.string().min(1).optional(),
      name: nameSchema,
      use: buildingUseSchema,
      yearFrom: yearSchema,
      yearTo: yearSchema,
      euiKwhPerM2: z
        .number({ error: 'Enter the energy use intensity as a number.' })
        .min(20, 'Energy use intensity must be at least 20 kWh/m².')
        .max(600, 'Energy use intensity must be at most 600 kWh/m².'),
      scheduleId: z.string().min(1).nullable(),
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
      if (input.scheduleId !== null && !state.schedules[input.scheduleId]) {
        return rejected('Choose an existing schedule or none.', 'scheduleId')
      }
      const id = existing?.id ?? allocateId(state, 'archetype')
      state.archetypes[id] = {
        id,
        name: input.name,
        use: input.use,
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        euiKwhPerM2: input.euiKwhPerM2,
        scheduleId: input.scheduleId,
        source: editedSource(existing?.source ?? null, context.operationId),
      }
      touchArchetypeInputs(state)
      return applied(
        existing
          ? `Updated archetype "${input.name}"; run Archetype modeling to reassign buildings.`
          : `Created archetype "${input.name}"; run Archetype modeling to assign it.`,
      )
    },
  }),

  'archetype.addFromLibrary': defineCommand({
    title: 'Add archetype from library',
    description:
      'Copy an archetype from the synthetic library into the project, with its schedule. The copy keeps its library provenance and can then be edited.',
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
      touchArchetypeInputs(state)
      return applied(`Added "${entry.name}" from the synthetic library.`)
    },
  }),

  'schedule.save': defineCommand({
    title: 'Save schedule',
    description:
      'Create a schedule, or change one by id: a name, one to seven day types (such as Weekday, Saturday, Sunday) each with 24 hourly fractions from 0 to 1, and the day type each day of the week uses, Monday first. Archetypes using it become outdated.',
    input: z.object({
      id: z.string().min(1).optional(),
      name: nameSchema,
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
      // Only archetypes that use the schedule are affected.
      if (
        Object.values(state.archetypes).some(
          (archetype) => archetype.scheduleId === id,
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
      'Replace the shared selection with buildings, grid elements, or one definition (archetype, schedule, measure, scenario, or asset) for the Properties panel, or one entry of the synthetic archetype, schedule, or measure library to show read-only. Unknown ids are rejected.',
    input: z.object({
      entityType: z.enum(SELECTABLE_ENTITIES),
      ids: z.array(z.string().min(1)).max(10_000),
    }),
    undoable: false,
    run(state, { entityType, ids }) {
      const collection = selectableCollection(state, entityType)
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
      'Change a measure by id: name, kind, savings, and the building use it applies to. Scenario definitions and results become outdated. A change that would give a scenario two measures of one kind is rejected.',
    input: measureInputSchema.extend({
      id: z.string().min(1, 'Choose a measure.'),
    }),
    undoable: true,
    run(state, { id, ...input }, context) {
      const existing = state.measures[id]
      if (!existing) return rejected(`Unknown measure "${id}".`, 'id')
      const invalid = measureIssue(state, input, id)
      if (invalid) return invalid
      const next = { ...state.measures, [id]: { ...existing, ...input } }
      for (const scenario of Object.values(state.scenarios)) {
        if (!scenario.measureIds.includes(id)) continue
        const conflict = compositionConflict(next, scenario.measureIds)
        if (conflict) {
          return rejected(`In "${scenario.name}": ${conflict}`, 'kind')
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
        appliesTo: entry.appliesTo,
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
      'Create a scenario from existing measures (at most one of each kind) and an adoption rate. New scenarios are included in the comparison set.',
    input: scenarioInputSchema,
    undoable: true,
    run(state, input, context) {
      const invalid = scenarioIssue(state, input, null)
      if (invalid) return invalid
      const id = allocateId(state, 'scenario')
      state.scenarios[id] = {
        id,
        name: input.name,
        measureIds: [...new Set(input.measureIds)],
        adoptionPercent: input.adoptionPercent,
        included: input.included,
      }
      upsertScenarioAsset(state, state.scenarios[id], context)
      touchScenarioInputs(state)
      return applied(`Created scenario "${input.name}".`)
    },
  }),

  'scenario.update': defineCommand({
    title: 'Change scenario',
    description:
      'Change a scenario by id: name, measures (at most one of each kind), adoption, and whether Scenario modeling includes it in the comparison set. Scenario definitions and results become outdated.',
    input: scenarioInputSchema.extend({
      id: z.string().min(1, 'Choose a scenario.'),
      included: z.boolean(),
    }),
    undoable: true,
    run(state, { id, ...input }, context) {
      const existing = state.scenarios[id]
      if (!existing) return rejected(`Unknown scenario "${id}".`, 'id')
      const invalid = scenarioIssue(state, input, id)
      if (invalid) return invalid
      state.scenarios[id] = {
        id,
        name: input.name,
        measureIds: [...new Set(input.measureIds)],
        adoptionPercent: input.adoptionPercent,
        included: input.included,
      }
      upsertScenarioAsset(state, state.scenarios[id], context)
      touchScenarioInputs(state)
      return applied(`Changed scenario "${input.name}".`)
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
      upsertScenarioAsset(state, scenario, context)
      touchScenarioInputs(state)
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
