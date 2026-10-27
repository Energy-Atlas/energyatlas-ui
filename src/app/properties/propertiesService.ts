import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Workbench } from '../../domain/workbench.ts'

/** Definitions the Properties panel can create as well as edit. */
export type DefinitionKind = 'archetype' | 'schedule' | 'measure' | 'scenario'

export type PropertiesSnapshot = {
  /** A blank definition of this kind is shown for creating, or null. */
  creating: DefinitionKind | null
}

export type PropertiesService = {
  store: StoreApi<PropertiesSnapshot>
  /**
   * Shows a blank definition in Properties. The selection clears, and
   * selecting anything afterwards leaves the blank one.
   */
  startCreate: (kind: DefinitionKind) => void
  cancelCreate: () => void
}

/**
 * What the Properties panel shows besides the shared selection: a new
 * definition being created. Editing an existing definition is selecting it
 * (decision 0028); its unsaved edits live in the panel's form until Save or
 * Cancel.
 */
export function createPropertiesService(
  workbench: Workbench,
): PropertiesService {
  const store = createStore<PropertiesSnapshot>(() => ({ creating: null }))
  workbench.store.subscribe((snapshot, previous) => {
    const selection = snapshot.state.selection
    if (
      selection !== previous.state.selection &&
      selection.entityType !== null &&
      store.getState().creating !== null
    ) {
      store.setState({ creating: null })
    }
  })
  return {
    store,
    startCreate: (kind) => {
      if (workbench.getState().selection.entityType !== null) {
        workbench.execute({ type: 'selection.clear', input: {} })
      }
      store.setState({ creating: kind })
    },
    cancelCreate: () => store.setState({ creating: null }),
  }
}
