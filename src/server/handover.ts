import { z } from 'zod'
import type {
  CommandSource,
  StageState,
  WorkbenchState,
} from '../domain/types.ts'
import { STAGE_IDS, deriveStageStates } from '../domain/workflow.ts'
import type { SavedView } from './projectCatalog.ts'
import { projectStateSchema, savedViewSchema } from './projectSchema.ts'

// The handover package of decision 0032 (stage 5): a frozen copy of a project
// for the view-only viewer page. It holds the published model and its current
// published results, the views and layouts saved with the project, and
// provenance, and leaves out working data: held job outputs, drafts, and job
// logs. Result versions are deferred, so it carries the current results only.

export const HANDOVER_FORMAT = 'energyatlas-ui.handover'
/** The package format this version writes and reads; later formats are refused. */
export const HANDOVER_VERSION = 1
/**
 * Package files larger than this are refused: the viewer checks a file's size
 * before reading it, and the server checks the text it is sent.
 */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024

export type HandoverStage = {
  id: string
  name: string
  state: StageState
  /** When the stage last finished a run, or null when it never ran. */
  finishedAt: string | null
  runId: string | null
}

export type HandoverProvenance = {
  projectId: string
  projectName: string
  /** When the modeller last saved the project in its browser; null if never. */
  savedAt: string | null
  /** The model had changes the modeller had not saved when it was handed over. */
  unsavedChanges: boolean
  handedOverBy: CommandSource
  /** Each stage's state at handover, in workflow order. */
  stages: HandoverStage[]
  /** The published results the package carries, with the runs that produced them. */
  results: { id: string; label: string; runId: string }[]
  /** What the handover left out, by count. */
  excluded: { heldOutputs: number; jobLogLines: number; drafts: number }
}

export type HandoverPackage = {
  format: typeof HANDOVER_FORMAT
  version: typeof HANDOVER_VERSION
  id: string
  /** The project name, which the viewer shows as the package's title. */
  name: string
  createdAt: string
  provenance: HandoverProvenance
  model: WorkbenchState
  /** Table arrangements, map layers, and project layouts (decisions 0029, 0031, 0032). */
  view: SavedView
}

/** Why a project cannot be handed over now, or null. */
export function handoverBlocker(state: WorkbenchState): string | null {
  const active = state.taskIds.filter((id) => {
    const status = state.tasks[id]?.status
    return status === 'queued' || status === 'running'
  })
  if (active.length > 0) {
    return `${active.length === 1 ? 'A job is' : `${active.length} jobs are`} still running. A handover freezes published results only; wait for ${active.length === 1 ? 'it' : 'them'} to finish or cancel ${active.length === 1 ? 'it' : 'them'} first.`
  }
  if (state.buildingIds.length === 0) {
    return 'The project has no buildings yet. Run Location setup / footprint capturing before handing it over.'
  }
  return null
}

/**
 * The model as a handover keeps it: no drafts, selection, or focus, no held
 * job outputs, and no job logs. Everything published stays.
 */
export function freezeModel(state: WorkbenchState): {
  model: WorkbenchState
  excluded: Omit<HandoverProvenance['excluded'], 'drafts'>
} {
  const model = structuredClone(state)
  let heldOutputs = 0
  let jobLogLines = 0
  for (const task of Object.values(model.tasks)) {
    jobLogLines += task.log.length
    task.log = []
  }
  for (const group of Object.values(model.runGroups)) {
    heldOutputs += Object.keys(group.held).length
    group.held = {}
    // A run left open (a partial failure awaiting retry) cannot continue in
    // a frozen package; its published results, if any, stay.
    if (group.status === 'open') {
      group.status = 'cancelled'
      group.statusReason =
        'Left open in the modeller; a handover keeps published results only.'
    }
  }
  model.pendingEdits = {}
  model.selection = { entityType: null, ids: [] }
  model.workflow = { ...model.workflow, currentStageId: null }
  return { model, excluded: { heldOutputs, jobLogLines } }
}

function stagesOf(model: WorkbenchState): HandoverStage[] {
  const states = deriveStageStates(model.workflow, model.tasks)
  return model.workflow.stageIds.flatMap((id) => {
    const stage = model.workflow.stages[id]
    if (!stage) return []
    return [
      {
        id,
        name: stage.name,
        state: states[id] ?? 'future',
        finishedAt: stage.lastRun?.finishedAt ?? null,
        runId: stage.lastRun?.runId ?? null,
      },
    ]
  })
}

function resultsOf(model: WorkbenchState): HandoverProvenance['results'] {
  const { baseline, scenarios } = model.results
  return [
    ...(baseline
      ? [{ id: 'baseline', label: baseline.label, runId: baseline.runId }]
      : []),
    ...Object.entries(scenarios).map(([id, result]) => ({
      id,
      label: result.label,
      runId: result.runId,
    })),
  ]
}

/** Freezes the server's project into a handover package. */
export function buildHandoverPackage(options: {
  state: WorkbenchState
  view: SavedView | null
  savedAt: string | null
  unsavedChanges: boolean
  /** Unsent drafts the modeller had, which the package leaves out. */
  drafts: number
  source: CommandSource
  now: Date
  id?: string
}): HandoverPackage {
  const { model, excluded } = freezeModel(options.state)
  return {
    format: HANDOVER_FORMAT,
    version: HANDOVER_VERSION,
    id: options.id ?? `handover:${crypto.randomUUID()}`,
    name: model.project.name,
    createdAt: options.now.toISOString(),
    provenance: {
      projectId: model.project.id,
      projectName: model.project.name,
      savedAt: options.savedAt,
      unsavedChanges: options.unsavedChanges,
      handedOverBy: options.source,
      stages: stagesOf(model),
      results: resultsOf(model),
      excluded: { ...excluded, drafts: options.drafts },
    },
    model,
    view: options.view ?? { tables: {} },
  }
}

const RESULT_STAGES = [
  STAGE_IDS.baseline,
  STAGE_IDS.scenarioModeling,
  STAGE_IDS.gridModeling,
]

/**
 * What a viewer should know before trusting the package's results: none
 * published, or results outdated or failed relative to the model.
 */
export function packageWarnings(pkg: Pick<HandoverPackage, 'model'>): string[] {
  const { model } = pkg
  const warnings: string[] = []
  if (!model.results.baseline) {
    warnings.push(
      'This package has no published results: Baseline model setup had not published a baseline when it was handed over.',
    )
  }
  const states = deriveStageStates(model.workflow, model.tasks)
  const name = (id: string) => model.workflow.stages[id]?.name ?? id
  const outdated = RESULT_STAGES.filter((id) => states[id] === 'stale')
  if (outdated.length > 0) {
    warnings.push(
      `Results are outdated relative to the model: ${outdated.map((id) => `"${name(id)}"`).join(', ')} changed after ${outdated.length === 1 ? 'its' : 'their'} last run, so the results shown are from before those changes.`,
    )
  }
  const failed = RESULT_STAGES.filter((id) => states[id] === 'failed')
  if (failed.length > 0) {
    warnings.push(
      `The last run of ${failed.map((id) => `"${name(id)}"`).join(', ')} failed before the handover; any results shown are from an earlier run.`,
    )
  }
  return warnings
}

export type PackageSummary = {
  id: string
  name: string
  createdAt: string
  projectId: string
  buildings: number
  results: number
  warnings: string[]
  provenance: HandoverProvenance
  /** Characters the package takes in browser storage. */
  bytes: number
}

export function summarizePackage(pkg: HandoverPackage): PackageSummary {
  return {
    id: pkg.id,
    name: pkg.name,
    createdAt: pkg.createdAt,
    projectId: pkg.provenance.projectId,
    buildings: pkg.model.buildingIds.length,
    results: pkg.provenance.results.length,
    warnings: packageWarnings(pkg),
    provenance: pkg.provenance,
    bytes: JSON.stringify(pkg).length,
  }
}

export type PackageRead =
  | { ok: true; package: HandoverPackage }
  | {
      ok: false
      /** corrupt: not JSON; foreign: not a package; newer: a later format; invalid: damaged. */
      code: 'corrupt' | 'foreign' | 'newer' | 'invalid'
      message: string
    }

const stageState = z.enum([
  'future',
  'ready',
  'running',
  'executed',
  'stale',
  'failed',
  'blocked',
  'skipped',
  'unavailable',
])

const provenanceSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string(),
  savedAt: z.string().nullable(),
  unsavedChanges: z.boolean(),
  handedOverBy: z.enum(['manual', 'agent', 'system']),
  stages: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      state: stageState,
      finishedAt: z.string().nullable(),
      runId: z.string().nullable(),
    }),
  ),
  results: z.array(
    z.object({ id: z.string().min(1), label: z.string(), runId: z.string() }),
  ),
  excluded: z.object({
    heldOutputs: z.number().int().min(0),
    jobLogLines: z.number().int().min(0),
    drafts: z.number().int().min(0),
  }),
})

const packageSchema = z.object({
  format: z.literal(HANDOVER_FORMAT),
  version: z.literal(HANDOVER_VERSION),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string().min(1),
  provenance: provenanceSchema,
  model: projectStateSchema,
  view: savedViewSchema,
})

const DAMAGED = 'This handover package is damaged or incomplete'

/** A handover package from a parsed value, validated like a saved project. */
export function readHandoverPackage(value: unknown): PackageRead {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { format?: unknown }).format !== HANDOVER_FORMAT
  ) {
    return {
      ok: false,
      code: 'foreign',
      message:
        'This file is not an EnergyAtlas handover package. Choose a file saved with Hand over > Download package.',
    }
  }
  const version = (value as { version?: unknown }).version
  if (typeof version === 'number' && version > HANDOVER_VERSION) {
    return {
      ok: false,
      code: 'newer',
      message: `This package was made by a newer version of EnergyAtlas (package format ${version}); this viewer reads format ${HANDOVER_VERSION}. Open it with a newer viewer.`,
    }
  }
  if (version !== HANDOVER_VERSION) {
    return {
      ok: false,
      code: 'invalid',
      message: `${DAMAGED}: its format version is missing or unknown.`,
    }
  }
  const parsed = packageSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : ''
    return {
      ok: false,
      code: 'invalid',
      message: `${DAMAGED}${where}: ${issue?.message ?? 'it does not match the package format.'}`,
    }
  }
  const parsedPackage: HandoverPackage = parsed.data
  // Results and stage states are read from the model, never trusted from the
  // file's provenance, so a tampered file cannot claim what the model lacks.
  const pkg: HandoverPackage = {
    ...parsedPackage,
    provenance: {
      ...parsedPackage.provenance,
      stages: stagesOf(parsedPackage.model),
      results: resultsOf(parsedPackage.model),
    },
  }
  if (pkg.model.project.id !== pkg.provenance.projectId) {
    return {
      ok: false,
      code: 'invalid',
      message: `${DAMAGED}: its provenance names another project.`,
    }
  }
  const working =
    Object.keys(pkg.model.pendingEdits).length > 0 ||
    Object.values(pkg.model.runGroups).some(
      (group) => Object.keys(group.held).length > 0,
    ) ||
    Object.values(pkg.model.tasks).some((task) => task.log.length > 0)
  if (working) {
    return {
      ok: false,
      code: 'invalid',
      message: `${DAMAGED}: it contains working data a handover leaves out (drafts, held job outputs, or job logs).`,
    }
  }
  // Queued or running jobs and open runs would run and publish in a viewer.
  const active =
    Object.values(pkg.model.tasks).some(
      (task) => task.status === 'queued' || task.status === 'running',
    ) ||
    Object.values(pkg.model.runGroups).some((group) => group.status === 'open')
  if (active) {
    return {
      ok: false,
      code: 'invalid',
      message: `${DAMAGED}: it contains queued or running jobs or open runs, which a handover never holds.`,
    }
  }
  return { ok: true, package: pkg }
}

/** A handover package from a file's text. */
export function readHandoverText(text: string): PackageRead {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      ok: false,
      code: 'corrupt',
      message:
        'This file could not be read as a handover package: it is not valid JSON. It may be truncated or not a package file.',
    }
  }
  return readHandoverPackage(value)
}

/** The file name a package downloads as. */
export function packageFileName(pkg: HandoverPackage): string {
  const slug =
    pkg.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  return `${slug}-${pkg.createdAt.slice(0, 10)}.handover.json`
}
