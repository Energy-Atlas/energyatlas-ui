import { describe, expect, it } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import { parseSavedView } from '../../server/projectCatalog.ts'
import { describeAgentTools } from '../agent/tools.ts'
import { createLayoutController } from '../layout/layoutController.ts'
import { createLayoutLibrary } from '../layouts/layoutLibrary.ts'
import {
  applyViewSnapshot,
  captureViewSnapshot,
} from '../layouts/savedLayout.ts'
import { createInitialState } from '../../domain/initialState.ts'
import {
  normalizeCamera,
  parseStoredCamera,
  sameCamera,
  type MapCamera,
} from './mapCamera.ts'
import { createInitialViewState } from './viewOperations.ts'
import { createViewStore } from './viewStore.ts'

// The map camera as view state (decision 0036, L1).

const BACK_BAY: MapCamera = {
  center: [-71.0725, 42.3511],
  zoom: 17.5,
  pitch: 50,
  bearing: -20,
}

function setup() {
  const workbench = createWorkbench()
  const layout = createLayoutController(workbench, null)
  const view = createViewStore(workbench)
  const library = createLayoutLibrary({
    workbench,
    layout,
    view,
    warn: () => undefined,
  })
  return { workbench, view, library }
}

describe('the map camera', () => {
  it('rounds away float noise and reads only valid stored cameras', () => {
    const noisy = {
      center: [-71.07250000001, 42.35110000002] as [number, number],
      zoom: 17.50000004,
      pitch: 49.99999,
      bearing: 340,
    }
    expect(normalizeCamera(noisy)).toEqual({ ...BACK_BAY, bearing: -20 })
    expect(sameCamera(normalizeCamera(noisy), BACK_BAY)).toBe(true)
    expect(parseStoredCamera(BACK_BAY)).toEqual(BACK_BAY)
    expect(parseStoredCamera({ ...BACK_BAY, zoom: 40 })).toBeNull()
    expect(parseStoredCamera(undefined)).toBeNull()
  })

  it('keeps step with the map without moving it, and moves it on request', () => {
    const { view, workbench } = setup()
    const logged = workbench.store.getState().log.length
    // The map reports where it is: kept, not logged, and no move requested.
    const sync = view.execute(
      { type: 'map.syncCamera', input: BACK_BAY },
      'system',
      { record: false },
    )
    expect(sync.outcome.status).toBe('applied')
    expect(view.getState().map.camera).toEqual(BACK_BAY)
    expect(view.getState().map.cameraRequest).toBe(0)
    expect(workbench.store.getState().log.length).toBe(logged)
    // The same camera again changes nothing.
    expect(
      view.execute({ type: 'map.syncCamera', input: BACK_BAY }, 'system', {
        record: false,
      }).outcome.status,
    ).toBe('rejected')
    // map.setCamera moves the map; a flat map stays flat.
    const moved = view.execute({
      type: 'map.setCamera',
      input: { center: [-71.073, 42.35], zoom: 18, pitch: 60 },
    })
    expect(moved.outcome).toMatchObject({ status: 'applied' })
    expect(view.getState().map.camera).toEqual({
      center: [-71.073, 42.35],
      zoom: 18,
      pitch: 0,
      bearing: -20,
    })
    expect(view.getState().map.cameraRequest).toBe(1)
    expect(
      view.execute({
        type: 'map.setCamera',
        input: { center: [-71.073, 42.35], zoom: 30 },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'zoom' }] })
  })

  it('opens a project at its saved camera, and a project without one framed', () => {
    const { view } = setup()
    view.execute({ type: 'map.syncCamera', input: BACK_BAY }, 'system', {
      record: false,
    })
    view.execute({
      type: 'view.resetForProject',
      input: { tables: {}, camera: { ...BACK_BAY, zoom: 16 } },
    })
    expect(view.getState().map.camera?.zoom).toBe(16)
    expect(view.getState().map.cameraRequest).toBe(1)
    view.execute({ type: 'view.resetForProject', input: { tables: {} } })
    expect(view.getState().map.camera).toBeNull()
    expect(view.getState().map.cameraRequest).toBe(1)
    // The server keeps the camera with the project's other views.
    expect(parseSavedView({ tables: {}, camera: BACK_BAY })).toEqual({
      tables: {},
      camera: BACK_BAY,
    })
  })

  it('is kept by a layout and restored when the layout is applied (L1)', () => {
    const { view, library } = setup()
    view.execute({ type: 'map.set3d', input: { enabled: true } })
    view.execute({ type: 'map.syncCamera', input: BACK_BAY }, 'system', {
      record: false,
    })
    const save = library.save({ name: 'Back Bay in 3D' })
    if (save.status !== 'applied' || !save.id) throw new Error('not saved')
    // Moving the map is not a change to the layout.
    view.execute(
      {
        type: 'map.syncCamera',
        input: { center: [-71.08, 42.34], zoom: 14, pitch: 0, bearing: 0 },
      },
      'system',
      { record: false },
    )
    expect(library.changedSinceApplied()).toBe(false)
    const before = view.getState().map.cameraRequest
    expect(library.apply(save.id)).toMatchObject({ status: 'applied' })
    expect(view.getState().map.camera).toEqual(BACK_BAY)
    expect(view.getState().map.cameraRequest).toBe(before + 1)
  })

  it('leaves the camera alone for a layout saved before cameras, and flattens it for a flat layout', () => {
    const project = createInitialState()
    const view = createInitialViewState()
    view.map.camera = BACK_BAY
    const snapshot = captureViewSnapshot(view) as unknown as {
      map: Record<string, unknown>
    }
    const older = { ...snapshot, map: { ...snapshot.map } }
    delete older.map.camera
    expect(applyViewSnapshot(view, older, project)).toEqual([])
    expect(view.map.camera).toEqual(BACK_BAY)
    expect(view.map.cameraRequest).toBe(0)
    // Flat in the layout: the camera keeps its centre and zoom, not its tilt.
    const flat = { ...snapshot, map: { ...snapshot.map, view3d: false } }
    applyViewSnapshot(view, flat, project)
    expect(view.map.camera).toEqual({ ...BACK_BAY, pitch: 0 })
    expect(view.map.cameraRequest).toBe(1)
  })

  it('is a view tool for the agent; keeping it in step is the map’s own', () => {
    const names = describeAgentTools().map((tool) => tool.name)
    expect(names).toContain('map.setCamera')
    expect(names).not.toContain('map.syncCamera')
  })
})
