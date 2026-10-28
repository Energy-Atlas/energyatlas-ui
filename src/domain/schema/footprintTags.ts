import {
  DISTRICT_SOURCE_REFS,
  syntheticAttributes,
  unitRandom,
} from '../simulation.ts'
import type { Building, BuildingUse } from '../types.ts'

// Source attributes of the captured footprints for Schema matching (decision
// 0032, stage 4): OpenStreetMap-like tags, synthetic and deterministic per
// footprint. They agree with the synthetic enrichment where both have a
// value, so the built-in mapping reproduces it; tags are missing, written
// differently ("apartments", "c. 1925", "48 ft"), or extra ("roof:shape")
// where real tags would be. No real tag values are bundled. Nothing here runs
// at module load, because simulation.ts imports this module in a cycle.

export type FootprintTags = Record<string, string | null>

/** The source attributes, in the order the Schema matching page lists them. */
export const FOOTPRINT_TAGS = [
  'osm_id',
  'building',
  'building:levels',
  'start_date',
  'height',
  'name',
  'roof:shape',
] as const

const NAMES = [
  'Linden Court',
  'Harbor House',
  'Aster Hall',
  'Cedar Flats',
  'Maple Terrace',
  'Juniper Lofts',
  'Willow Commons',
  'Birch Studios',
  'Alder Row',
  'Rowan House',
]

const BUILDING_VALUES: Record<BuildingUse, [number, string][]> = {
  residential: [
    [0.5, 'apartments'],
    [0.8, 'residential'],
    [1, 'house'],
  ],
  office: [
    [0.6, 'office'],
    [1, 'commercial'],
  ],
  retail: [
    [0.8, 'retail'],
    [1, 'yes'],
  ],
  school: [
    [0.7, 'school'],
    [1, 'university'],
  ],
  mixed: [[1, 'yes']],
}

function pick(choices: [number, string][], roll: number): string {
  return (
    choices.find(([limit]) => roll < limit)?.[1] ?? choices.at(-1)?.[1] ?? ''
  )
}

let districtIndex: Map<string, number> | null = null

/** The footprint's position in the bundled extract, or null for added buildings. */
export function footprintIndex(
  building: Pick<Building, 'sourceRef'>,
): number | null {
  if (!building.sourceRef) return null
  districtIndex ??= new Map(
    DISTRICT_SOURCE_REFS.map((ref, index) => [ref, index]),
  )
  return districtIndex.get(building.sourceRef) ?? null
}

const cache = new Map<number, FootprintTags>()

/** The tags captured with the footprint at this position of the extract. */
export function tagsAt(index: number): FootprintTags {
  const cached = cache.get(index)
  if (cached) return cached
  const synthetic = syntheticAttributes(index)
  const ref = DISTRICT_SOURCE_REFS[index] ?? ''
  const height = synthetic.floors * 3.2
  const heightRoll = unitRandom(index, 64)
  const yearRoll = unitRandom(index, 63)
  const roofRoll = unitRandom(index, 67)
  const tags: FootprintTags = {
    osm_id: ref.replace(/^OpenStreetMap /, '') || null,
    building: pick(BUILDING_VALUES[synthetic.use], unitRandom(index, 61)),
    'building:levels':
      unitRandom(index, 62) < 0.85 ? String(synthetic.floors) : null,
    start_date:
      yearRoll < 0.72
        ? String(synthetic.yearBuilt)
        : yearRoll < 0.78
          ? `c. ${synthetic.yearBuilt}`
          : null,
    height:
      heightRoll < 0.55
        ? (height + (unitRandom(index, 65) - 0.5) * 1.6).toFixed(1)
        : heightRoll < 0.6
          ? `${Math.round(height * 3.28084)} ft`
          : null,
    name:
      unitRandom(index, 66) < 0.12
        ? (NAMES[Math.floor(unitRandom(index, 68) * NAMES.length)] ?? null)
        : null,
    'roof:shape':
      roofRoll < 0.55
        ? 'flat'
        : roofRoll < 0.7
          ? 'gabled'
          : roofRoll < 0.8
            ? 'hipped'
            : roofRoll < 0.95
              ? 'mansard'
              : null,
  }
  cache.set(index, tags)
  return tags
}

/** A building's captured tags; buildings a dataset added have none. */
export function footprintTags(
  building: Pick<Building, 'sourceRef'>,
): FootprintTags | null {
  const index = footprintIndex(building)
  return index === null ? null : tagsAt(index)
}
