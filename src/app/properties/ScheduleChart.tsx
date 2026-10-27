import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../cx.ts'
import styles from './schedule.module.css'

const WIDTH = 480
const HEIGHT = 168
const LEFT = 28
const RIGHT = 8
const TOP = 10
const BOTTOM = 26
const PLOT_W = WIDTH - LEFT - RIGHT
const PLOT_H = HEIGHT - TOP - BOTTOM
const STEP = PLOT_W / 24

/** Dragging and the arrow keys move a value in steps of 0.05; Shift gives 0.01. */
const COARSE = 0.05
const FINE = 0.01

function x(hour: number): number {
  return LEFT + (hour + 0.5) * STEP
}

function y(value: number): number {
  return TOP + (1 - value) * PLOT_H
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function snap(value: number, step: number): number {
  return Math.round(clamp(value) / step) * step
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A stepped line through 24 hourly values, each hour a flat segment. */
function stepPath(values: number[]): string {
  return values
    .map((value, hour) => {
      const v = Number.isFinite(value) ? clamp(value) : 0
      const start = LEFT + hour * STEP
      return `${hour === 0 ? 'M' : 'L'}${start},${y(v)} L${start + STEP},${y(v)}`
    })
    .join(' ')
}

type ScheduleChartProps = {
  /** Names the day profile, such as "Weekday". */
  label: string
  values: number[]
  /** The saved values, drawn faintly behind edits; null when creating. */
  saved: number[] | null
  /** Shows the values without letting them change, as for a library entry. */
  readOnly?: boolean
  onChange: (hour: number, value: number) => void
}

/**
 * One day profile as 24 points on a stepped line (decision 0028). Drag a
 * point up or down, or focus the chart and use the arrow keys: Left and
 * Right move between hours, Up and Down change the value (Shift for finer
 * steps), Home and End set 0 and 1. Edited hours are filled; the saved
 * shape stays behind them as a dashed line.
 */
export function ScheduleChart({
  label,
  values,
  saved,
  readOnly = false,
  onChange,
}: ScheduleChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const handleRefs = useRef<(SVGCircleElement | null)[]>([])
  const [active, setActive] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)
  const edited = (hour: number) =>
    saved !== null && round(saved[hour] ?? 0) !== round(values[hour] ?? 0)
  const showSaved = saved !== null && values.some((_, hour) => edited(hour))

  const valueAt = (clientY: number): number | null => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(0, clientY).matrixTransform(matrix.inverse())
    return 1 - (point.y - TOP) / PLOT_H
  }

  const drag = (event: PointerEvent<SVGElement>, hour: number) => {
    if (readOnly) return
    const value = valueAt(event.clientY)
    if (value === null) return
    onChange(hour, round(snap(value, event.shiftKey ? FINE : COARSE)))
  }

  const keyDown = (event: KeyboardEvent<SVGCircleElement>, hour: number) => {
    const step = event.shiftKey ? FINE : COARSE
    const current = Number.isFinite(values[hour]) ? (values[hour] ?? 0) : 0
    const move = (to: number) => {
      const next = (to + 24) % 24
      setActive(next)
      handleRefs.current[next]?.focus()
    }
    switch (event.key) {
      case 'ArrowLeft':
        move(hour - 1)
        break
      case 'ArrowRight':
        move(hour + 1)
        break
      default:
        if (readOnly) return
    }
    switch (event.key) {
      case 'ArrowUp':
        onChange(hour, round(snap(current + step, step)))
        break
      case 'ArrowDown':
        onChange(hour, round(snap(current - step, step)))
        break
      case 'Home':
        onChange(hour, 0)
        break
      case 'End':
        onChange(hour, 1)
        break
      case 'ArrowLeft':
      case 'ArrowRight':
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <svg
      ref={svgRef}
      className={cx(styles.chart, readOnly && styles.chartReadOnly)}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label={
        readOnly
          ? `${label} profile, read-only`
          : `${label} profile: drag a point, or use the arrow keys`
      }
    >
      {[0, 0.5, 1].map((tick) => (
        <g key={tick}>
          <line
            className={styles.grid}
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(tick)}
            y2={y(tick)}
          />
          <text
            className={styles.tick}
            x={LEFT - 6}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {tick}
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((hour) => (
        <text
          key={hour}
          className={styles.tick}
          x={x(hour)}
          y={HEIGHT - 8}
          textAnchor="middle"
        >
          {hour}
        </text>
      ))}
      {showSaved && saved ? (
        <path className={styles.savedLine} d={stepPath(saved)} />
      ) : null}
      <path className={styles.line} d={stepPath(values)} />
      {values.map((raw, hour) => {
        const value = Number.isFinite(raw) ? clamp(raw) : 0
        return (
          <g key={hour}>
            {/* A tall, invisible column makes each hour easy to grab. */}
            <rect
              className={styles.hitArea}
              x={LEFT + hour * STEP}
              y={TOP - 6}
              width={STEP}
              height={PLOT_H + 12}
              aria-hidden="true"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setActive(hour)
                setDragging(hour)
                drag(event, hour)
              }}
              onPointerMove={(event) => {
                if (dragging === hour) drag(event, hour)
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
            />
            <circle
              ref={(element) => {
                handleRefs.current[hour] = element
              }}
              className={cx(
                styles.handle,
                edited(hour) && styles.handleEdited,
                dragging === hour && styles.handleDragging,
              )}
              cx={x(hour)}
              cy={y(value)}
              r={5}
              role="slider"
              tabIndex={hour === active ? 0 : -1}
              aria-label={`${label}, hour ${hour}`}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-readonly={readOnly || undefined}
              aria-valuenow={round(value)}
              aria-valuetext={`${round(value)}${edited(hour) ? ', edited' : ''}`}
              onFocus={() => setActive(hour)}
              onKeyDown={(event) => keyDown(event, hour)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setActive(hour)
                setDragging(hour)
              }}
              onPointerMove={(event) => {
                if (dragging === hour) drag(event, hour)
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
            />
          </g>
        )
      })}
    </svg>
  )
}
