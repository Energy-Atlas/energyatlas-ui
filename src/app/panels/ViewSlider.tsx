import { useState, type ReactNode } from 'react'
import {
  Label,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
} from 'react-aria-components'
import { useServices } from '../WorkbenchContext.tsx'
import formStyles from '../components/forms.module.css'
import type { ViewOperation } from '../view/viewOperations.ts'

// A slider over one view setting of the map's Properties: the draft stays
// local while dragging and one view operation is logged on release.

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

export function ViewSlider({
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
