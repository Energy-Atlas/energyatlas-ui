import { z } from 'zod'
import type { LngLat } from '../../domain/types.ts'

// The map's camera as view state (decision 0036, L1): where the map looks
// from. The map keeps it in step as the camera moves (map.syncCamera), view
// operations move it (map.setCamera), a layout carries it, and the project
// saves it with its other views. A project or layout without one leaves the
// map framing its footprints.

export type MapCamera = {
  /** The point the map is centred on. */
  center: LngLat
  zoom: number
  /** Degrees from straight down; 0 on a flat map. */
  pitch: number
  /** Degrees clockwise from north. */
  bearing: number
}

export const MAX_CAMERA_PITCH = 85

export const mapCameraSchema = z.object({
  center: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-85.06).max(85.06),
  ]),
  zoom: z.number().min(0).max(24),
  pitch: z.number().min(0).max(MAX_CAMERA_PITCH),
  bearing: z.number().min(-360).max(360),
})

/** A stored camera, or null when there is none or it cannot be read. */
export function parseStoredCamera(value: unknown): MapCamera | null {
  const parsed = mapCameraSchema.safeParse(value)
  return parsed.success ? normalizeCamera(parsed.data) : null
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * A camera rounded to what the map can show apart (about a centimetre, a
 * thousandth of a zoom level, a tenth of a degree), with the bearing from
 * -180 to 180, so small float noise from the map is not a change.
 */
export function normalizeCamera(camera: MapCamera): MapCamera {
  const bearing = ((((camera.bearing + 180) % 360) + 360) % 360) - 180
  return {
    center: [round(camera.center[0], 7), round(camera.center[1], 7)],
    zoom: round(camera.zoom, 3),
    pitch: round(camera.pitch, 1),
    bearing: round(bearing === -180 ? 180 : bearing, 1),
  }
}

export function sameCamera(a: MapCamera | null, b: MapCamera | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.zoom === b.zoom &&
    a.pitch === b.pitch &&
    a.bearing === b.bearing
  )
}

/** The camera in words, for operation summaries. */
export function describeCamera(camera: MapCamera): string {
  return `centre ${camera.center[1].toFixed(5)}, ${camera.center[0].toFixed(5)}, zoom ${camera.zoom.toFixed(1)}, pitch ${camera.pitch.toFixed(0)}°, bearing ${camera.bearing.toFixed(0)}°`
}
