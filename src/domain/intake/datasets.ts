import {
  DISTRICT_BOUNDS,
  DISTRICT_SOURCE_REFS,
  unitRandom,
} from '../simulation.ts'
import type { LngLat } from '../types.ts'

// Synthetic datasets for data intake (jobs rollout plan, slice 4). They stand
// in for uploads: nothing is read from disk or a server, and no real parcel,
// permit, or owner data is used. Records reference the bundled footprints by
// their OpenStreetMap way so stable-ID fusion can be exercised honestly.

export type DatasetValue = string | number | null | LngLat[]

export type DatasetRecord = Record<string, DatasetValue>

export type Dataset = {
  id: string
  label: string
  format: 'CSV' | 'GeoJSON'
  description: string
  fields: string[]
  records: DatasetRecord[]
}

/** "OpenStreetMap way/123" becomes "way/123". */
function osmKey(index: number): string {
  return (DISTRICT_SOURCE_REFS[index] ?? `way/missing-${index}`).replace(
    /^OpenStreetMap /,
    '',
  )
}

const USE_CODES = ['RES', 'RES', 'RES', 'OFF', 'RET', 'SCH', 'MIX']

function assessorRecords(): DatasetRecord[] {
  const records: DatasetRecord[] = []
  for (let count = 0; count < 60; count += 1) {
    const index = count * 7
    records.push({
      osm_ref: osmKey(index),
      use_code:
        USE_CODES[Math.floor(unitRandom(index, 41) * USE_CODES.length)] ??
        'RES',
      yr_built: 1890 + Math.floor(unitRandom(index, 42) * 125),
      stories: 1 + Math.floor(unitRandom(index, 43) * 8),
      assessed_note: `Synthetic assessment ${count + 1}`,
    })
  }
  // Invalid values, reported per row and field.
  const invalidStories = records[4]
  if (invalidStories) invalidStories.stories = 0
  const textStories = records[9]
  if (textStories) textStories.stories = 'twelve'
  const futureYear = records[14]
  if (futureYear) futureYear.yr_built = 2150
  const unknownUse = records[25]
  if (unknownUse) unknownUse.use_code = 'IND'
  // The same source ID twice is ambiguous and rejected, never guessed.
  const duplicate = records[21]
  if (duplicate) duplicate.osm_ref = osmKey(20 * 7)
  // No matching building and no geometry to add one.
  const unmatched = records[30]
  if (unmatched) unmatched.osm_ref = 'way/0'
  return records
}

/** A small square footprint east of the district, in degrees. */
function square(column: number, row: number): LngLat[] {
  const size = 0.00018
  const west = DISTRICT_BOUNDS.east + 0.0004 + column * 0.0003
  const south = DISTRICT_BOUNDS.south + 0.0006 + row * 0.0003
  return [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ]
}

function infillRecords(): DatasetRecord[] {
  const uses = [
    'residential',
    'office',
    'residential',
    'school',
    'mixed',
    'retail',
  ]
  const added = uses.map((use, index): DatasetRecord => ({
    source_id: `infill/${index + 1}`,
    name: `Infill building ${index + 1}`,
    building_use: use,
    floors: 3 + index,
    year: 2026,
    geometry: square(index % 3, Math.floor(index / 3)),
  }))
  const updates = [1, 2, 3].map((index): DatasetRecord => ({
    source_id: osmKey(index * 50),
    name: null,
    building_use: 'office',
    floors: 10 + index,
    year: null,
    geometry: null,
  }))
  // A new record without geometry cannot be added.
  const noGeometry: DatasetRecord = {
    source_id: 'infill/7',
    name: 'Infill building 7',
    building_use: 'residential',
    floors: 4,
    year: 2027,
    geometry: null,
  }
  return [...added, ...updates, noGeometry]
}

export const DATASETS: readonly Dataset[] = [
  {
    id: 'dataset:assessor',
    label: 'Assessor attributes',
    format: 'CSV',
    description:
      '60 parcel rows keyed by OpenStreetMap way, with use codes, construction year, and stories. Includes invalid values, a duplicated key, and an unmatched row.',
    fields: ['osm_ref', 'use_code', 'yr_built', 'stories', 'assessed_note'],
    records: assessorRecords(),
  },
  {
    id: 'dataset:infill',
    label: 'Planned infill buildings',
    format: 'GeoJSON',
    description:
      'Six new buildings with footprints east of the district, three updates to existing buildings, and one new record without geometry.',
    fields: ['source_id', 'name', 'building_use', 'floors', 'year', 'geometry'],
    records: infillRecords(),
  },
  {
    id: 'dataset:broken',
    label: 'Export without identifiers',
    format: 'CSV',
    description:
      'Addresses and stories with no stable source ID, so it cannot be fused until a field identifies each building.',
    fields: ['address', 'stories', 'notes'],
    records: Array.from({ length: 12 }, (_, index) => ({
      address: `${100 + index * 4} Synthetic Street`,
      stories: 2 + (index % 5),
      notes: null,
    })),
  },
]

export function findDataset(id: string): Dataset | null {
  return DATASETS.find((dataset) => dataset.id === id) ?? null
}
