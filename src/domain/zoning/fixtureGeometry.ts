import zoneGeometry from '../fixtures/zone-geometry.json'
import type { BuildingZoneGeometry } from './zoning.ts'

// The demo's zone geometry (decision 0036): precomputed offline by
// scripts/generate-zone-geometry.mjs for three neighbouring buildings of the
// bundled footprints, standing in for what the backend's zoning will
// deliver. It is synthetic: no real floor plan was used. Every other
// building has no zone geometry and is one zone.

/** The buildings with zone geometry: a drawn mixed-use plan, each floor a zone, and perimeter and core. */
export const FIXTURE_ZONED_BUILDINGS = ['B0439', 'B0427', 'B0426'] as const

/** The zone geometry every fixture stores with the project, by building id. */
export function fixtureZoneGeometry(): Record<string, BuildingZoneGeometry> {
  // A fresh copy per project, so no two projects share mutable state.
  return structuredClone(
    zoneGeometry.buildings as unknown as Record<string, BuildingZoneGeometry>,
  )
}
