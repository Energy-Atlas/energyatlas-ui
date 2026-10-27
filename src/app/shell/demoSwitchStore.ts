import { createStore } from 'zustand/vanilla'
import { getBrowserStorage } from '../storage.ts'

/** Where the demo switch floats: its top-left corner in the viewport, in px. */
export type DemoSwitchPosition = { x: number; y: number }

type DemoSwitchState = {
  /** Whether the conditions panel is open beside the switch. */
  expanded: boolean
  /** Null until the viewer moves it; it then sits in its default corner. */
  position: DemoSwitchPosition | null
}

// Where the switch sits is this viewer's convenience, kept in this browser.
const POSITION_KEY = 'eaui.demoSwitch.v1'

function readPosition(): DemoSwitchPosition | null {
  try {
    const raw = getBrowserStorage()?.getItem(POSITION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DemoSwitchPosition>
    return typeof value.x === 'number' && typeof value.y === 'number'
      ? { x: value.x, y: value.y }
      : null
  } catch {
    return null
  }
}

/**
 * The floating demo switch (decision 0028): whether its panel is open and
 * where the viewer put it. Menus, the palette, and the status bar open the
 * panel through `openDemoPanel`.
 */
export const demoSwitchStore = createStore<DemoSwitchState>(() => ({
  expanded: false,
  position: readPosition(),
}))

export function openDemoPanel(): void {
  demoSwitchStore.setState({ expanded: true })
}

export function setDemoPanelOpen(expanded: boolean): void {
  demoSwitchStore.setState({ expanded })
}

export function moveDemoSwitch(position: DemoSwitchPosition | null): void {
  demoSwitchStore.setState({ position })
  try {
    const storage = getBrowserStorage()
    if (position) storage?.setItem(POSITION_KEY, JSON.stringify(position))
    else storage?.removeItem(POSITION_KEY)
  } catch {
    // Blocked storage: the position lasts until the page is reloaded.
  }
}
