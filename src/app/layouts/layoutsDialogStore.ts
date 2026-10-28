import { createStore } from 'zustand/vanilla'
import type { LayoutRef } from './layoutLibrary.ts'

type LayoutsDialogState = {
  open: boolean
  /** The layout to show first, such as one chosen in the asset tree. */
  focus: LayoutRef | null
  /** Whether the dialog opens on the name field to save the current layout. */
  saving: boolean
}

/**
 * Whether the Layouts dialog is open (decision 0032). Menus, the palette,
 * and the asset tree open it through these functions; the shell renders it.
 */
export const layoutsDialogStore = createStore<LayoutsDialogState>(() => ({
  open: false,
  focus: null,
  saving: false,
}))

export function openLayoutsDialog(
  options: { focus?: LayoutRef; saving?: boolean } = {},
): void {
  layoutsDialogStore.setState({
    open: true,
    focus: options.focus ?? null,
    saving: options.saving ?? false,
  })
}

export function closeLayoutsDialog(): void {
  layoutsDialogStore.setState({ open: false, focus: null, saving: false })
}
