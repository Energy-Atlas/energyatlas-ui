import {
  scheduleStats,
  weekdayHours,
} from '../../../domain/archetypes/assignment.ts'
import type {
  ResultSet,
  StageState,
  WorkbenchState,
} from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import { csvCommentLine, csvField, fileSlug } from '../../csv.ts'

// Results (jobs rollout plan, slice 8): read-only views over published
// results. Held outputs, calibrated variants that are not adopted, and drafts
// never appear here. Every export names the result, run, and currentness it
// was made from, and its totals equal the summary's.

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export type ResultEntry = {
  /** 'baseline' or a scenario ID. */
  id: string
  label: string
  result: ResultSet
  /** The stage that published it. */
  stageId: string
  stageName: string
  /** Published with the current inputs, or outdated by later changes. */
  current: boolean
  /** How the result relates to its stage now, in words for the page and the export. */
  currentness: string
  /** When the run that produced it finished, if known. */
  publishedAt: string | null
  /** For a scenario, its baseline to compare against. */
  compareTo: ResultSet | null
  /** How the working baseline came to be, for the baseline entry. */
  note: string | null
}

/** When the run that produced a result finished: its succeeded job's last update. */
function finishedAt(state: WorkbenchState, runId: string): string | null {
  const task = Object.values(state.tasks).find(
    (candidate) =>
      candidate.runId === runId && candidate.status === 'succeeded',
  )
  return task?.updatedAt ?? null
}

/** Currentness in words, from the publishing stage's derived state. */
function describeCurrentness(stageState: StageState | undefined): string {
  switch (stageState) {
    case 'executed':
      return 'current'
    case 'running':
      return 'a newer run is in progress; this is the last published result'
    case 'failed':
      return 'a newer run failed; this is the last published result'
    default:
      return 'outdated; inputs changed after this run'
  }
}

/** Every published result set: the working baseline, then each modeled scenario. */
export function listResults(
  state: WorkbenchState,
  states: Record<string, StageState>,
): ResultEntry[] {
  const baseline = state.results.baseline
  if (!baseline) return []
  const baselineStage = state.workflow.stages[STAGE_IDS.baseline]
  const modelingStage = state.workflow.stages[STAGE_IDS.scenarioModeling]
  const adopted = state.calibration.adoptedVariantId
    ? state.calibration.variants[state.calibration.adoptedVariantId]
    : null
  const entries: ResultEntry[] = [
    {
      id: 'baseline',
      label: adopted ? `Baseline (${adopted.label})` : 'Baseline',
      result: baseline,
      stageId: STAGE_IDS.baseline,
      stageName: adopted
        ? 'Calibration fit, adopted as the working baseline'
        : (baselineStage?.name ?? 'Baseline model setup'),
      current: states[STAGE_IDS.baseline] === 'executed',
      currentness: describeCurrentness(states[STAGE_IDS.baseline]),
      publishedAt: adopted
        ? adopted.createdAt
        : finishedAt(state, baseline.runId),
      compareTo: null,
      note: adopted
        ? `Calibrated variant adopted as the working baseline (factor ${adopted.factor}).`
        : 'Modeled baseline.',
    },
  ]
  for (const scenario of Object.values(state.scenarios)) {
    const result = state.results.scenarios[scenario.id]
    if (!result) continue
    entries.push({
      id: scenario.id,
      label: scenario.name,
      result,
      stageId: STAGE_IDS.scenarioModeling,
      stageName: modelingStage?.name ?? 'Scenario modeling',
      current: states[STAGE_IDS.scenarioModeling] === 'executed',
      currentness: describeCurrentness(states[STAGE_IDS.scenarioModeling]),
      publishedAt: finishedAt(state, result.runId),
      compareTo: baseline,
      note: `${scenario.measureIds.length} measure(s) at ${scenario.adoptionPercent}% adoption.`,
    })
  }
  return entries
}

export type BuildingRow = {
  id: string
  name: string
  use: string
  archetype: string
  floorAreaM2: number | null
  annualKwh: number
  euiKwhPerM2: number | null
  /** Saving against the baseline, for scenarios. */
  savingKwh: number | null
}

/** Buildings in a result, highest demand first. */
export function buildingRows(
  state: WorkbenchState,
  entry: ResultEntry,
): BuildingRow[] {
  return Object.entries(entry.result.byBuildingKwh)
    .map(([id, annualKwh]): BuildingRow => {
      const building = state.buildings[id]
      const area = building?.floorAreaM2 ?? null
      const archetype = building?.archetypeId
        ? state.archetypes[building.archetypeId]
        : undefined
      const baselineKwh = entry.compareTo?.byBuildingKwh[id]
      return {
        id,
        name: building?.name ?? id,
        use: building?.use ?? 'unknown',
        archetype: archetype?.name ?? 'none',
        floorAreaM2: area,
        annualKwh,
        euiKwhPerM2:
          area && area > 0 ? Math.round((annualKwh / area) * 10) / 10 : null,
        savingKwh:
          baselineKwh === undefined
            ? null
            : Math.round(baselineKwh - annualKwh),
      }
    })
    .sort((a, b) => b.annualKwh - a.annualKwh || (a.id < b.id ? -1 : 1))
}

/** Monthly kWh for the district, or one building's share of the district shape. */
export function monthlySeries(
  result: ResultSet,
  buildingId: string | null,
): number[] {
  if (!buildingId) return result.monthlyKwh
  const share =
    result.totalKwh > 0
      ? (result.byBuildingKwh[buildingId] ?? 0) / result.totalKwh
      : 0
  return result.monthlyKwh.map((value) => Math.round(value * share))
}

export type HourlyProfile = {
  /** Average weekday demand per hour in kW. */
  kw: number[]
  /** Where the shape comes from. */
  basis: string
}

/**
 * A typical weekday profile in kW for one building: its archetype schedule's
 * weekday shape scaled to its annual demand. Hourly values are kept only as
 * this typical day; daily resolution is not offered.
 */
export function hourlyProfile(
  state: WorkbenchState,
  result: ResultSet,
  buildingId: string,
): HourlyProfile {
  const annualKwh = result.byBuildingKwh[buildingId] ?? 0
  const building = state.buildings[buildingId]
  const archetype = building?.archetypeId
    ? state.archetypes[building.archetypeId]
    : undefined
  const schedule = archetype?.scheduleId
    ? state.schedules[archetype.scheduleId]
    : undefined
  if (!schedule) {
    return {
      kw: Array.from(
        { length: 24 },
        () => Math.round((annualKwh / 8760) * 10) / 10,
      ),
      basis: 'Flat: the building has no archetype schedule.',
    }
  }
  const { annualHours } = scheduleStats(schedule)
  if (!(annualHours > 0)) {
    return {
      kw: Array.from(
        { length: 24 },
        () => Math.round((annualKwh / 8760) * 10) / 10,
      ),
      basis: `Flat: the schedule "${schedule.name}" has no hours above zero.`,
    }
  }
  const peak = annualKwh / annualHours
  return {
    kw: weekdayHours(schedule).map(
      (fraction) => Math.round(fraction * peak * 10) / 10,
    ),
    basis: `Weekday (Monday) shape of the schedule "${schedule.name}", scaled to the annual demand.`,
  }
}

/**
 * A CSV of one published result: identifying comment lines, one row per
 * building with units in the column names, and a total row equal to the
 * result's summary total.
 */
export function resultCsv(
  state: WorkbenchState,
  entry: ResultEntry,
  exportedAt: string,
): string {
  const rows = buildingRows(state, entry)
  const scenario = entry.compareTo !== null
  // Header values are one line each: control characters become spaces.
  const line = csvCommentLine
  const lines = [
    `# EnergyAtlas UI demo export (synthetic results)`,
    line(`# result: ${entry.label}`),
    line(`# run: ${entry.result.runId}`),
    line(
      `# published by: ${entry.stageName}${entry.publishedAt ? ` at ${entry.publishedAt}` : ''}`,
    ),
    line(`# currentness: ${entry.currentness}`),
    ...(entry.compareTo
      ? [line(`# compared to baseline run: ${entry.compareTo.runId}`)]
      : []),
    `# building attributes: current project values; demand: this run`,
    line(`# project: ${state.project.name}`),
    line(`# exported at: ${exportedAt}`),
    [
      'building_id',
      'name',
      'use',
      'archetype',
      'floor_area[m2]',
      'annual_demand[kWh]',
      'eui[kWh/m2]',
      ...(scenario ? ['saving_vs_baseline[kWh]'] : []),
    ].join(','),
    ...rows.map((row) =>
      [
        csvField(row.id),
        csvField(row.name),
        csvField(row.use),
        csvField(row.archetype),
        csvField(row.floorAreaM2),
        csvField(row.annualKwh),
        csvField(row.euiKwhPerM2),
        ...(scenario ? [csvField(row.savingKwh)] : []),
      ].join(','),
    ),
    [
      'total',
      '',
      '',
      '',
      '',
      csvField(entry.result.totalKwh),
      '',
      ...(scenario && entry.compareTo
        ? [
            csvField(
              Math.round(entry.compareTo.totalKwh - entry.result.totalKwh),
            ),
          ]
        : []),
    ].join(','),
  ]
  return `${lines.join('\n')}\n`
}

/** A file name naming the result and run. */
export function csvFileName(entry: ResultEntry): string {
  return `energyatlas-${fileSlug(entry.label, 'result')}-${entry.result.runId}.csv`
}
