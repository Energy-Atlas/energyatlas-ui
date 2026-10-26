import type { Measure } from '../types.ts'

// The synthetic measure library (jobs rollout plan, slice 6). Savings are
// illustrative percentages for the demo's synthetic model, not engineering
// estimates, and carry no cost or payback data.

export type LibraryMeasure = Omit<Measure, 'id' | 'source'> & {
  libraryId: string
  description: string
}

export const MEASURE_LIBRARY: readonly LibraryMeasure[] = [
  {
    libraryId: 'measure:wall-insulation',
    name: 'Wall and roof insulation',
    kind: 'envelope',
    savingsPercent: 18,
    appliesTo: 'all',
    description: 'Insulates walls and roofs of every building.',
  },
  {
    libraryId: 'measure:window-replacement',
    name: 'Window replacement (residential)',
    kind: 'envelope',
    savingsPercent: 9,
    appliesTo: 'residential',
    description: 'Replaces single glazing in residential buildings.',
  },
  {
    libraryId: 'measure:heat-pumps',
    name: 'Air-source heat pumps',
    kind: 'heating',
    savingsPercent: 25,
    appliesTo: 'residential',
    description: 'Replaces residential boilers with heat pumps.',
  },
  {
    libraryId: 'measure:boiler-tuning',
    name: 'Boiler tuning (offices)',
    kind: 'heating',
    savingsPercent: 6,
    appliesTo: 'office',
    description: 'Tunes office heating plants.',
  },
  {
    libraryId: 'measure:led-lighting',
    name: 'LED lighting',
    kind: 'lighting',
    savingsPercent: 7,
    appliesTo: 'all',
    description: 'Replaces interior lighting with LEDs.',
  },
  {
    libraryId: 'measure:school-lighting',
    name: 'Lighting controls (schools)',
    kind: 'lighting',
    savingsPercent: 5,
    appliesTo: 'school',
    description: 'Adds occupancy and daylight controls in schools.',
  },
  {
    libraryId: 'measure:rooftop-pv',
    name: 'Rooftop PV',
    kind: 'pv',
    savingsPercent: 0,
    appliesTo: 'all',
    description: 'Uses each roof’s estimated PV yield.',
  },
]
