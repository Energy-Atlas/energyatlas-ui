import type { Archetype, ArchetypePart, Schedule } from '../types.ts'

// The synthetic archetype and schedule library (jobs rollout plan, slice 5).
// Values are illustrative stand-ins, not RC's library or any standard's
// tables; nothing here describes real buildings.

function profile(hours: [number, number][], base = 0.05): number[] {
  const values = Array.from({ length: 24 }, () => base)
  for (const [hour, value] of hours) values[hour] = value
  return values
}

function span(from: number, to: number, value: number): [number, number][] {
  return Array.from({ length: to - from }, (_, index) => [from + index, value])
}

/**
 * The days and week of a schedule with one profile for Monday to Friday and
 * another for Saturday and Sunday, the shape most library schedules share.
 */
export function weekdayWeekend(
  weekday: number[],
  weekend: number[],
): Pick<Schedule, 'days' | 'week'> {
  return {
    days: [
      { id: 'weekday', name: 'Weekday', hours: weekday },
      { id: 'weekend', name: 'Weekend', hours: weekend },
    ],
    week: [
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekend',
      'weekend',
    ],
  }
}

export const SCHEDULE_LIBRARY: readonly Schedule[] = [
  {
    id: 'schedule:office',
    name: 'Office occupancy',
    ...weekdayWeekend(
      profile([...span(7, 8, 0.3), ...span(8, 17, 0.95), ...span(17, 19, 0.4)]),
      profile(span(9, 13, 0.15)),
    ),
    source: { kind: 'library', libraryId: 'schedule:office' },
  },
  {
    id: 'schedule:residential',
    name: 'Residential occupancy',
    ...weekdayWeekend(
      profile(
        [
          ...span(0, 7, 0.9),
          ...span(7, 9, 0.6),
          ...span(9, 17, 0.3),
          ...span(17, 24, 0.85),
        ],
        0.3,
      ),
      profile([...span(0, 10, 0.9), ...span(10, 24, 0.7)], 0.7),
    ),
    source: { kind: 'library', libraryId: 'schedule:residential' },
  },
  {
    id: 'schedule:retail',
    name: 'Retail opening hours',
    // Shops keep shorter hours on Sunday than on Saturday.
    days: [
      { id: 'weekday', name: 'Weekday', hours: profile(span(10, 20, 0.85)) },
      { id: 'saturday', name: 'Saturday', hours: profile(span(10, 18, 0.95)) },
      { id: 'sunday', name: 'Sunday', hours: profile(span(11, 17, 0.7)) },
    ],
    week: [
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'weekday',
      'saturday',
      'sunday',
    ],
    source: { kind: 'library', libraryId: 'schedule:retail' },
  },
  {
    id: 'schedule:school',
    name: 'School day',
    ...weekdayWeekend(
      profile([...span(8, 15, 0.95), ...span(15, 17, 0.3)]),
      profile([], 0.02),
    ),
    source: { kind: 'library', libraryId: 'schedule:school' },
  },
]

const library = (libraryId: string) => ({
  kind: 'library' as const,
  libraryId,
})

/**
 * Synthetic archetype parts of RC's four kinds (decision 0032). Values are
 * plausible stand-ins tuned so the library archetypes keep roughly the
 * intensities they had as single numbers; they describe no real building.
 */
export const PART_LIBRARY: readonly ArchetypePart[] = [
  {
    id: 'construction:masonry-pre-1950',
    name: 'Masonry, before 1950',
    kind: 'construction',
    wallU: 1.6,
    roofU: 1.2,
    windowU: 3.2,
    windowRatio: 0.25,
    infiltrationAch: 0.9,
    source: library('construction:masonry-pre-1950'),
  },
  {
    id: 'construction:uninsulated-pre-1980',
    name: 'Uninsulated, before 1980',
    kind: 'construction',
    wallU: 1,
    roofU: 0.8,
    windowU: 2.9,
    windowRatio: 0.2,
    infiltrationAch: 0.55,
    source: library('construction:uninsulated-pre-1980'),
  },
  {
    id: 'construction:insulated-1980-on',
    name: 'Insulated, 1980 or later',
    kind: 'construction',
    wallU: 0.45,
    roofU: 0.3,
    windowU: 2,
    windowRatio: 0.25,
    infiltrationAch: 0.4,
    source: library('construction:insulated-1980-on'),
  },
  {
    id: 'construction:curtain-wall',
    name: 'Commercial curtain wall',
    kind: 'construction',
    wallU: 0.7,
    roofU: 0.4,
    windowU: 2.6,
    windowRatio: 0.5,
    infiltrationAch: 0.5,
    source: library('construction:curtain-wall'),
  },
  {
    id: 'systems:gas-boiler',
    name: 'Gas boiler, split cooling',
    kind: 'systems',
    fuel: 'gas',
    heatingEfficiency: 0.8,
    coolingCop: 2.6,
    hotWaterKwhPerM2: 20,
    source: library('systems:gas-boiler'),
  },
  {
    id: 'systems:condensing-boiler',
    name: 'Condensing gas boiler',
    kind: 'systems',
    fuel: 'gas',
    heatingEfficiency: 0.92,
    coolingCop: 3,
    hotWaterKwhPerM2: 22,
    source: library('systems:condensing-boiler'),
  },
  {
    id: 'systems:office-vav',
    name: 'Office VAV plant',
    kind: 'systems',
    fuel: 'gas',
    heatingEfficiency: 0.85,
    coolingCop: 3.2,
    hotWaterKwhPerM2: 6,
    source: library('systems:office-vav'),
  },
  {
    id: 'systems:rooftop-units',
    name: 'Rooftop units',
    kind: 'systems',
    fuel: 'gas',
    heatingEfficiency: 0.8,
    coolingCop: 2.8,
    hotWaterKwhPerM2: 4,
    source: library('systems:rooftop-units'),
  },
  {
    id: 'loads:residential',
    name: 'Residential loads',
    kind: 'spaceLoads',
    lightingWPerM2: 2.5,
    equipmentWPerM2: 3.5,
    m2PerPerson: 35,
    scheduleId: 'schedule:residential',
    source: library('loads:residential'),
  },
  {
    id: 'loads:office',
    name: 'Office loads',
    kind: 'spaceLoads',
    lightingWPerM2: 10,
    equipmentWPerM2: 14,
    m2PerPerson: 15,
    scheduleId: 'schedule:office',
    source: library('loads:office'),
  },
  {
    id: 'loads:retail',
    name: 'Retail loads',
    kind: 'spaceLoads',
    lightingWPerM2: 15,
    equipmentWPerM2: 6,
    m2PerPerson: 20,
    scheduleId: 'schedule:retail',
    source: library('loads:retail'),
  },
  {
    id: 'loads:school',
    name: 'School loads',
    kind: 'spaceLoads',
    lightingWPerM2: 9,
    equipmentWPerM2: 6,
    m2PerPerson: 8,
    scheduleId: 'schedule:school',
    source: library('loads:school'),
  },
  {
    id: 'loads:mixed',
    name: 'Mixed-use loads',
    kind: 'spaceLoads',
    lightingWPerM2: 8,
    equipmentWPerM2: 9,
    m2PerPerson: 20,
    scheduleId: 'schedule:office',
    source: library('loads:mixed'),
  },
  {
    id: 'external:residential',
    name: 'Residential exterior',
    kind: 'externalLoads',
    exteriorLightingKwhPerM2: 1,
    processKwhPerM2: 0,
    source: library('external:residential'),
  },
  {
    id: 'external:commercial',
    name: 'Commercial exterior and process',
    kind: 'externalLoads',
    exteriorLightingKwhPerM2: 3,
    processKwhPerM2: 8,
    source: library('external:commercial'),
  },
  {
    id: 'external:retail',
    name: 'Retail exterior and refrigeration',
    kind: 'externalLoads',
    exteriorLightingKwhPerM2: 4,
    processKwhPerM2: 25,
    source: library('external:retail'),
  },
  {
    id: 'external:school',
    name: 'School exterior',
    kind: 'externalLoads',
    exteriorLightingKwhPerM2: 2,
    processKwhPerM2: 3,
    source: library('external:school'),
  },
]

function bundle(
  construction: string,
  systems: string,
  spaceLoads: string,
  externalLoads: string,
): Archetype['parts'] {
  return { construction, systems, spaceLoads, externalLoads }
}

/**
 * The library: named bundles of four parts. The first five are the defaults
 * Archetype modeling starts from; Mixed use gives the fallback rule its parts.
 */
export const ARCHETYPE_LIBRARY: readonly Archetype[] = [
  {
    id: 'archetype:residential-pre-1980',
    name: 'Residential, built before 1980',
    use: 'residential',
    yearFrom: null,
    yearTo: 1979,
    parts: bundle(
      'construction:uninsulated-pre-1980',
      'systems:gas-boiler',
      'loads:residential',
      'external:residential',
    ),
    source: library('archetype:residential-pre-1980'),
  },
  {
    id: 'archetype:residential-1980-on',
    name: 'Residential, built 1980 or later',
    use: 'residential',
    yearFrom: 1980,
    yearTo: null,
    parts: bundle(
      'construction:insulated-1980-on',
      'systems:condensing-boiler',
      'loads:residential',
      'external:residential',
    ),
    source: library('archetype:residential-1980-on'),
  },
  {
    id: 'archetype:office',
    name: 'Office',
    use: 'office',
    yearFrom: null,
    yearTo: null,
    parts: bundle(
      'construction:curtain-wall',
      'systems:office-vav',
      'loads:office',
      'external:commercial',
    ),
    source: library('archetype:office'),
  },
  {
    id: 'archetype:retail',
    name: 'Retail',
    use: 'retail',
    yearFrom: null,
    yearTo: null,
    parts: bundle(
      'construction:curtain-wall',
      'systems:rooftop-units',
      'loads:retail',
      'external:retail',
    ),
    source: library('archetype:retail'),
  },
  {
    id: 'archetype:school',
    name: 'School',
    use: 'school',
    yearFrom: null,
    yearTo: null,
    parts: bundle(
      'construction:insulated-1980-on',
      'systems:gas-boiler',
      'loads:school',
      'external:school',
    ),
    source: library('archetype:school'),
  },
  {
    id: 'archetype:mixed',
    name: 'Mixed use',
    use: 'mixed',
    yearFrom: null,
    yearTo: null,
    parts: bundle(
      'construction:uninsulated-pre-1980',
      'systems:gas-boiler',
      'loads:mixed',
      'external:commercial',
    ),
    source: library('archetype:mixed'),
  },
  {
    id: 'archetype:office-pre-1950',
    name: 'Office, built before 1950',
    use: 'office',
    yearFrom: null,
    yearTo: 1949,
    parts: bundle(
      'construction:masonry-pre-1950',
      'systems:gas-boiler',
      'loads:office',
      'external:commercial',
    ),
    source: library('archetype:office-pre-1950'),
  },
]

export const DEFAULT_ARCHETYPE_IDS = ARCHETYPE_LIBRARY.slice(0, 5).map(
  (archetype) => archetype.id,
)

/** The library archetype whose parts the generated fallback rule assigns. */
export const FALLBACK_ARCHETYPE_ID = 'archetype:mixed'
