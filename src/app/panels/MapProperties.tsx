import { useId } from 'react'
import { Checkbox } from 'react-aria-components'
import { DISTRICT_CENTER } from '../../domain/simulation.ts'
import {
  useAppearance,
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { Section } from '../components/Section.tsx'
import formStyles from '../components/forms.module.css'
import {
  buildLightingScene,
  LIGHTING_LIMITS,
  lightingSummary,
} from '../pages/lighting.ts'
import { dayOfYearLabel, timeOfDayLabel } from '../pages/sunPosition.ts'
import {
  exaggerationLabel,
  MAX_EXAGGERATION,
  MIN_EXAGGERATION,
} from '../pages/terrain.ts'
import { MapLayersSection } from './MapLayers.tsx'
import styles from './inspection.module.css'
import { ViewSlider } from './ViewSlider.tsx'

// The map's own properties, shown in Properties while the map is the surface
// being worked in and nothing is selected (decision 0018): its layers, then
// the basemap and the scene drawn over it (decisions 0030 and 0031).

const percent = (value: number) => `${value}%`

export function MapProperties() {
  const headingId = useId()
  const appearance = useAppearance()
  const { view, basemapEnabled, setBasemapEnabled } = useServices()
  const mapView = useViewState((state) => state.map)
  const hasHeights = useWorkbenchSnapshot((snapshot) =>
    snapshot.state.buildingIds.some(
      (id) => (snapshot.state.buildings[id]?.heightM ?? null) !== null,
    ),
  )
  const { lighting, view3d, terrain } = mapView
  const scene = buildLightingScene(
    lighting,
    appearance,
    DISTRICT_CENTER[1],
    DISTRICT_CENTER[0],
  )
  const limits = LIGHTING_LIMITS

  return (
    <section className={styles.panel} aria-label="Properties" tabIndex={0}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Map</p>
        <h3 id={headingId} className={styles.title}>
          Map properties
        </h3>
      </header>

      <MapLayersSection />

      <section className={styles.section} aria-label="Basemap">
        <h4>Basemap</h4>
        <div className={styles.controls}>
          <Checkbox
            className={formStyles.checkbox}
            isSelected={basemapEnabled}
            onChange={setBasemapEnabled}
          >
            OpenFreeMap basemap
          </Checkbox>
          <Checkbox
            className={formStyles.checkbox}
            isSelected={view3d}
            onChange={(enabled) =>
              view.execute({ type: 'map.set3d', input: { enabled } })
            }
          >
            3D view
          </Checkbox>
          {view3d && !hasHeights ? (
            <p className={styles.muted} data-testid="map-3d-note">
              Heights appear after &ldquo;Geospatial preprocessing&rdquo; runs;
              until then extruded building layers stay flat.
            </p>
          ) : null}
          <Checkbox
            className={formStyles.checkbox}
            isSelected={terrain}
            isDisabled={!view3d && !terrain}
            onChange={(enabled) =>
              view.execute({ type: 'map.setTerrain', input: { enabled } })
            }
          >
            {view3d ? 'Terrain' : 'Terrain (3D only)'}
          </Checkbox>
          {terrain && view3d ? (
            <ViewSlider
              label="Terrain exaggeration"
              value={mapView.terrainExaggeration}
              min={MIN_EXAGGERATION}
              max={MAX_EXAGGERATION}
              step={1}
              format={exaggerationLabel}
              operation={(exaggeration) => ({
                type: 'map.setTerrainExaggeration',
                input: { exaggeration },
              })}
            />
          ) : null}
          {terrain && !view3d ? (
            <p className={styles.muted} data-testid="map-terrain-note">
              Terrain is on but paused: a flat map shows no relief. Turn on the
              &ldquo;3D view&rdquo; to see it again.
            </p>
          ) : null}

          <Section title="Sun position" id="map.sunPosition" level={4}>
            <div className={styles.controls}>
              <ViewSlider
                label="Season"
                value={lighting.dayOfYear}
                min={limits.dayOfYear.min}
                max={limits.dayOfYear.max}
                step={1}
                format={dayOfYearLabel}
                operation={(dayOfYear) => ({
                  type: 'map.setSeason',
                  input: { dayOfYear },
                })}
              />
              <ViewSlider
                label="Time of day"
                value={lighting.minutesUtc}
                min={limits.minutesUtc.min}
                max={limits.minutesUtc.max}
                step={10}
                format={timeOfDayLabel}
                operation={(minutesUtc) => ({
                  type: 'map.setTimeOfDay',
                  input: { minutesUtc },
                })}
                description="The sun follows the season, the time, and where the district is."
              />
            </div>
          </Section>

          <Section title="Light and haze" id="map.light" level={4}>
            <div className={styles.controls}>
              <ViewSlider
                label="Horizon haze"
                value={lighting.hazePercent}
                min={limits.hazePercent.min}
                max={limits.hazePercent.max}
                step={5}
                format={percent}
                operation={(value) => ({
                  type: 'map.setHaze',
                  input: { percent: value },
                })}
                description="Dust and occlusion at the horizon, which thickens the fog and dims the light."
              />
              <ViewSlider
                label="Sun intensity"
                value={lighting.intensityPercent}
                min={limits.intensityPercent.min}
                max={limits.intensityPercent.max}
                step={5}
                format={percent}
                operation={(value) => ({
                  type: 'map.setLightIntensity',
                  input: { percent: value },
                })}
              />
              <ViewSlider
                label="Sun diffusion"
                value={lighting.diffusionPercent}
                min={limits.diffusionPercent.min}
                max={limits.diffusionPercent.max}
                step={5}
                format={percent}
                operation={(value) => ({
                  type: 'map.setSunDiffusion',
                  input: { percent: value },
                })}
                description="A softer sun widens the change from day to night and spreads the glow around the horizon. It is not an area light: MapLibre casts no shadows."
              />
            </div>
          </Section>
          <p className={styles.muted}>
            <CapabilityBadge id="map.lighting" /> The scene is{' '}
            {lightingSummary(scene)}.
            {view3d
              ? ''
              : ' Turn on the 3D view to see it lit; a flat map shows no sky or shading.'}
          </p>
        </div>
      </section>
    </section>
  )
}
