/**
 * One place for how numbers, energy, and times read in the interface
 * (decision 0027): tables, Inspection, the map legend, chart data tables, and
 * the status bar format through these, so a value reads the same everywhere.
 * Numbers use en-US grouping; times follow the browser's locale.
 */

export const NO_DATA = 'No data'

export type NumberFormat = {
  /** Most digits after the decimal point; whole numbers by default. */
  maxDigits?: number
  /** Unit appended after a space, such as "kW". */
  unit?: string
}

export function formatNumber(
  value: number | null | undefined,
  { maxDigits = 0, unit }: NumberFormat = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NO_DATA
  }
  const text = value.toLocaleString('en-US', {
    maximumFractionDigits: maxDigits,
  })
  return unit ? `${text} ${unit}` : text
}

/** A count with its noun, pluralised with "s": "1 job", "3 jobs". */
export function formatCount(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
}

export type EnergyScale = 'kWh' | 'MWh'

/** Energy given in kWh, shown in the requested scale. */
export function formatEnergy(
  kwh: number | null | undefined,
  scale: EnergyScale = 'MWh',
  maxDigits = scale === 'MWh' ? 1 : 0,
): string {
  if (kwh === null || kwh === undefined) return NO_DATA
  return formatNumber(scale === 'MWh' ? kwh / 1000 : kwh, {
    maxDigits,
    unit: scale,
  })
}

/** Clock time of a timestamp, in the browser's locale. */
export function formatTime(at: number | string | Date): string {
  return new Date(at).toLocaleTimeString()
}

/** Date and time of a timestamp, in the browser's locale. */
export function formatDateTime(at: number | string | Date): string {
  return new Date(at).toLocaleString()
}
