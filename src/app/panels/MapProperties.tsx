import { useId, useState, type ReactNode } from 'react'
import {
  Label,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
} from 'react-aria-components'
import { DISTRICT_CENTER } from '../../domain/simulation.ts'
import {
  useAppearance,
  useServices,
  useViewState,
} from '../WorkbenchContext.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import formStyles from '../components/forms.module.css'
import {
  buildLightingScene,
  LIGHTING_LIMITS,
  lightingSummary,
} from '../pages/lighting.ts'
import { dayOfYearLabel, timeOfDayLabel } from '../pages/sunPosition.ts'
import type { ViewOperation } from '../view/viewOperations.ts'
import styles from './inspection.module.css'

// The map's own properties, shown in Properties while the map is the surface
// being worked in and nothing is selected (decision 0018).

type ControlProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Formats the live value while dragging. */
  format: (value: number) => string
  /** Built when the drag ends, so one operation is logged per change. */
  operation: (value: number) => ViewOperation
  description?: ReactNode
}

function LightingSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  operation,
  description,
}: ControlProps) {
  const { view } = useServices()
  // The draft stays local; the view operation is logged on release.
  const [draft, setDraft] = useState<number | null>(null)
  return (
    <Slider
      className={formStyles.slider}
      value={draft ?? value}
      minValue={min}
      maxValue={max}
      step={step}
      onChange={(next: number | number[]) => {
        setDraft(Array.isArray(next) ? (next[0] ?? value) : next)
      }}
      onChangeEnd={(next: number | number[]) => {
        setDraft(null)
        const chosen = Array.isArray(next) ? (next[0] ?? value) : next
        if (chosen !== value) view.execute(operation(chosen))
      }}
    >
      <Label className={formStyles.label}>{label}</Label>
      <SliderOutput className={formStyles.description}>
        {({ state }) => format(state.getThumbValue(0))}
      </SliderOutput>
      <SliderTrack className={formStyles.sliderTrack}>
        {({ state }) => (
          <>
            <div
              className={formStyles.sliderFill}
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
            <SliderThumb className={formStyles.sliderThumb} />
          </>
        )}
      </SliderTrack>
      {description ? (
        <p className={formStyles.description}>{description}</p>
      ) : null}
    </Slider>
  )
}

const percent = (value: number) => `${value}%`

export function MapProperties() {
  const headingId = useId()
  const appearance = useAppearance()
  const mapView = useViewState((state) => state.map)
  const lighting = mapView.lighting
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
          Scene lighting
        </h3>
      </header>

      <section className={styles.section} aria-label="Scene">
        <p className={styles.provenanceNote}>
          <CapabilityBadge id="map.lighting" />
        </p>
        <p className={styles.muted}>
          The scene is {lightingSummary(scene)}.
          {mapView.view3d
            ? ''
            : ' Turn on 3D buildings to see it lit; a flat map shows no sky or shading.'}
        </p>
      </section>

      <section className={styles.section} aria-label="Sun position">
        <h4>Position</h4>
        <LightingSlider
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
        <LightingSlider
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
      </section>

      <section className={styles.section} aria-label="Light">
        <h4>Light</h4>
        <LightingSlider
          label="Intensity"
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
        <LightingSlider
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
        <LightingSlider
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
      </section>
    </section>
  )
}
