import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styles from './scrollJump.module.css'

/** Space between a button and the edge of the scrolled area. */
const GAP = 8

/**
 * The pointer's share of the scrolled area's height within which each
 * button is offered: the upper 70% offers Top, the lower 70% offers Bottom,
 * so the middle band offers both.
 */
const REACH = 0.7

type Placement = { x: number; top: number | null; bottom: number | null }

type ScrollJumpProps = {
  /** Names what scrolls, for the buttons' labels. */
  label: string
  /** Finds the scrolling element within the positioned frame around it. */
  scroller: string
  /** A header inside the scroller that sticks to its top, kept clear. */
  stickyHeader?: string
}

function same(a: Placement | null, b: Placement | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.x === b.x &&
      a.top === b.top &&
      a.bottom === b.bottom)
  )
}

/** Where the buttons go for a pointer at `clientY`, or null for none. */
function place(
  frame: HTMLElement,
  scroller: HTMLElement,
  header: HTMLElement | null,
  clientY: number,
): Placement | null {
  const overflow = scroller.scrollHeight - scroller.clientHeight
  if (overflow <= 1) return null
  const box = scroller.getBoundingClientRect()
  const share = (clientY - box.top) / Math.max(1, box.height)
  if (share < 0 || share > 1) return null
  const frameBox = frame.getBoundingClientRect()
  const inner = box.top - frameBox.top + scroller.clientTop
  const canUp = scroller.scrollTop > 1
  const canDown = scroller.scrollTop < overflow - 1
  const headerHeight = header?.getBoundingClientRect().height ?? 0
  return {
    x: Math.round(
      box.left - frameBox.left + scroller.clientLeft + scroller.clientWidth / 2,
    ),
    top:
      canUp && share <= REACH ? Math.round(inner + headerHeight + GAP) : null,
    bottom:
      canDown && share >= 1 - REACH
        ? Math.round(inner + scroller.clientHeight - GAP)
        : null,
  }
}

/**
 * Jump to top and bottom (decision 0027 follow-up): round buttons over a
 * scrolling table, list, or log, shown while the pointer is over it. Which
 * one shows follows the pointer: near the top half it offers Top, near the
 * bottom half Bottom, and in the middle band both; neither shows when the
 * content fits or is already at that end. Place it inside a positioned
 * frame that holds the scroller. Keyboard users have Home and End.
 */
export function ScrollJump({ label, scroller, stickyHeader }: ScrollJumpProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useEffect(() => {
    const frame = anchorRef.current?.parentElement
    if (!frame) return
    let pointerY: number | null = null
    const update = () => {
      const target = frame.querySelector<HTMLElement>(scroller)
      const header = stickyHeader
        ? (target?.querySelector<HTMLElement>(stickyHeader) ?? null)
        : null
      const next =
        target && pointerY !== null
          ? place(frame, target, header, pointerY)
          : null
      setPlacement((current) => (same(current, next) ? current : next))
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      pointerY = event.clientY
      update()
    }
    const leave = () => {
      pointerY = null
      update()
    }
    frame.addEventListener('pointermove', move)
    frame.addEventListener('pointerleave', leave)
    // Scroll events do not bubble; capture them from the scroller.
    frame.addEventListener('scroll', update, true)
    return () => {
      frame.removeEventListener('pointermove', move)
      frame.removeEventListener('pointerleave', leave)
      frame.removeEventListener('scroll', update, true)
    }
  }, [scroller, stickyHeader])

  const jump = (to: 'top' | 'bottom') => {
    const target = anchorRef.current?.parentElement?.querySelector(scroller)
    if (!target) return
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollTo({
      top: to === 'top' ? 0 : target.scrollHeight,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  return (
    <>
      <span ref={anchorRef} hidden />
      {placement?.top != null ? (
        <button
          type="button"
          // Pointer only: Home and End do the same from the keyboard.
          tabIndex={-1}
          className={styles.jump}
          style={{ left: placement.x, top: placement.top }}
          aria-label={`Scroll to the top of ${label}`}
          title="Scroll to top"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => jump('top')}
        >
          <ArrowUp size={14} aria-hidden="true" />
        </button>
      ) : null}
      {placement?.bottom != null ? (
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.jump} ${styles.toBottom}`}
          style={{ left: placement.x, top: placement.bottom }}
          aria-label={`Scroll to the bottom of ${label}`}
          title="Scroll to bottom"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => jump('bottom')}
        >
          <ArrowDown size={14} aria-hidden="true" />
        </button>
      ) : null}
    </>
  )
}
