import { useLayoutEffect, useRef, useState } from 'react'
import { dayHours } from '../../domain/archetypes/assignment.ts'
import type { Schedule } from '../../domain/types.ts'
import { useAppearance } from '../WorkbenchContext.tsx'
import styles from './schedule.module.css'

const DAYS = 365
const HOURS = 24
/** Height of one hour row, in px. */
const ROW_PX = 4
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** The day of the year each month starts on. */
const MONTH_STARTS = MONTH_DAYS.map((_, index) =>
  MONTH_DAYS.slice(0, index).reduce((sum, days) => sum + days, 0),
)

/**
 * The schedule over a whole year as a heat map (decision 0028): one column
 * per day, starting on a Monday as the annual hours assume, one row per hour
 * from midnight at the top, darker where the value is nearer 1. Read-only;
 * it redraws as hours, day types, or the week change.
 */
export function ScheduleYear({
  schedule,
}: {
  schedule: Pick<Schedule, 'days' | 'week'>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const appearance = useAppearance()

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || width === 0) return
    const ratio = window.devicePixelRatio || 1
    const height = HOURS * ROW_PX
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const style = getComputedStyle(canvas)
    context.clearRect(0, 0, width, height)
    context.fillStyle = style.getPropertyValue('--color-accent').trim()
    const column = width / DAYS
    // One profile per day of the week, looked up once.
    const week = Array.from({ length: 7 }, (_, day) => dayHours(schedule, day))
    for (let day = 0; day < DAYS; day += 1) {
      const hours = week[day % 7] ?? []
      for (let hour = 0; hour < HOURS; hour += 1) {
        const value = hours[hour] ?? 0
        if (!(value > 0)) continue
        context.globalAlpha = Math.min(1, value)
        context.fillRect(day * column, hour * ROW_PX, column + 0.5, ROW_PX)
      }
    }
    context.globalAlpha = 1
  }, [schedule, width, appearance])

  return (
    <figure className={styles.year}>
      <div className={styles.yearPlot}>
        <div className={styles.yearHours} aria-hidden="true">
          <span>0</span>
          <span>12</span>
          <span>24</span>
        </div>
        <canvas
          ref={canvasRef}
          className={styles.yearCanvas}
          role="img"
          aria-label="The schedule over a year: one column per day from January, starting on a Monday; one row per hour from midnight; darker is nearer 1."
        />
      </div>
      <div className={styles.yearMonths} aria-hidden="true">
        {MONTHS.map((month, index) => (
          <span
            key={index}
            style={{ left: `${((MONTH_STARTS[index] ?? 0) / DAYS) * 100}%` }}
          >
            {month}
          </span>
        ))}
      </div>
    </figure>
  )
}
