import { createStore } from 'zustand/vanilla'

type LayoutsPanelState = {
  /** The layout row to mark, such as one chosen in the asset tree. */
  focusId: string | null
  /** Whether the save prompt (View > Layouts > Save layout…) is open. */
  saving: boolean
}

/**
 * The Layouts panel's marked row and the save prompt (decision 0033). Menus,
 * the palette, and the asset tree change them through these functions; the
 * panel and the shell render them.
 */
export const layoutsPanelStore = createStore<LayoutsPanelState>(() => ({
  focusId: null,
  saving: false,
}))

export function focusLayout(id: string | null): void {
  layoutsPanelStore.setState({ focusId: id })
}

export function openSaveLayoutPrompt(): void {
  layoutsPanelStore.setState({ saving: true })
}

export function closeSaveLayoutPrompt(): void {
  layoutsPanelStore.setState({ saving: false })
}
