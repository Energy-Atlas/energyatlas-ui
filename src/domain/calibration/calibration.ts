import type { ValidationIssue } from '../commands.ts'
import { round, unitRandom } from '../simulation.ts'
import type {
  CalibrationInput,
  FitMetrics,
  MeterUnit,
  ResultSet,
  WorkbenchState,
} from '../types.ts'
import { STAGE_IDS } from '../workflow.ts'

// Calibration (jobs rollout plan, slice 7; decision D10). Synthetic monthly
// meter series stand in for live meters. The fit is one coupled whole-district
// factor, run as one job; it is a stand-in, not a real calibration algorithm.
// A fit publishes a separate calibrated variant; only an explicit Adopt makes
// it the working baseline.

export type MeterRow = { month: string; value: number | null }

export type MeterSeries = {
  id: string
  label: string
  description: string
  /** The unit the export states; people confirm or correct it before fitting. */
  statedUnit: string
  rows: MeterRow[]
}

const MONTHS = [
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

/** A synthetic "measured" year: a seasonal shape near 9.6 GWh a month with noise, independent of any model. */
function measuredYear(year: number, scale: number): MeterRow[] {
  return MONTHS.map((month, index) => {
    const seasonal = 1 + 0.22 * Math.cos(((index - 0.5) / 12) * 2 * Math.PI)
    const noise = 0.94 + 0.12 * unitRandom(index + year, 17)
    return {
      month: `${year}-${String(index + 1).padStart(2, '0')} (${month})`,
      value: round(9_600_000 * seasonal * noise * scale),
    }
  })
}

export const METER_SERIES: readonly MeterSeries[] = [
  {
    id: 'meter:district-2025',
    label: 'District utility meters, 2025',
    description:
      'Twelve monthly totals for the whole district in kWh (synthetic; no real meter data).',
    statedUnit: 'kWh',
    rows: measuredYear(2025, 1),
  },
  {
    id: 'meter:district-2025-mwh',
    label: 'District export in MWh, 2025',
    description:
      'The same kind of year exported in MWh; choose MWh so values are converted.',
    statedUnit: 'MWh',
    rows: measuredYear(2025, 1).map((row) => ({
      ...row,
      value: row.value === null ? null : round(row.value / 1000, 1),
    })),
  },
  {
    id: 'meter:partial-2026',
    label: 'Partial year, 2026',
    description:
      'Only January to September with one missing month, so it cannot be fitted to a year.',
    statedUnit: 'kWh',
    rows: measuredYear(2026, 1)
      .slice(0, 9)
      .map((row, index) => (index === 4 ? { ...row, value: null } : row)),
  },
]

export function findMeter(id: string): MeterSeries | null {
  return METER_SERIES.find((series) => series.id === id) ?? null
}

export const UNITS: Record<MeterUnit, { label: string; toKwh: number }> = {
  kWh: { label: 'kWh', toKwh: 1 },
  MWh: { label: 'MWh', toKwh: 1000 },
}

/** Problems that prevent fitting, on the field or row they concern. */
export function meterIssues(series: MeterSeries): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (series.rows.length !== 12) {
    issues.push({
      path: 'meterId',
      message: `The series has ${series.rows.length} months; a fit needs 12 consecutive months of one calendar year.`,
    })
  }
  const years = new Set(series.rows.map((row) => row.month.slice(0, 4)))
  if (years.size > 1) {
    issues.push({
      path: 'meterId',
      message: 'The months span more than one calendar year.',
    })
  }
  series.rows.forEach((row, index) => {
    if (row.value === null) {
      issues.push({
        path: `rows.${index}`,
        message: `${row.month} has no value.`,
      })
    } else if (row.value < 0) {
      issues.push({
        path: `rows.${index}`,
        message: `${row.month} is negative.`,
      })
    }
  })
  return issues
}

/** Monthly metered energy in kWh, or null when the series cannot be fitted. */
export function meteredKwh(
  series: MeterSeries,
  unit: MeterUnit,
): number[] | null {
  if (meterIssues(series).length > 0) return null
  return series.rows.map((row) => (row.value ?? 0) * UNITS[unit].toKwh)
}

/** Why `unit` contradicts what the export states, or null. */
export function unitWarning(
  series: MeterSeries,
  unit: MeterUnit,
): string | null {
  return series.statedUnit === unit
    ? null
    : `The export states ${series.statedUnit}, but ${unit} is chosen. Check the unit before fitting.`
}

/** CV(RMSE) and NMBE of modeled against metered values, in percent. */
export function fitMetrics(modeled: number[], metered: number[]): FitMetrics {
  const count = metered.length
  const mean = metered.reduce((sum, value) => sum + value, 0) / count
  let squared = 0
  let bias = 0
  metered.forEach((value, index) => {
    const difference = value - (modeled[index] ?? 0)
    squared += difference * difference
    bias += difference
  })
  // ASHRAE Guideline 14 style, with one parameter fitted (count - 1).
  const dof = Math.max(1, count - 1)
  return {
    cvrmsePercent: round((Math.sqrt(squared / dof) / mean) * 100, 1),
    nmbePercent: round((bias / (dof * mean)) * 100, 1),
  }
}

/** The demo's acceptance thresholds for monthly data, after ASHRAE Guideline 14. */
export const THRESHOLDS = { cvrmsePercent: 15, nmbePercent: 5 }

export function meetsThresholds(metrics: FitMetrics): boolean {
  return (
    metrics.cvrmsePercent <= THRESHOLDS.cvrmsePercent &&
    Math.abs(metrics.nmbePercent) <= THRESHOLDS.nmbePercent
  )
}

/** The modeled baseline a fit uses: the stored modeled one while a variant is adopted. */
export function modeledSource(
  state: WorkbenchState,
): { result: ResultSet; revision: number } | null {
  if (state.calibration.modeled) return state.calibration.modeled
  const result = state.results.baseline
  const revision = state.workflow.stages[STAGE_IDS.baseline]?.revision ?? 0
  return result ? { result, revision } : null
}

export type FitOutcome = {
  factor: number
  before: FitMetrics
  after: FitMetrics
  metered: number[]
  modeled: number[]
  calibrated: number[]
}

/**
 * One coupled least-squares factor scaling every building's modeled demand to
 * the metered months. Synthetic stand-in: real calibration adjusts physical
 * inputs per building and is deferred.
 */
export function fitFactor(modeled: number[], metered: number[]): FitOutcome {
  const numerator = modeled.reduce(
    (sum, value, index) => sum + value * (metered[index] ?? 0),
    0,
  )
  const denominator = modeled.reduce((sum, value) => sum + value * value, 0)
  const factor = denominator > 0 ? round(numerator / denominator, 4) : 1
  const calibrated = modeled.map((value) => round(value * factor))
  return {
    factor,
    before: fitMetrics(modeled, metered),
    after: fitMetrics(calibrated, metered),
    metered,
    modeled,
    calibrated,
  }
}

/** A calibrated copy of a baseline result, scaled by the fitted factor. */
export function calibratedResult(
  baseline: ResultSet,
  factor: number,
  runId: string,
): ResultSet {
  const byBuildingKwh = Object.fromEntries(
    Object.entries(baseline.byBuildingKwh).map(([id, kwh]) => [
      id,
      round(kwh * factor),
    ]),
  )
  return {
    id: 'result:baseline',
    label: 'Calibrated baseline',
    runId,
    totalKwh: round(baseline.totalKwh * factor),
    peakKw: round(baseline.peakKw * factor),
    monthlyKwh: baseline.monthlyKwh.map((value) => round(value * factor)),
    byBuildingKwh,
  }
}

/** A stable text form of a fit's options and the modeled baseline it consumes. */
export function calibrationOptions(
  state: WorkbenchState,
  input: CalibrationInput,
): string {
  return JSON.stringify({
    meterId: input.meterId,
    unit: input.unit,
    modeledRevision: modeledSource(state)?.revision ?? null,
  })
}

/** Why no fit can be submitted now, or null; shared by the command and the page. */
export function fitBlocker(
  state: WorkbenchState,
  input: CalibrationInput | null,
): string | null {
  if (!modeledSource(state)) {
    return 'A fit needs baseline results. Run "Baseline model setup" first.'
  }
  if (
    Object.values(state.tasks).some(
      (task) =>
        task.stageId === STAGE_IDS.baseline &&
        (task.status === 'queued' || task.status === 'running'),
    )
  ) {
    return 'Baseline model setup or another fit is queued or running. Wait for it to finish.'
  }
  if (!input) return 'Choose a meter series first.'
  const series = findMeter(input.meterId)
  if (!series) return `Unknown meter series "${input.meterId}".`
  const issues = meterIssues(series)
  return issues.length > 0
    ? `The meter series cannot be fitted: ${issues[0]?.message ?? ''}`
    : null
}

/** Why a calibrated variant cannot be adopted now, or null. */
export function adoptBlocker(
  state: WorkbenchState,
  variantId: string,
): string | null {
  const variant = state.calibration.variants[variantId]
  if (!variant) return `Unknown calibrated variant "${variantId}".`
  if (state.calibration.adoptedVariantId === variantId) {
    return 'This variant is already the working baseline.'
  }
  const source = modeledSource(state)
  if (!source || source.revision !== variant.baselineRevision) {
    return 'The modeled baseline changed after this fit. Run a new fit before adopting.'
  }
  return null
}

export { MONTHS }
