import {
  Layer,
  Map as MapView,
  NavigationControl,
  Source,
  type MapRef,
} from '@vis.gl/react-maplibre'
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { DISTRICT_CENTER } from '../../domain/simulation.ts'
import type { LngLat } from '../../domain/types.ts'
import type { MapCamera } from '../view/mapCamera.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  useAppearance,
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import type { DataPalette } from '../appearance/appearances.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { formatNumber } from '../format.ts'
import {
  BASEMAP_SOURCE_ID,
  buildBasemapStyle,
  FOOTPRINT_ATTRIBUTION,
} from './basemapStyle.ts'
import { computeMetric, METRICS, type MetricId } from './mapMetrics.ts'
import {
  metricProperty,
  resolveLayers,
  StackLayer,
  type ResolvedLayer,
} from './StackLayer.tsx'
import styles from './map.module.css'
import {
  SelectionSilhouette,
  type SilhouettePrism,
} from './SelectionSilhouette.tsx'
import {
  buildLightingScene,
  GLOBE_DIM_STOPS,
  globeDimOpacity,
} from './lighting.ts'
import { useSceneLighting } from './useSceneLighting.ts'
import {
  exaggerationLabel,
  firstSymbolLayerId,
  HILLSHADE_SOURCE_ID,
  hillshadePaint,
  TERRAIN_ATTRIBUTION,
  TERRAIN_MAX_ZOOM,
  TERRAIN_SOURCE_ID,
  TERRAIN_TILE_SIZE,
  TERRAIN_TILES_URL,
} from './terrain.ts'
import { useBasemap } from './useBasemap.ts'
import { useTerrain } from './useTerrain.ts'
import {
  clickNotice,
  clickTarget,
  describeClick,
  stepNotice,
  stepTarget,
  upTarget,
  type MapHit,
  type MapTarget,
} from './mapSelection.ts'
import {
  selectedBuildingIds,
  type ZoneKind,
} from '../../domain/zoning/zoning.ts'
import type { WorkbenchState } from '../../domain/types.ts'
import { zoneEdges, zoneOverlay, type ZoneOverlay } from './zoneFeatures.ts'
import { ZoneEdgeLayer } from './ZoneEdgeLayer.tsx'
import {
  pointerRay,
  prismOf,
  rayPrismDistance,
  sortByDistance,
  type Prism,
} from './mapPicking.ts'
import {
  ZONE_LAYER_IDS,
  ZONE_SOURCE,
  ZoneLayers,
  zoneLayerIds,
  type ZoneDrawing,
} from './ZoneLayers.tsx'

const POINT_KINDS = new Set(['transformer', 'utilityPv', 'bus'])

type Hover = { id: string; label: string; x: number; y: number }

/** Where the pointer last was over the map, and what it was over. */
/** A map feature, or a prism the map picked itself in 3D. */
type Picked = {
  layer: { id: string }
  properties: Record<string, unknown>
}

type Pointer = {
  features: Picked[]
  x: number
  y: number
  shift: boolean
}

function baseStyle(background: string): StyleSpecification {
  // Shown while the basemap is off, loading, or unavailable (decision 0012).
  // The background is the workbench ground of the active appearance.
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': background },
      },
    ],
  }
}

function boundsOf(points: LngLat[]): [number, number, number, number] | null {
  if (points.length === 0) return null
  let [west, south] = points[0] ?? [0, 0]
  let [east, north] = [west, south]
  for (const [lng, lat] of points) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [west, south, east, north]
}

/** Whether a camera looks at a point inside the bounds, widened by half their size. */
function cameraInside(
  camera: MapCamera,
  [west, south, east, north]: [number, number, number, number],
): boolean {
  const [lng, lat] = camera.center
  const width = (east - west) / 2
  const height = (north - south) / 2
  return (
    lng >= west - width &&
    lng <= east + width &&
    lat >= south - height &&
    lat <= north + height
  )
}

/** A stored camera as MapLibre's jump options; a flat map stays flat. */
function cameraOptions(camera: MapCamera, view3d: boolean) {
  return {
    center: camera.center,
    zoom: camera.zoom,
    pitch: view3d ? camera.pitch : 0,
    bearing: view3d ? camera.bearing : 0,
  }
}

function formatValue(value: number | null, unit: string): string {
  return formatNumber(value, { maxDigits: 3, unit: unit || undefined })
}

export function MapPage() {
  const headingId = useId()
  const { workbench, view, showInspection, basemapEnabled, claimWorked } =
    useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const appearance = useAppearance()
  const palette = appearance.data
  const basemap = useBasemap(basemapEnabled)
  // A new style object on every render makes react-maplibre call setStyle,
  // whose diff drops the sources added at runtime and their feature state.
  const mapStyle = useMemo(
    () =>
      basemap.style
        ? buildBasemapStyle(basemap.style, appearance)
        : baseStyle(appearance.chrome.bg),
    [basemap.style, appearance],
  )
  const mapRef = useRef<MapRef>(null)
  const [loaded, setLoaded] = useState(false)
  const mapView = useViewState((state) => state.map)
  const view3d = mapView.view3d
  // Live terrain, for display only (decision 0015).
  const terrainEnabled = mapView.terrain
  const exaggeration = mapView.terrainExaggeration
  // Terrain belongs to the 3D scene, so a flat map never loads it.
  const terrain = useTerrain(
    mapRef,
    loaded,
    terrainEnabled && view3d,
    exaggeration,
  )
  const scene = useMemo(
    () =>
      buildLightingScene(
        mapView.lighting,
        appearance,
        DISTRICT_CENTER[1],
        DISTRICT_CENTER[0],
      ),
    [mapView.lighting, appearance],
  )
  useSceneLighting(mapRef, loaded, view3d, scene)
  const globeDim = globeDimOpacity(appearance.scheme)

  // The globe replaces Mercator (decision 0019). Projection is style state, so
  // a basemap or appearance swap drops it; styledata puts it back.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded) return
    const apply = () => {
      try {
        map.setProjection({ type: 'globe' })
      } catch {
        // The style is still loading; the next styledata event applies it.
      }
    }
    apply()
    map.on('styledata', apply)
    return () => {
      map.off('styledata', apply)
    }
  }, [loaded])

  // Working in the map makes it the surface Inspection describes. Docked tabs
  // stay mounted while hidden, so becoming visible is the signal for "switched
  // to this tab"; the first observation is the app's own startup, which should
  // leave Inspection saying nothing is selected.
  const pageRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = pageRef.current
    if (!node || typeof IntersectionObserver !== 'function') return
    let startup = true
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      if (!visible) return
      if (startup) {
        startup = false
        return
      }
      claimWorked('map')
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [claimWorked])
  const labelLayerId = useMemo(() => firstSymbolLayerId(mapStyle), [mapStyle])
  const handledFocusRequest = useRef(0)
  // The hover label is derived from the last pointer hits on every render,
  // so it follows a selection changed by a click or a key without a move.
  const [pointer, setPointer] = useState<Pointer | null>(null)

  // Metrics read buildings, results, and scenarios only, so a selection or a
  // job's progress does not rebuild (and re-upload) the map's sources.
  const { buildingIds, buildings, zoning, results, scenarios, selection } =
    state
  const metrics = useMemo(() => {
    const inputs = { buildingIds, buildings, results, scenarios }
    return Object.fromEntries(
      METRICS.map((metric) => [
        metric.id,
        computeMetric(inputs as WorkbenchState, metric.id),
      ]),
    ) as Record<MetricId, ReturnType<typeof computeMetric>>
  }, [buildingIds, buildings, results, scenarios])
  // The layer stack (decision 0031), top first, resolved against the data.
  const stack = useMemo(
    () => resolveLayers(mapView.layers, metrics, view3d),
    [mapView.layers, metrics, view3d],
  )
  const byPickId = useMemo(
    () => new Map(stack.map((resolved) => [resolved.pickId, resolved])),
    [stack],
  )
  const shown = stack.filter((resolved) => resolved.layer.visible)
  const extrudedShown = shown.some((resolved) => resolved.extruded)
  const buildingLayerShown = shown.some(
    (resolved) => resolved.layer.kind === 'buildings',
  )

  // The selected buildings' zones (decision 0032, stage 6; decision 0036).
  const overlay = useMemo(
    () => zoneOverlay({ selection, buildings, zoning }),
    [selection, buildings, zoning],
  )
  const zoneDrawing: ZoneDrawing =
    overlay.buildingIds.length === 0 || !buildingLayerShown
      ? 'none'
      : view3d && extrudedShown
        ? 'extruded'
        : 'plan'
  const zonedIds = zoneDrawing === 'extruded' ? overlay.buildingIds : []
  // Zone edges in 3D, each drawn once, by a custom WebGL layer (decisions
  // 0034 and 0036).
  const edges = useMemo(
    () =>
      zoneDrawing === 'extruded'
        ? zoneEdges(
            overlay.cells.features,
            Object.fromEntries(
              overlay.buildingIds.map((id) => [id, buildings[id]?.footprint]),
            ),
          )
        : [],
    [zoneDrawing, overlay, buildings],
  )
  // Hollow floors stay pickable, so a click can choose another floor
  // (decision 0035).
  const zonePickIds: string[] =
    zoneDrawing === 'extruded'
      ? [ZONE_LAYER_IDS.extrusion, ZONE_LAYER_IDS.hollow]
      : zoneDrawing === 'plan'
        ? [ZONE_LAYER_IDS.fill]
        : []
  /** What a map feature is, as a hit for the nested selection rules. */
  const hitOf = (feature: Picked): MapHit | null => {
    const id: unknown = feature.properties.id
    if (typeof id !== 'string') return null
    if (zonePickIds.includes(feature.layer.id)) {
      const floor: unknown = feature.properties.floor
      const buildingId: unknown = feature.properties.buildingId
      return {
        kind: 'building',
        buildingId: typeof buildingId === 'string' ? buildingId : '',
        floor: typeof floor === 'number' ? floor : null,
        zoneId: id,
      }
    }
    const layer = byPickId.get(feature.layer.id)
    if (layer?.layer.kind === 'buildings') {
      return { kind: 'building', buildingId: id, floor: null, zoneId: null }
    }
    return layer ? { kind: 'grid', id } : null
  }
  // In 3D the map picks extruded buildings and zone cells itself (decision
  // 0036, M2 and M3): MapLibre 6 returns fill-extrusion hits farthest first,
  // and can leave out the face in front, so a click on a roof picked the
  // ground floor and a building behind another could win the click. The
  // pointer's ray is cast against every drawn prism and the hits are ordered
  // by where the ray first meets each; flat features keep MapLibre's hits,
  // as on the ground.
  const extrudedLayer = shown.find(
    (resolved) => resolved.layer.kind === 'buildings' && resolved.extruded,
  )
  const featuresAt = (
    features: Picked[],
    point: { x: number; y: number },
  ): Picked[] => {
    const map = mapRef.current?.getMap()
    if (!map || !(view3d && extrudedShown)) return features
    const center = map.getCenter()
    const ground = map.unproject([point.x, point.y])
    const ray = pointerRay(
      {
        center: [center.lng, center.lat],
        centerElevationM: map.getCenterElevation(),
        zoom: map.getZoom(),
        pitchDeg: map.getPitch(),
        bearingDeg: map.getBearing(),
        fovDeg: map.getVerticalFieldOfView(),
        heightPx: map.getCanvas().clientHeight,
      },
      [ground.lng, ground.lat],
      map.queryTerrainElevation(ground) ?? 0,
    )
    const liftOf = (ring: LngLat[]) => {
      const first = ring[0]
      return first ? (map.queryTerrainElevation(first) ?? 0) : 0
    }
    type Candidate = { item: Picked; prism: Prism | null }
    const candidates: Candidate[] = []
    if (zoneDrawing === 'extruded') {
      for (const cell of overlay.cells.features) {
        const ring = cell.geometry.coordinates[0] ?? []
        candidates.push({
          item: {
            layer: {
              id:
                cell.properties.state === 'hollow'
                  ? ZONE_LAYER_IDS.hollow
                  : ZONE_LAYER_IDS.extrusion,
            },
            properties: cell.properties,
          },
          prism: prismOf(
            ring,
            cell.properties.base,
            cell.properties.top,
            liftOf(ring),
          ),
        })
      }
    }
    if (extrudedLayer) {
      const zoned = new Set(zonedIds)
      for (const id of state.buildingIds) {
        const building = state.buildings[id]
        if (!building || zoned.has(id)) continue
        candidates.push({
          item: {
            layer: { id: extrudedLayer.pickId },
            properties: { id, name: building.name },
          },
          prism: prismOf(
            building.footprint,
            0,
            building.heightM ?? 0,
            liftOf(building.footprint),
          ),
        })
      }
    }
    // Flat features (grid lines and points) lie on the ground.
    const extruded = new Set([
      ...zonePickIds,
      ...shown.filter((each) => each.extruded).map((each) => each.pickId),
    ])
    for (const feature of features) {
      if (!extruded.has(feature.layer.id)) {
        candidates.push({ item: feature, prism: null })
      }
    }
    const hits = candidates.filter(
      ({ prism }) => prism === null || rayPrismDistance(ray, prism) !== null,
    )
    return sortByDistance(hits, ray, (candidate) => candidate.prism).map(
      (candidate) => candidate.item,
    )
  }
  const hitsOf = (features: Picked[] | undefined): MapHit[] =>
    (features ?? []).flatMap((feature) => {
      const hit = hitOf(feature)
      return hit ? [hit] : []
    })
  // A flat map shows one floor's plan: a hit on it is on that floor.
  const planFloor = view3d && extrudedShown ? null : overlay.planFloor
  const applyTarget = (target: MapTarget) => {
    if (target === null) return
    if (target === 'clear') {
      if (selection.ids.length > 0) {
        workbench.execute({ type: 'selection.clear', input: {} })
      }
    } else {
      workbench.execute({ type: 'selection.set', input: target })
    }
    // Choosing a map object shows it in Properties (decision 0030).
    showInspection()
  }
  /** Says in the status bar and Messages why a click or key changed nothing. */
  const reportNotice = (title: string, message: string) => {
    workbench.record({
      type: 'view.mapSelection',
      title,
      status: 'rejected',
      summary: '',
      issues: [{ path: 'selection', message }],
    })
  }
  // Escape goes up a level; Page Up and Page Down step between floors.
  const onMapKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const project = { selection, buildings, zoning }
    const delta =
      event.key === 'PageUp' ? 1 : event.key === 'PageDown' ? -1 : null
    const target =
      event.key === 'Escape'
        ? upTarget(project)
        : delta !== null
          ? stepTarget(project, delta)
          : undefined
    if (target === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (target === null) {
      const notice = delta !== null ? stepNotice(project, delta) : null
      if (notice) {
        reportNotice(
          delta === 1 ? 'Select the floor above' : 'Select the floor below',
          notice,
        )
      }
      return
    }
    if (target === 'clear') {
      workbench.execute({ type: 'selection.clear', input: {} })
    } else {
      workbench.execute({ type: 'selection.set', input: target })
    }
  }

  const buildingsGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: state.buildingIds.flatMap((id) => {
        const building = state.buildings[id]
        if (!building) return []
        return [
          {
            type: 'Feature' as const,
            id,
            properties: {
              id,
              name: building.name,
              ...Object.fromEntries(
                METRICS.map((metric) => [
                  metricProperty(metric.id),
                  metrics[metric.id].values[id] ?? -1,
                ]),
              ),
              height: building.heightM ?? 0,
            },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [building.footprint],
            },
          },
        ]
      }),
    }),
    [state.buildingIds, state.buildings, metrics],
  )

  const gridElements = Object.values(state.gridElements)
  const gridLines = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: gridElements
        .filter((element) => element.kind === 'line')
        .map((element) => ({
          type: 'Feature' as const,
          id: element.id,
          properties: { id: element.id, name: element.name },
          geometry: {
            type: 'LineString' as const,
            coordinates: element.coordinates,
          },
        })),
    }),
    [gridElements],
  )
  const gridPoints = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: gridElements
        .filter(
          (element) => POINT_KINDS.has(element.kind) && element.coordinates[0],
        )
        .filter((element) => element.kind !== 'bus' || element.id === 'BUS-SUB')
        .map((element) => ({
          type: 'Feature' as const,
          id: element.id,
          properties: {
            id: element.id,
            name: element.name,
            kind: element.kind,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: element.coordinates[0] ?? [0, 0],
          },
        })),
    }),
    [gridElements],
  )

  const bounds = useMemo(
    () =>
      boundsOf(
        state.buildingIds.flatMap((id) => state.buildings[id]?.footprint ?? []),
      ),
    [state.buildingIds, state.buildings],
  )

  // Fit once the map is ready and whenever the footprints change, unless
  // the view state holds a camera looking at them (decision 0036): a project
  // saved with its camera opens where it was left.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || !bounds) return
    const camera = view.getState().map.camera
    if (camera && cameraInside(camera, bounds)) {
      map.jumpTo(cameraOptions(camera, view.getState().map.view3d))
      return
    }
    // Keep footprints clear of the legend in the top-right corner.
    map.fitBounds(bounds, {
      padding: { top: 24, bottom: 40, left: 64, right: 232 },
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      duration: 0,
    })
  }, [loaded, bounds, view])

  // Tilt into 3D, or back to a flat north-up map, when map.set3d changes.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded) return
    map.easeTo({
      pitch: view3d ? 50 : 0,
      bearing: view3d ? -20 : 0,
      duration: 0,
    })
  }, [loaded, view3d])

  // The camera (decision 0036, L1): the map moves to it when a layout is
  // applied, a project opens, or map.setCamera asks; after the tilt above,
  // so a layout's own pitch wins. Every move the map makes is kept in the
  // view state, so the project saves it and layouts catch it.
  const cameraRequest = mapView.cameraRequest
  useEffect(() => {
    const map = mapRef.current?.getMap()
    const camera = view.getState().map.camera
    if (!map || !loaded || cameraRequest === 0 || !camera) return
    map.jumpTo(cameraOptions(camera, view.getState().map.view3d))
  }, [loaded, cameraRequest, view])
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded) return
    const keep = () => {
      const center = map.getCenter()
      view.execute(
        {
          type: 'map.syncCamera',
          input: {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
          },
        },
        'system',
        { record: false },
      )
    }
    map.on('moveend', keep)
    return () => {
      map.off('moveend', keep)
    }
  }, [loaded, view])

  // Zoom to the shared selection when a map.focusSelection operation asks for
  // it. The request often arrives with a layout change, so wait two frames for
  // the docked container to settle and resize the canvas before fitting.
  const focusRequest = mapView.focusRequest
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || focusRequest === handledFocusRequest.current) return
    const selection = workbench.getState().selection
    const owners = selectedBuildingIds(selection)
    const points =
      owners.length > 0
        ? owners.flatMap((id) => state.buildings[id]?.footprint ?? [])
        : selection.ids.flatMap(
            (id) => state.gridElements[id]?.coordinates ?? [],
          )
    const target = boundsOf(points)
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        handledFocusRequest.current = focusRequest
        if (!target) return
        map.resize()
        // Tilted, buildings rise towards the top: leave them room there and
        // stop a little further out, so a zoned building's storeys show.
        const tilted = map.getPitch() > 0
        map.fitBounds(target, {
          padding: {
            top: tilted ? 120 : 48,
            bottom: 48,
            left: 64,
            right: 232,
          },
          maxZoom: tilted ? 17.5 : 18,
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          duration: 0,
        })
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest, loaded, workbench, state.buildings, state.gridElements])

  // In 3D the outline follows each selected building's visible silhouette
  // instead of its footprint (decision 0013).
  const selectedPrisms = useMemo<SilhouettePrism[]>(
    () =>
      selectedBuildingIds(selection).flatMap((id) => {
        const building = state.buildings[id]
        return building
          ? [
              {
                footprint: building.footprint,
                heightM: building.heightM ?? 0,
              },
            ]
          : []
      }),
    [selection, state.buildings],
  )

  // Mirror the shared selection into feature state.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded) return
    const apply = () => {
      for (const source of ['buildings', 'grid-lines', 'grid-points']) {
        if (map.getSource(source)) map.removeFeatureState({ source })
      }
      // A selected floor or zone marks its building too.
      if (map.getSource('buildings')) {
        for (const id of selectedBuildingIds(selection)) {
          map.setFeatureState({ source: 'buildings', id }, { selected: true })
        }
      }
      if (selection.entityType === 'gridElement') {
        for (const id of selection.ids) {
          for (const source of ['grid-lines', 'grid-points']) {
            if (map.getSource(source)) {
              map.setFeatureState({ source, id }, { selected: true })
            }
          }
        }
      }
    }
    apply()
    // Sources can be re-added after data or style updates; apply again once
    // the map has settled so the selection is not lost.
    map.once('idle', apply)
    return () => {
      map.off('idle', apply)
    }
  }, [
    loaded,
    selection,
    buildingsGeoJson,
    gridLines,
    gridPoints,
    stack,
    mapStyle,
  ])

  // Draw the stack in its order: lift each layer to the top, bottom first.
  // Layers added later (a new layer, a style swap) land on top, so the order
  // is applied again once the map settles.
  // Zones draw above the whole stack.
  const order = [
    ...stack.flatMap((resolved) => [...resolved.mapIds].reverse()).reverse(),
    ...zoneLayerIds(zoneDrawing),
  ].join('|')
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded) return
    const apply = () => {
      for (const id of order.split('|')) {
        if (id && map.getLayer(id)) map.moveLayer(id)
      }
    }
    apply()
    map.on('idle', apply)
    return () => {
      map.off('idle', apply)
    }
  }, [loaded, order, mapStyle])

  /** The hover label: what a click at the pointer would select. */
  const hoverOf = (at: Pointer): Hover | null => {
    const feature = at.features[0]
    const id: unknown = feature?.properties?.id
    if (typeof id !== 'string') return null
    const project = { selection, buildings, zoning }
    const { target, label: named } = describeClick(
      project,
      hitsOf(at.features),
      { additive: at.shift, planFloor },
    )
    const layer = byPickId.get(feature?.layer.id ?? '')
    const name: unknown = feature?.properties.name
    const label =
      target !== null &&
      target !== 'clear' &&
      target.entityType === 'building' &&
      target.ids.length === 1 &&
      layer?.metric &&
      layer.values
        ? `${id}: ${formatValue(layer.values.values[id] ?? null, layer.metric.unit)}`
        : named || (typeof name === 'string' ? name : id)
    return { id, label, x: at.x, y: at.y }
  }
  const hover = pointer ? hoverOf(pointer) : null

  // The hover label follows what is under a pointer that has not moved
  // (decision 0036): after Page Up, Page Down, Escape, or a click the map
  // draws other cells there, so once it has drawn them the hits are queried
  // again; and Shift pressed or released changes what a click would do.
  const interactiveIds = [
    ...zonePickIds,
    ...shown.map((resolved) => resolved.pickId),
  ]
  const pointerRef = useRef(pointer)
  const requery = useRef<() => void>(() => {})
  // The latest pointer and query, for the map's idle event.
  useLayoutEffect(() => {
    pointerRef.current = pointer
    requery.current = () => {
      const map = mapRef.current?.getMap()
      const at = pointerRef.current
      if (!map || !at) return
      const layers = interactiveIds.filter((id) => map.getLayer(id))
      const features =
        layers.length > 0
          ? map.queryRenderedFeatures([at.x, at.y], { layers })
          : []
      setPointer({ ...at, features: featuresAt(features, at) })
    }
  })
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || !pointerRef.current) return
    const run = () => requery.current()
    map.once('idle', run)
    // A map with nothing new to draw stays idle: query now as well.
    if (map.loaded()) run()
    return () => {
      map.off('idle', run)
    }
  }, [loaded, overlay, zoneDrawing, planFloor])
  useEffect(() => {
    const onShift = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Shift') return
      setPointer((at) =>
        at && at.shift !== event.shiftKey
          ? { ...at, shift: event.shiftKey }
          : at,
      )
    }
    const onBlur = () =>
      setPointer((at) => (at?.shift ? { ...at, shift: false } : at))
    window.addEventListener('keydown', onShift)
    window.addEventListener('keyup', onShift)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onShift)
      window.removeEventListener('keyup', onShift)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (state.buildingIds.length === 0) {
    return (
      <section
        className={styles.page}
        aria-labelledby={headingId}
        onPointerDown={() => claimWorked('map')}
      >
        <header className={styles.header}>
          <h2 id={headingId}>Map</h2>
          <CapabilityBadge id="map.view" />
        </header>
        <EmptyState
          title="No footprints yet"
          message="The map shows synthetic building footprints once the first workflow stage has captured them."
          stageId={STAGE_IDS.location}
        />
      </section>
    )
  }

  const ink = palette.ink
  const ramp = palette.sequential

  return (
    <section
      ref={pageRef}
      className={styles.page}
      aria-labelledby={headingId}
      onPointerDown={() => claimWorked('map')}
    >
      <header className={styles.header}>
        <h2 id={headingId}>Map</h2>
        <CapabilityBadge id="map.view" />
      </header>

      {/* Keys reach here from the focused map canvas (decision 0035). */}
      <div className={styles.mapArea} onKeyDown={onMapKey}>
        <MapView
          ref={mapRef}
          mapStyle={mapStyle}
          initialViewState={{
            longitude: DISTRICT_CENTER[0],
            latitude: DISTRICT_CENTER[1],
            zoom: 15,
          }}
          style={{ width: '100%', height: '100%' }}
          // Shift-click adds to the selection (decision 0035), so Shift-drag
          // box zoom, which swallows Shift-clicks, is off.
          boxZoom={false}
          // 2D stays flat and north-up; 3D allows tilting.
          maxPitch={view3d ? 70 : 0}
          interactiveLayerIds={interactiveIds}
          onLoad={() => setLoaded(true)}
          onError={(event) => {
            // Tile and TileJSON failures name their source. Fall back to the
            // plain background rather than show an empty basemap.
            const { sourceId } = event as unknown as { sourceId?: string }
            if (sourceId === BASEMAP_SOURCE_ID) basemap.reportTileFailure()
            if (
              sourceId === TERRAIN_SOURCE_ID ||
              sourceId === HILLSHADE_SOURCE_ID
            ) {
              terrain.reportFailure()
            }
          }}
          onMouseMove={(event) => {
            // The label names what a click would select at this level.
            // The position is kept without hits too, so the label can be
            // queried again where the pointer rests.
            setPointer({
              features: featuresAt(event.features ?? [], event.point),
              x: event.point.x,
              y: event.point.y,
              shift: event.originalEvent.shiftKey,
            })
          }}
          onMouseLeave={() => setPointer(null)}
          onClick={(event) => {
            // Nested selection (decision 0035): building, then floor, then
            // zone. An empty spot selects the map itself: Properties then
            // shows the map's own properties (decision 0030).
            const project = { selection, buildings, zoning }
            const hits = hitsOf(featuresAt(event.features ?? [], event.point))
            const options = {
              additive: event.originalEvent.shiftKey,
              planFloor,
            }
            const notice = clickNotice(project, hits, options)
            if (notice) {
              reportNotice('Select on the map', notice)
              return
            }
            applyTarget(clickTarget(project, hits, options))
          }}
        >
          {/* Control options apply at creation, so remount when 3D changes. */}
          <NavigationControl
            key={view3d ? '3d' : '2d'}
            position="top-left"
            showCompass={view3d}
            visualizePitch={view3d}
          />
          {/* Terrain sources stay mounted and fetch nothing until terrain or
              hillshade uses them; retry recreates them. */}
          <Source
            key={`terrain-${terrain.attempt}`}
            id={TERRAIN_SOURCE_ID}
            type="raster-dem"
            tiles={[TERRAIN_TILES_URL]}
            tileSize={TERRAIN_TILE_SIZE}
            maxzoom={TERRAIN_MAX_ZOOM}
            encoding="terrarium"
            attribution={TERRAIN_ATTRIBUTION}
          />
          <Source
            key={`hillshade-${terrain.attempt}`}
            id={HILLSHADE_SOURCE_ID}
            type="raster-dem"
            tiles={[TERRAIN_TILES_URL]}
            tileSize={TERRAIN_TILE_SIZE}
            maxzoom={TERRAIN_MAX_ZOOM}
            encoding="terrarium"
          >
            <Layer
              id="terrain-hillshade"
              type="hillshade"
              beforeId={labelLayerId}
              layout={{ visibility: terrain.active ? 'visible' : 'none' }}
              paint={hillshadePaint(appearance, scene.illuminationDirectionDeg)}
            />
          </Source>
          {/* Seen whole, a light basemap reads as glare; this dims the globe
              and fades out before the district (decision 0019). */}
          {globeDim > 0 ? (
            <Layer
              id="globe-dim"
              type="background"
              beforeId={labelLayerId}
              paint={{
                'background-color': appearance.data.sky.night,
                'background-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  ...GLOBE_DIM_STOPS.flatMap(([zoom, share]) => [
                    zoom,
                    globeDim * share,
                  ]),
                ] as unknown as ExpressionSpecification,
              }}
            />
          ) : null}
          <Source
            id="buildings"
            type="geojson"
            data={buildingsGeoJson}
            attribution={FOOTPRINT_ATTRIBUTION}
            promoteId="id"
          />
          <Source id={ZONE_SOURCE} type="geojson" data={overlay.cells} />
          <Source
            id="grid-lines"
            type="geojson"
            data={gridLines}
            promoteId="id"
          />
          <Source
            id="grid-points"
            type="geojson"
            data={gridPoints}
            promoteId="id"
          />
          {/* Bottom first, so layers added together stack in order. */}
          {[...stack].reverse().map((resolved) => (
            <StackLayer
              key={resolved.layer.id}
              resolved={resolved}
              palette={palette}
              zonedIds={zonedIds}
            />
          ))}
          <ZoneLayers
            drawing={zoneDrawing}
            planFloor={overlay.planFloor}
            palette={palette}
          />
        </MapView>

        <ZoneEdgeLayer
          mapRef={mapRef}
          loaded={loaded}
          enabled={zoneDrawing === 'extruded'}
          edges={edges}
          envelopeColor={palette.zoneEdges.envelope}
          boundaryColor={palette.zoneEdges.boundary}
          selectedColor={palette.selection}
          hollowAlpha={palette.hollow.edgeAlpha}
        />

        <SelectionSilhouette
          mapRef={mapRef}
          loaded={loaded}
          enabled={view3d && extrudedShown}
          prisms={selectedPrisms}
          selectionColor={palette.selection}
          haloColor={ink.surface}
        />

        {hover ? (
          <div
            className={styles.tooltip}
            style={{ left: hover.x + 12, top: hover.y + 12 }}
            aria-hidden="true"
          >
            {hover.label}
          </div>
        ) : null}

        <div className={styles.legend} aria-label="Map legend" role="group">
          {shown.length === 0 ? (
            <p className={styles.legendRow}>No layers shown.</p>
          ) : null}
          {shown.map((resolved) => (
            <LegendBlock
              key={resolved.layer.id}
              resolved={resolved}
              palette={palette}
              ramp={ramp}
              view3d={view3d}
            />
          ))}
          {zoneDrawing !== 'none' ? (
            <ZoneLegend
              overlay={overlay}
              drawing={zoneDrawing}
              palette={palette}
            />
          ) : null}
          {terrainEnabled ? (
            <p className={styles.legendRow}>
              Terrain: {exaggerationLabel(exaggeration)} (Mapterhorn, USGS 3DEP)
            </p>
          ) : null}
        </div>
      </div>

      <footer className={styles.footer}>
        <span
          role="status"
          data-testid="basemap-status"
          className={styles.basemapStatus}
        >
          {basemap.status === 'loading'
            ? 'Loading the OpenFreeMap basemap…'
            : basemap.status === 'failed'
              ? "Basemap unavailable: footprints are shown on a plain background. It can be turned off in the map's Properties."
              : ''}
        </span>
        {basemap.status === 'failed' ? (
          <ActionButton
            label="Try loading the basemap again"
            disabledReason={null}
            onPress={basemap.retry}
          >
            Retry basemap
          </ActionButton>
        ) : null}
        <span
          role="status"
          data-testid="terrain-status"
          className={styles.basemapStatus}
        >
          {terrain.status === 'loading'
            ? 'Loading terrain…'
            : terrain.status === 'failed'
              ? 'Terrain unavailable: the map is shown flat.'
              : ''}
        </span>
        {terrain.status === 'failed' ? (
          <ActionButton
            label="Try loading terrain again"
            disabledReason={null}
            onPress={terrain.retry}
          >
            Retry terrain
          </ActionButton>
        ) : null}
      </footer>
      {/* Not shown, at the owner's request; kept for screen readers, which
          cannot read the canvas. */}
      <p className="visually-hidden">
        The map canvas is not available to screen readers; the Table page lists
        the same buildings and shares the selection.
        {view3d
          ? ' With the map focused, Shift+arrow keys rotate and tilt it.'
          : ''}{' '}
        With a floor or zone selected and the map focused, Escape selects the
        level above, and Page Up and Page Down select the floor above or below.
      </p>
    </section>
  )
}

/** One visible layer in the map's legend (decision 0031). */
function LegendBlock({
  resolved,
  palette,
  ramp,
  view3d,
}: {
  resolved: ResolvedLayer
  palette: DataPalette
  ramp: readonly string[]
  view3d: boolean
}) {
  const { layer, metric, values } = resolved
  if (layer.kind === 'gridLines') {
    return (
      <p className={styles.legendRow}>
        <span
          className={styles.lineKey}
          style={{ background: palette.networkLine }}
        />{' '}
        {layer.name}: feeder lines
      </p>
    )
  }
  if (layer.kind === 'gridPoints') {
    return (
      <p className={styles.legendRow}>
        <span
          className={styles.dotKey}
          style={{ background: palette.networkPoint }}
        />{' '}
        {layer.name}: transformers, substation, utility PV
      </p>
    )
  }
  return (
    <div className={styles.legendBlock}>
      <p className={styles.legendTitle}>
        <span>
          {layer.name}
          {metric
            ? `: ${metric.label}${metric.unit ? ` (${metric.unit})` : ''}${values?.scenarioName ? `, ${values.scenarioName}` : ''}`
            : ''}
        </span>
        {metric ? <StatusTag status="simulated" /> : null}
      </p>
      {metric && values ? (
        <>
          <div
            className={styles.ramp}
            style={{
              background: `linear-gradient(to right, ${ramp.join(', ')})`,
            }}
          />
          <div className={styles.rampLabels}>
            <span>{formatValue(values.min, '')}</span>
            <span>{formatValue(values.max, '')}</span>
          </div>
          <p className={styles.legendRow}>
            <span
              className={styles.swatch}
              style={{ background: palette.noData }}
            />{' '}
            No data
          </p>
        </>
      ) : (
        <p className={styles.legendRow}>
          <span
            className={styles.swatch}
            style={{ background: palette.categorical[0] }}
          />{' '}
          One color
        </p>
      )}
      {view3d && resolved.extruded ? (
        <p className={styles.legendRow}>Height: floors × 3.2 m (synthetic)</p>
      ) : null}
    </div>
  )
}

const ZONE_LEGEND_LABELS: Record<ZoneKind, string> = {
  building: 'Whole building',
  floor: 'Whole floors',
  perimeter: 'Perimeter zones',
  core: 'Core',
  drawn: 'Drawn zones',
}

/** The selected buildings' zones in the legend (decision 0032, stage 6). */
function ZoneLegend({
  overlay,
  drawing,
  palette,
}: {
  overlay: ZoneOverlay
  drawing: ZoneDrawing
  palette: DataPalette
}) {
  const many = overlay.buildingIds.length > 1
  const colorOf = (slot: number) =>
    slot < 0
      ? palette.deemphasis
      : (palette.categorical[slot] ?? palette.deemphasis)
  return (
    <div className={styles.legendBlock} data-testid="zone-legend">
      <p className={styles.legendTitle}>
        <span>
          Zones of{' '}
          {many
            ? `${overlay.buildingIds.length} selected buildings`
            : overlay.buildingIds[0]}
          {drawing === 'plan' ? `, floor ${overlay.planFloor}` : ''}
        </span>
      </p>
      {overlay.geometry ? (
        <p className={styles.legendRow}>
          Zone geometry: precomputed in the fixture (synthetic), standing in for
          the backend.
        </p>
      ) : null}
      {drawing === 'extruded' ? (
        <>
          <p className={styles.legendRow}>
            <span
              className={styles.lineKey}
              style={{ background: palette.zoneEdges.envelope }}
            />{' '}
            Building edges
          </p>
          <p className={styles.legendRow}>
            <span
              className={styles.swatch}
              // A boundary line between two zone colours.
              style={{
                background: `linear-gradient(to right, ${palette.categorical[0]} 0 40%, ${palette.zoneEdges.boundary} 40% 60%, ${palette.categorical[1]} 60%)`,
              }}
            />{' '}
            Lines between zones
          </p>
        </>
      ) : null}
      {overlay.focus ? (
        <p className={styles.legendRow}>
          {overlay.focus.level === 'building zone' ? (
            <>
              Whole-building zone of {overlay.focus.buildingId} selected, on
              every floor.
            </>
          ) : (
            <>
              {overlay.focus.level === 'zone' ? 'Zone on floor' : 'Floor'}
              {overlay.focus.floors.length > 1 ? 's' : ''}{' '}
              {overlay.focus.floors.join(', ')} of {overlay.focus.buildingId}{' '}
              selected
              {drawing === 'extruded' && overlay.hollow
                ? '; its other floors are drawn hollow.'
                : '.'}
            </>
          )}
        </p>
      ) : null}
      {drawing === 'extruded' && overlay.hollow ? (
        <p className={styles.legendRow}>
          <span
            className={styles.swatch}
            // A faint fill in a full-strength outline: the shell.
            style={{
              background: `color-mix(in srgb, ${palette.deemphasis} ${Math.round(palette.hollow.opacity * 100)}%, transparent)`,
              outline: `1px solid ${palette.deemphasis}`,
              outlineOffset: -1,
            }}
          />{' '}
          Hollow floors
        </p>
      ) : null}
      {/* One row per kind of zone drawn, with the colours its cells use. */}
      {overlay.legend.map((row) => (
        <p key={row.kind} className={styles.legendRow}>
          {row.slots.map((slot) => (
            <span
              key={slot}
              className={styles.swatch}
              style={{ background: colorOf(slot) }}
            />
          ))}{' '}
          {ZONE_LEGEND_LABELS[row.kind]}
        </p>
      ))}
      <p className={styles.legendRow}>
        <span
          className={styles.swatch}
          // A zone keeps its colour; the selection colour outlines it.
          style={{
            background: palette.categorical[0],
            outline: `2px solid ${palette.selection}`,
            outlineOffset: -2,
          }}
        />{' '}
        Selected floor or zone, outlined
      </p>
      {overlay.omitted > 0 ? (
        <p className={styles.legendRow}>
          Zones of {overlay.omitted} more selected buildings are not drawn.
        </p>
      ) : null}
    </div>
  )
}
