import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ValidationIssue } from '../../domain/commands.ts'
import type { CommandSource } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'
import type { SavedView } from '../../server/projectCatalog.ts'
import type { LayoutController } from '../layout/layoutController.ts'
import type { MapLayer } from '../pages/mapLayers.ts'
import type { TableSettings } from '../tables/tableSettings.ts'
import type { ViewStore } from '../view/viewStore.ts'
import { focusLayout, layoutsPanelStore } from './layoutsPanelStore.ts'
import {
  captureViewSnapshot,
  LAYOUT_FORMAT,
  layoutListsDiffer,
  layoutNameSchema,
  MAX_LAYOUTS,
  newLayoutId,
  parseLayoutList,
  storedLayouts,
  uniqueLayoutName,
  type LayoutList,
  type SavedLayout,
} from './savedLayout.ts'

// Saved layouts (decisions 0032 and 0033): one service for menus, the
// Layouts panel, the save prompt, the asset tree, and the agent. Layouts are
// saved with the project only. Every operation records one entry in the
// operation log with its source; applying goes through the layout controller
// for the arrangement and the `view.applyLayout` view operation for the view
// settings, and still records a single entry.

export type AppliedLayout = {
  id: string
  name: string
  /** The arrangement and view settings right after applying, to see later changes. */
  fingerprint: string
}

export type LayoutLibrarySnapshot = {
  /** The open project's layouts, saved with it. */
  project: LayoutList
  /** The layout the project opens with. */
  defaultId: string | null
  /** A stored default naming a layout this version cannot read, kept as stored. */
  keptDefaultId: string | null
  /** The layout last applied in this project session; Reset returns to it. */
  applied: AppliedLayout | null
  /**
   * What the views were right after a default layout applied on opening, so
   * opening does not count as an unsaved change. Keyed by project session and
   * save time; it no longer applies once the project is saved again.
   */
  openedView: {
    key: string
    tables: Record<string, TableSettings>
    layers: MapLayer[]
  } | null
}

export type LayoutOutcome =
  | { status: 'applied'; summary: string; operationId: string; id?: string }
  | { status: 'rejected'; issues: ValidationIssue[]; operationId: string }

export type LayoutLibrary = {
  store: StoreApi<LayoutLibrarySnapshot>
  /** Whether layouts can be changed here; a viewer keeps them read-only. */
  writable: boolean
  /**
   * The viewer's reset (decision 0032, stage 5): back to the layouts and
   * views as handed over, the default layout when the package has one, else
   * the default arrangement with the views saved in the package.
   */
  resetToHandedOver: (source?: CommandSource) => LayoutOutcome
  find: (id: string) => SavedLayout | null
  save: (input: { name: string }, source?: CommandSource) => LayoutOutcome
  apply: (id: string, source?: CommandSource) => LayoutOutcome
  update: (id: string, source?: CommandSource) => LayoutOutcome
  rename: (id: string, name: string, source?: CommandSource) => LayoutOutcome
  duplicate: (id: string, source?: CommandSource) => LayoutOutcome
  remove: (id: string, source?: CommandSource) => LayoutOutcome
  setDefault: (id: string | null, source?: CommandSource) => LayoutOutcome
  /** Returns to the layout last applied, as it is saved now. */
  resetToApplied: (source?: CommandSource) => LayoutOutcome
  /**
   * Loads the project's layouts when a project session starts, and applies
   * its default layout. `key` names the session for `openedView`.
   */
  resetForProject: (saved: SavedView | null, key: string) => void
  /** What the project saves of its layouts. */
  forSave: () => { layouts: unknown[]; defaultLayoutId: string | null }
  /** Whether the project's layouts differ from what it saved. */
  projectDiffers: (saved: SavedView | null) => boolean
  /** Whether the arrangement or view settings changed since the last apply. */
  changedSinceApplied: () => boolean
  /** Why a layout cannot be saved now, or null. */
  saveBlocker: () => string | null
  /** Why this layout cannot be changed (updated, renamed, deleted), or null. */
  changeBlocker: (id: string) => string | null
  /** Why Reset to layout cannot run, or null. */
  resetBlocker: () => string | null
}

const READ_ONLY = 'Handed-over layouts are read-only here; apply one to use it.'

/** The stored default when it names a readable layout, or null. */
function defaultFrom(saved: SavedView | null, list: LayoutList): string | null {
  const id = saved?.defaultLayoutId ?? null
  return id && list.layouts.some((layout) => layout.id === id) ? id : null
}

/**
 * The stored default when it names a layout this version cannot read: kept
 * and saved back unchanged, though it is not applied here.
 */
function keptDefaultFrom(
  saved: SavedView | null,
  list: LayoutList,
): string | null {
  const id = saved?.defaultLayoutId ?? null
  return id &&
    list.unreadable.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { id?: unknown }).id === id,
    )
    ? id
    : null
}

export function createLayoutLibrary(options: {
  workbench: Workbench
  layout: LayoutController
  view: ViewStore
  /** Posts a warning about parts of a layout that could not be applied. */
  warn?: (text: string, operationId: string, source: CommandSource) => void
  writable?: boolean
  now?: () => Date
}): LayoutLibrary {
  const { workbench, layout, view } = options
  const writable = options.writable ?? true
  const now = options.now ?? (() => new Date())
  /** The views the project session opened with, for the viewer's reset. */
  let sessionView: SavedView | null = null
  const store = createStore<LayoutLibrarySnapshot>()(() => ({
    project: { layouts: [], unreadable: [] },
    defaultId: null,
    keptDefaultId: null,
    applied: null,
    openedView: null,
  }))

  const find = (id: string): SavedLayout | null =>
    store.getState().project.layouts.find((layout) => layout.id === id) ?? null

  const record = (
    type: string,
    title: string,
    input: unknown,
    source: CommandSource,
    result: { summary: string } | { message: string; path?: string },
  ): string =>
    'summary' in result
      ? workbench.record({
          type,
          title,
          input,
          source,
          summary: result.summary,
        })
      : workbench.record({
          type,
          title,
          input,
          source,
          status: 'rejected',
          summary: '',
          issues: [{ path: result.path ?? '', message: result.message }],
        })

  const rejectWith = (
    type: string,
    title: string,
    input: unknown,
    source: CommandSource,
    message: string,
    path = '',
  ): LayoutOutcome => ({
    status: 'rejected',
    issues: [{ path, message }],
    operationId: record(type, title, input, source, { message, path }),
  })

  const missing = (id: string) => `There is no layout "${id}".`

  /**
   * A layout chosen in the asset tree stays marked in the Layouts panel only
   * until a layout is applied (or saved or updated, which apply it), the
   * chosen one is deleted, or another project session starts; the panel then
   * marks the applied layout again.
   */
  const clearFocus = (onlyId?: string) => {
    const { focusId } = layoutsPanelStore.getState()
    if (focusId !== null && (onlyId === undefined || focusId === onlyId)) {
      focusLayout(null)
    }
  }

  // Moving the map is not a change to the layout: its camera is left out
  // (decision 0036), though saving or updating a layout keeps it.
  const fingerprint = () => {
    const snapshot = captureViewSnapshot(view.getState())
    return JSON.stringify({
      arrangement: layout.getArrangement(),
      view: { ...snapshot, map: { ...snapshot.map, camera: undefined } },
    })
  }

  const saveBlocker = (): string | null => {
    if (!writable) return READ_ONLY
    if (store.getState().project.layouts.length >= MAX_LAYOUTS) {
      return `This project already has ${MAX_LAYOUTS} layouts. Delete one first.`
    }
    return null
  }

  const changeBlocker = (id: string): string | null => {
    if (!find(id)) return missing(id)
    if (!writable) return READ_ONLY
    return null
  }

  /** Changes the list, kept in memory until the project is saved. */
  const commit = (
    change: (list: LayoutList) => LayoutList,
    extra: Partial<LayoutLibrarySnapshot> = {},
  ): void => {
    store.setState({ project: change(store.getState().project), ...extra })
  }

  const nameIssue = (name: string, exceptId?: string): string | null => {
    const taken = store
      .getState()
      .project.layouts.some(
        (layout) =>
          layout.id !== exceptId &&
          layout.name.toLowerCase() === name.toLowerCase(),
      )
    return taken
      ? `A layout named "${name}" already exists. Choose another name, or update that layout.`
      : null
  }

  const applyLayout = (
    id: string,
    source: CommandSource,
    type: 'layouts.apply' | 'layouts.reset',
  ): LayoutOutcome => {
    const title = type === 'layouts.apply' ? 'Apply layout' : 'Reset to layout'
    const input = { layoutId: id }
    const saved = find(id)
    if (!saved) {
      return rejectWith(type, title, input, source, missing(id), 'layoutId')
    }
    const arranged = layout.loadArrangement(saved.arrangement)
    if (arranged.status === 'rejected') {
      return rejectWith(
        type,
        title,
        input,
        source,
        `"${saved.name}" could not be applied: ${arranged.message} The current layout is unchanged.`,
      )
    }
    const viewed = view.execute(
      {
        type: 'view.applyLayout',
        input: { name: saved.name, view: saved.view },
      },
      source,
      { record: false },
    )
    const notes: string[] = []
    if (arranged.dropped.length > 0) {
      notes.push(
        `Left out ${arranged.dropped.length === 1 ? 'a tab' : `${arranged.dropped.length} tabs`} this version does not have: ${arranged.dropped.join(', ')}.`,
      )
    }
    if (viewed.outcome.status === 'applied') {
      notes.push(...(viewed.outcome.notes ?? []))
    } else {
      notes.push(
        'The view settings in this layout could not be read; only the panel arrangement was applied.',
      )
    }
    store.setState({
      applied: { id, name: saved.name, fingerprint: fingerprint() },
    })
    clearFocus()
    const summary =
      type === 'layouts.apply'
        ? `Applied the layout "${saved.name}".`
        : `Reset the panels and views to the layout "${saved.name}".`
    const operationId = record(
      type,
      title,
      input,
      source,
      notes.length > 0
        ? { summary: `${summary} Some parts were left out.` }
        : { summary },
    )
    if (notes.length > 0) {
      options.warn?.(`"${saved.name}": ${notes.join(' ')}`, operationId, source)
    }
    return { status: 'applied', summary, operationId, id }
  }

  return {
    store,
    writable,
    find,

    resetToHandedOver: (source = 'manual') => {
      const type = 'layouts.resetToHandover'
      const title = 'Reset to handed-over layout'
      const { defaultId } = store.getState()
      if (defaultId && find(defaultId)) {
        return applyLayout(defaultId, source, 'layouts.reset')
      }
      layout.reset(source)
      view.execute(
        {
          type: 'view.resetForProject',
          input: { tables: sessionView?.tables, layers: sessionView?.layers },
        },
        source,
        { record: false },
      )
      store.setState({ applied: null })
      clearFocus()
      const summary =
        'Reset the panels and views to the handed-over layout: the default arrangement with the table settings and map layers in the package.'
      return {
        status: 'applied',
        summary,
        operationId: record(type, title, {}, source, { summary }),
      }
    },

    save: ({ name }, source = 'manual') => {
      const type = 'layouts.save'
      const title = 'Save layout'
      const input = { name }
      const parsed = layoutNameSchema.safeParse(name)
      if (!parsed.success) {
        return rejectWith(
          type,
          title,
          input,
          source,
          parsed.error.issues[0]?.message ?? 'Enter a layout name.',
          'name',
        )
      }
      const blocker = saveBlocker()
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const taken = nameIssue(parsed.data)
      if (taken) return rejectWith(type, title, input, source, taken, 'name')
      const at = now().toISOString()
      const created: SavedLayout = {
        format: LAYOUT_FORMAT,
        id: newLayoutId(),
        name: parsed.data,
        scope: 'project',
        createdAt: at,
        updatedAt: at,
        createdBy: source,
        arrangement: layout.getArrangement(),
        view: captureViewSnapshot(view.getState()),
      }
      commit((list) => ({ ...list, layouts: [...list.layouts, created] }))
      // The saved layout is now what Reset returns to.
      store.setState({
        applied: {
          id: created.id,
          name: created.name,
          fingerprint: fingerprint(),
        },
      })
      clearFocus()
      const summary = `Saved the layout "${created.name}". Save the project to keep it.`
      return {
        status: 'applied',
        summary,
        id: created.id,
        operationId: record(
          type,
          title,
          { ...input, layoutId: created.id },
          source,
          { summary },
        ),
      }
    },

    apply: (id, source = 'manual') => applyLayout(id, source, 'layouts.apply'),

    update: (id, source = 'manual') => {
      const type = 'layouts.update'
      const title = 'Update layout'
      const input = { layoutId: id }
      const blocker = changeBlocker(id)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const saved = find(id)!
      const updated: SavedLayout = {
        ...saved,
        updatedAt: now().toISOString(),
        arrangement: layout.getArrangement(),
        view: captureViewSnapshot(view.getState()),
      }
      commit((list) => ({
        ...list,
        layouts: list.layouts.map((each) => (each.id === id ? updated : each)),
      }))
      store.setState({
        applied: { id, name: updated.name, fingerprint: fingerprint() },
      })
      clearFocus()
      const summary = `Updated the layout "${updated.name}" with the current panels and views.`
      return {
        status: 'applied',
        summary,
        id,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    rename: (id, name, source = 'manual') => {
      const type = 'layouts.rename'
      const title = 'Rename layout'
      const input = { layoutId: id, name }
      const blocker = changeBlocker(id)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const parsed = layoutNameSchema.safeParse(name)
      if (!parsed.success) {
        return rejectWith(
          type,
          title,
          input,
          source,
          parsed.error.issues[0]?.message ?? 'Enter a layout name.',
          'name',
        )
      }
      const saved = find(id)!
      if (parsed.data === saved.name) {
        return rejectWith(
          type,
          title,
          input,
          source,
          `The layout is already named "${saved.name}".`,
          'name',
        )
      }
      const taken = nameIssue(parsed.data, id)
      if (taken) return rejectWith(type, title, input, source, taken, 'name')
      const applied = store.getState().applied
      commit(
        (list) => ({
          ...list,
          layouts: list.layouts.map((each) =>
            each.id === id
              ? { ...each, name: parsed.data, updatedAt: now().toISOString() }
              : each,
          ),
        }),
        applied?.id === id
          ? { applied: { ...applied, name: parsed.data } }
          : {},
      )
      const summary = `Renamed the layout "${saved.name}" to "${parsed.data}".`
      return {
        status: 'applied',
        summary,
        id,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    duplicate: (id, source = 'manual') => {
      const type = 'layouts.duplicate'
      const title = 'Duplicate layout'
      const input = { layoutId: id }
      const saved = find(id)
      if (!saved) {
        return rejectWith(type, title, input, source, missing(id), 'layoutId')
      }
      const blocker = saveBlocker()
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const at = now().toISOString()
      const copy: SavedLayout = {
        ...structuredClone(saved),
        id: newLayoutId(),
        name: uniqueLayoutName(
          `${saved.name} copy`,
          store.getState().project.layouts,
        ),
        createdAt: at,
        updatedAt: at,
        createdBy: source,
      }
      commit((list) => ({ ...list, layouts: [...list.layouts, copy] }))
      const summary = `Duplicated the layout "${saved.name}" as "${copy.name}".`
      return {
        status: 'applied',
        summary,
        id: copy.id,
        operationId: record(
          type,
          title,
          { ...input, newLayoutId: copy.id },
          source,
          { summary },
        ),
      }
    },

    remove: (id, source = 'manual') => {
      const type = 'layouts.delete'
      const title = 'Delete layout'
      const input = { layoutId: id }
      const blocker = changeBlocker(id)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const saved = find(id)!
      const { applied, defaultId } = store.getState()
      const wasDefault = defaultId === id
      commit(
        (list) => ({
          ...list,
          layouts: list.layouts.filter((each) => each.id !== id),
        }),
        {
          ...(wasDefault ? { defaultId: null } : {}),
          ...(applied?.id === id ? { applied: null } : {}),
        },
      )
      clearFocus(id)
      const summary = `Deleted the layout "${saved.name}".${wasDefault ? ' The project no longer opens with a default layout.' : ''}`
      return {
        status: 'applied',
        summary,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    setDefault: (id, source = 'manual') => {
      const type = 'layouts.setDefault'
      const title = 'Set default layout'
      const input = { layoutId: id }
      if (!writable) return rejectWith(type, title, input, source, READ_ONLY)
      if (id === null) {
        if (
          store.getState().defaultId === null &&
          store.getState().keptDefaultId === null
        ) {
          return rejectWith(
            type,
            title,
            input,
            source,
            'The project has no default layout.',
          )
        }
        store.setState({ defaultId: null, keptDefaultId: null })
        const summary =
          'The project no longer opens with a default layout. Save the project to keep this.'
        return {
          status: 'applied',
          summary,
          operationId: record(type, title, input, source, { summary }),
        }
      }
      const saved = find(id)
      if (!saved) {
        return rejectWith(type, title, input, source, missing(id), 'layoutId')
      }
      if (store.getState().defaultId === id) {
        return rejectWith(
          type,
          title,
          input,
          source,
          `"${saved.name}" is already the default layout.`,
          'layoutId',
        )
      }
      store.setState({ defaultId: id, keptDefaultId: null })
      const summary = `The project opens with the layout "${saved.name}". Save the project to keep this.`
      return {
        status: 'applied',
        summary,
        id,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    resetToApplied: (source = 'manual') => {
      const applied = store.getState().applied
      const blocker = resetBlockerOf(store.getState(), find)
      if (blocker || !applied) {
        return rejectWith(
          'layouts.reset',
          'Reset to layout',
          {},
          source,
          blocker ?? 'No saved layout has been applied.',
        )
      }
      return applyLayout(applied.id, source, 'layouts.reset')
    },

    resetForProject: (saved, key) => {
      sessionView = saved
      clearFocus()
      const project = parseLayoutList(saved?.layouts)
      const defaultId = defaultFrom(saved, project)
      store.setState({
        project,
        defaultId,
        keptDefaultId: keptDefaultFrom(saved, project),
        applied: null,
        openedView: null,
      })
      if (!defaultId) return
      const outcome = applyLayout(defaultId, 'system', 'layouts.apply')
      if (outcome.status === 'applied') {
        const current = view.getState()
        store.setState({
          openedView: {
            key,
            tables: structuredClone(current.tables),
            layers: structuredClone(current.map.layers),
          },
        })
      }
    },

    forSave: () => ({
      layouts: storedLayouts(store.getState().project),
      defaultLayoutId:
        store.getState().defaultId ?? store.getState().keptDefaultId,
    }),

    projectDiffers: (saved) => {
      const stored = parseLayoutList(saved?.layouts)
      const { project, defaultId, keptDefaultId } = store.getState()
      return (
        layoutListsDiffer(project, stored) ||
        (defaultId ?? keptDefaultId) !==
          (defaultFrom(saved, stored) ?? keptDefaultFrom(saved, stored))
      )
    },

    changedSinceApplied: () => {
      const applied = store.getState().applied
      return applied !== null && applied.fingerprint !== fingerprint()
    },

    saveBlocker,
    changeBlocker,
    resetBlocker: () => resetBlockerOf(store.getState(), find),
  }
}

function resetBlockerOf(
  snapshot: LayoutLibrarySnapshot,
  find: (id: string) => SavedLayout | null,
): string | null {
  const { applied } = snapshot
  if (!applied) {
    return 'No saved layout has been applied in this project yet. Apply one from the Layouts panel first, or use Reset layout for the default arrangement.'
  }
  if (!find(applied.id)) {
    return `The layout "${applied.name}" was deleted, so there is nothing to reset to.`
  }
  return null
}
