import {
  Layer,
  Map as MapView,
  NavigationControl,
  Source,
  type MapRef,
} from '@vis.gl/react-maplibre'
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { DISTRICT_CENTER } from '../../domain/simulation.ts'
import type { LngLat } from '../../domain/types.ts'
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

const POINT_KINDS = new Set(['transformer', 'utilityPv', 'bus'])

type Hover = { id: string; label: string; x: number; y: number }

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

function formatValue(value: number | null, unit: string): string {
  return formatNumber(value, { maxDigits: 3, unit: unit || undefined })
}

export function MapPage() {
  const headingId = useId()
  const { workbench, showInspection, basemapEnabled, claimWorked } =
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
  const [hover, setHover] = useState<Hover | null>(null)

  const metrics = useMemo(
    () =>
      Object.fromEntries(
        METRICS.map((metric) => [metric.id, computeMetric(state, metric.id)]),
      ) as Record<MetricId, ReturnType<typeof computeMetric>>,
    [state],
  )
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

  // Fit once the map is ready and whenever the footprints change.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || !bounds) return
    // Keep footprints clear of the legend in the top-right corner.
    map.fitBounds(bounds, {
      padding: { top: 24, bottom: 40, left: 64, right: 232 },
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      duration: 0,
    })
  }, [loaded, bounds])

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

  // Zoom to the shared selection when a map.focusSelection operation asks for
  // it. The request often arrives with a layout change, so wait two frames for
  // the docked container to settle and resize the canvas before fitting.
  const focusRequest = mapView.focusRequest
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || focusRequest === handledFocusRequest.current) return
    const { entityType, ids } = workbench.getState().selection
    const points =
      entityType === 'building'
        ? ids.flatMap((id) => state.buildings[id]?.footprint ?? [])
        : ids.flatMap((id) => state.gridElements[id]?.coordinates ?? [])
    const target = boundsOf(points)
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        handledFocusRequest.current = focusRequest
        if (!target) return
        map.resize()
        map.fitBounds(target, {
          padding: { top: 48, bottom: 48, left: 64, right: 232 },
          maxZoom: 18,
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          duration: 0,
        })
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest, loaded, workbench, state.buildings, state.gridElements])

  const selection = state.selection
  // In 3D the outline follows each selected building's visible silhouette
  // instead of its footprint (decision 0013).
  const selectedPrisms = useMemo<SilhouettePrism[]>(
    () =>
      selection.entityType === 'building'
        ? selection.ids.flatMap((id) => {
            const building = state.buildings[id]
            return building
              ? [
                  {
                    footprint: building.footprint,
                    heightM: building.heightM ?? 0,
                  },
                ]
              : []
          })
        : [],
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
      if (selection.entityType === 'building' && map.getSource('buildings')) {
        for (const id of selection.ids) {
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
  const order = stack
    .flatMap((resolved) => [...resolved.mapIds].reverse())
    .reverse()
    .join('|')
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

      <div className={styles.mapArea}>
        <MapView
          ref={mapRef}
          mapStyle={mapStyle}
          initialViewState={{
            longitude: DISTRICT_CENTER[0],
            latitude: DISTRICT_CENTER[1],
            zoom: 15,
          }}
          style={{ width: '100%', height: '100%' }}
          // 2D stays flat and north-up; 3D allows tilting.
          maxPitch={view3d ? 70 : 0}
          interactiveLayerIds={shown.map((resolved) => resolved.pickId)}
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
            const feature = event.features?.[0]
            const id: unknown = feature?.properties?.id
            if (typeof id !== 'string') {
              setHover(null)
              return
            }
            const layer = byPickId.get(feature?.layer.id ?? '')
            const label =
              layer?.metric && layer.values
                ? `${id}: ${formatValue(layer.values.values[id] ?? null, layer.metric.unit)}`
                : `${String(feature?.properties?.name ?? id)}`
            setHover({ id, label, x: event.point.x, y: event.point.y })
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => {
            const feature = event.features?.[0]
            const id: unknown = feature?.properties?.id
            if (typeof id !== 'string') {
              // An empty spot selects the map itself: Properties then shows
              // the map's own properties (decision 0030).
              if (selection.ids.length > 0) {
                workbench.execute({ type: 'selection.clear', input: {} })
              }
              showInspection()
              return
            }
            const entityType =
              byPickId.get(feature?.layer.id ?? '')?.layer.kind === 'buildings'
                ? 'building'
                : 'gridElement'
            const additive =
              event.originalEvent.shiftKey &&
              selection.entityType === entityType
            const ids = additive
              ? selection.ids.includes(id)
                ? selection.ids.filter((selected) => selected !== id)
                : [...selection.ids, id]
              : [id]
            workbench.execute({
              type: 'selection.set',
              input: { entityType, ids },
            })
            // Choosing a map object shows it in Properties (decision 0030).
            showInspection()
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
            />
          ))}
        </MapView>

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
          : ''}
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
