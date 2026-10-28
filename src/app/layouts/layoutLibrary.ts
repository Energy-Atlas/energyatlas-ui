import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ValidationIssue } from '../../domain/commands.ts'
import type { CommandSource } from '../../domain/types.ts'
import type { Workbench } from '../../domain/workbench.ts'
import type { SavedView } from '../../server/projectCatalog.ts'
import type { LayoutController } from '../layout/layoutController.ts'
import type { MapLayer } from '../pages/mapLayers.ts'
import type { TableSettings } from '../tables/tableSettings.ts'
import type { ViewStore } from '../view/viewStore.ts'
import {
  PERSONAL_LAYOUTS_KEY,
  readPersonalLayouts,
  removePersonalLayouts,
  writePersonalLayouts,
  type PersonalStatus,
} from './personalLayouts.ts'
import {
  captureViewSnapshot,
  LAYOUT_FORMAT,
  layoutListsDiffer,
  layoutNameSchema,
  MAX_LAYOUTS_PER_SCOPE,
  newLayoutId,
  parseLayoutList,
  SCOPE_LABELS,
  storedLayouts,
  uniqueLayoutName,
  type LayoutList,
  type LayoutScope,
  type SavedLayout,
} from './savedLayout.ts'

// Saved layouts (decision 0032): one service for menus, the Layouts dialog,
// the asset tree, and the agent. Every operation records one entry in the
// operation log with its source; applying goes through the layout controller
// for the arrangement and the `view.applyLayout` view operation for the view
// settings, and still records a single entry.

export type LayoutRef = { scope: LayoutScope; id: string }

export type AppliedLayout = {
  ref: LayoutRef
  name: string
  /** The arrangement and view settings right after applying, to see later changes. */
  fingerprint: string
}

export type LayoutLibrarySnapshot = {
  /** The open project's layouts, saved with it. */
  project: LayoutList
  /** The project layout the project opens with. */
  defaultId: string | null
  /** A stored default naming a layout this version cannot read, kept as stored. */
  keptDefaultId: string | null
  personal: LayoutList
  personalStatus: PersonalStatus
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
  | { status: 'applied'; summary: string; operationId: string; ref?: LayoutRef }
  | { status: 'rejected'; issues: ValidationIssue[]; operationId: string }

export type LayoutLibrary = {
  store: StoreApi<LayoutLibrarySnapshot>
  /** Whether project layouts can be changed here; a viewer keeps them read-only. */
  projectWritable: boolean
  /**
   * Keeps personal layouts under another key from now on, such as one per
   * handover package on the viewer page (decision 0032, stage 5).
   */
  setPersonalKey: (key: string) => void
  /**
   * The viewer's reset (decision 0032, stage 5): back to the layouts and
   * views as handed over, the default layout when the package has one, else
   * the default arrangement with the views saved in the package. Personal
   * layouts and the handed-over layouts stay unchanged.
   */
  resetToHandedOver: (source?: CommandSource) => LayoutOutcome
  find: (ref: LayoutRef) => SavedLayout | null
  save: (
    input: { name: string; scope: LayoutScope },
    source?: CommandSource,
  ) => LayoutOutcome
  apply: (ref: LayoutRef, source?: CommandSource) => LayoutOutcome
  update: (ref: LayoutRef, source?: CommandSource) => LayoutOutcome
  rename: (
    ref: LayoutRef,
    name: string,
    source?: CommandSource,
  ) => LayoutOutcome
  duplicate: (
    ref: LayoutRef,
    source?: CommandSource,
    toScope?: LayoutScope,
  ) => LayoutOutcome
  remove: (ref: LayoutRef, source?: CommandSource) => LayoutOutcome
  setDefault: (id: string | null, source?: CommandSource) => LayoutOutcome
  /** Returns to the layout last applied, as it is saved now. */
  resetToApplied: (source?: CommandSource) => LayoutOutcome
  /** Removes an unreadable personal value from storage, the only way past it. */
  removeUnreadablePersonal: (source?: CommandSource) => LayoutOutcome
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
  /** Why a layout of this scope cannot be saved now, or null. */
  saveBlocker: (scope: LayoutScope) => string | null
  /** Why this layout cannot be changed (updated, renamed, deleted), or null. */
  changeBlocker: (ref: LayoutRef) => string | null
  /** Why Reset to layout cannot run, or null. */
  resetBlocker: () => string | null
}

const PROJECT_READ_ONLY =
  'Project layouts are read-only here. Copy one to your personal layouts to change it.'

/** The stored default when it names a readable project layout, or null. */
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
  storage: Storage | null
  /** Posts a warning about parts of a layout that could not be applied. */
  warn?: (text: string, operationId: string, source: CommandSource) => void
  projectWritable?: boolean
  /** Where personal layouts are kept; the modeller's key by default. */
  personalKey?: string
  now?: () => Date
}): LayoutLibrary {
  const { workbench, layout, view, storage } = options
  const projectWritable = options.projectWritable ?? true
  const now = options.now ?? (() => new Date())
  let personalKey = options.personalKey ?? PERSONAL_LAYOUTS_KEY
  /** The views the project session opened with, for the viewer's reset. */
  let sessionView: SavedView | null = null
  const personal = readPersonalLayouts(storage, personalKey)
  const store = createStore<LayoutLibrarySnapshot>()(() => ({
    project: { layouts: [], unreadable: [] },
    defaultId: null,
    keptDefaultId: null,
    personal: personal.list,
    personalStatus: personal.status,
    applied: null,
    openedView: null,
  }))

  const listOf = (scope: LayoutScope): LayoutList =>
    scope === 'project' ? store.getState().project : store.getState().personal

  const find = (ref: LayoutRef): SavedLayout | null =>
    listOf(ref.scope).layouts.find((layout) => layout.id === ref.id) ?? null

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

  const missing = (ref: LayoutRef) =>
    `There is no ${SCOPE_LABELS[ref.scope].toLowerCase()} layout "${ref.id}".`

  const fingerprint = () =>
    JSON.stringify({
      arrangement: layout.getArrangement(),
      view: captureViewSnapshot(view.getState()),
    })

  const saveBlocker = (scope: LayoutScope): string | null => {
    if (scope === 'project' && !projectWritable) return PROJECT_READ_ONLY
    if (scope === 'personal') {
      const status = store.getState().personalStatus
      if (status.kind !== 'ready') return status.message
    }
    if (listOf(scope).layouts.length >= MAX_LAYOUTS_PER_SCOPE) {
      return `There are already ${MAX_LAYOUTS_PER_SCOPE} ${SCOPE_LABELS[scope].toLowerCase()} layouts. Delete one first.`
    }
    return null
  }

  const changeBlocker = (ref: LayoutRef): string | null => {
    if (!find(ref)) return missing(ref)
    if (ref.scope === 'project' && !projectWritable) return PROJECT_READ_ONLY
    if (ref.scope === 'personal') {
      const status = store.getState().personalStatus
      if (status.kind !== 'ready') return status.message
    }
    return null
  }

  /**
   * Applies a change to a scope's list and stores it: personal layouts in the
   * browser, project ones in memory until the project is saved. Personal
   * layouts are read again first, so a layout another tab added since is kept
   * rather than overwritten.
   */
  const commit = (
    scope: LayoutScope,
    change: (list: LayoutList) => LayoutList,
    extra: Partial<LayoutLibrarySnapshot> = {},
  ): string | null => {
    if (scope === 'project') {
      store.setState({ project: change(store.getState().project), ...extra })
      return null
    }
    const fresh = readPersonalLayouts(storage, personalKey)
    if (fresh.status.kind !== 'ready') {
      store.setState({ personal: fresh.list, personalStatus: fresh.status })
      return fresh.status.message
    }
    const list = change(fresh.list)
    const written = writePersonalLayouts(storage, list, personalKey)
    if (!written.ok) return written.message
    store.setState({ personal: list, ...extra })
    return null
  }

  // Another tab changed the personal layouts: show them as stored now.
  if (typeof window !== 'undefined' && storage) {
    window.addEventListener('storage', (event) => {
      if (event.key !== null && event.key !== personalKey) return
      const fresh = readPersonalLayouts(storage, personalKey)
      store.setState({ personal: fresh.list, personalStatus: fresh.status })
    })
  }

  const nameIssue = (
    scope: LayoutScope,
    name: string,
    exceptId?: string,
  ): string | null => {
    const taken = listOf(scope).layouts.some(
      (layout) =>
        layout.id !== exceptId &&
        layout.name.toLowerCase() === name.toLowerCase(),
    )
    return taken
      ? `A ${SCOPE_LABELS[scope].toLowerCase()} layout named "${name}" already exists. Choose another name, or update that layout.`
      : null
  }

  const applyLayout = (
    ref: LayoutRef,
    source: CommandSource,
    type: 'layouts.apply' | 'layouts.reset',
  ): LayoutOutcome => {
    const title = type === 'layouts.apply' ? 'Apply layout' : 'Reset to layout'
    const input = { scope: ref.scope, layoutId: ref.id }
    const saved = find(ref)
    if (!saved) {
      return rejectWith(type, title, input, source, missing(ref), 'layoutId')
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
      applied: { ref, name: saved.name, fingerprint: fingerprint() },
    })
    const scope = SCOPE_LABELS[ref.scope].toLowerCase()
    const summary =
      type === 'layouts.apply'
        ? `Applied the ${scope} layout "${saved.name}".`
        : `Reset the panels and views to the ${scope} layout "${saved.name}".`
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
    return { status: 'applied', summary, operationId, ref }
  }

  return {
    store,
    projectWritable,
    find,

    setPersonalKey: (key) => {
      if (key === personalKey) return
      personalKey = key
      const fresh = readPersonalLayouts(storage, key)
      const applied = store.getState().applied
      store.setState({
        personal: fresh.list,
        personalStatus: fresh.status,
        ...(applied?.ref.scope === 'personal' ? { applied: null } : {}),
      })
    },

    resetToHandedOver: (source = 'manual') => {
      const type = 'layouts.resetToHandover'
      const title = 'Reset to handed-over layout'
      const { defaultId } = store.getState()
      if (defaultId && find({ scope: 'project', id: defaultId })) {
        const outcome = applyLayout(
          { scope: 'project', id: defaultId },
          source,
          'layouts.reset',
        )
        return outcome
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
      const summary =
        'Reset the panels and views to the handed-over layout: the default arrangement with the table settings and map layers in the package.'
      return {
        status: 'applied',
        summary,
        operationId: record(type, title, {}, source, { summary }),
      }
    },

    save: ({ name, scope }, source = 'manual') => {
      const type = 'layouts.save'
      const title = 'Save layout'
      const input = { name, scope }
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
      const blocker = saveBlocker(scope)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const taken = nameIssue(scope, parsed.data)
      if (taken) return rejectWith(type, title, input, source, taken, 'name')
      const at = now().toISOString()
      const created: SavedLayout = {
        format: LAYOUT_FORMAT,
        id: newLayoutId(),
        name: parsed.data,
        scope,
        createdAt: at,
        updatedAt: at,
        createdBy: source,
        arrangement: layout.getArrangement(),
        view: captureViewSnapshot(view.getState()),
      }
      const failure = commit(scope, (list) => ({
        ...list,
        layouts: [...list.layouts, created],
      }))
      if (failure) return rejectWith(type, title, input, source, failure)
      const ref = { scope, id: created.id }
      // The saved layout is now what Reset returns to.
      store.setState({
        applied: { ref, name: created.name, fingerprint: fingerprint() },
      })
      const summary =
        scope === 'project'
          ? `Saved the project layout "${created.name}". Save the project to keep it.`
          : `Saved the personal layout "${created.name}" in this browser.`
      return {
        status: 'applied',
        summary,
        ref,
        operationId: record(
          type,
          title,
          { ...input, layoutId: created.id },
          source,
          {
            summary,
          },
        ),
      }
    },

    apply: (ref, source = 'manual') =>
      applyLayout(ref, source, 'layouts.apply'),

    update: (ref, source = 'manual') => {
      const type = 'layouts.update'
      const title = 'Update layout'
      const input = { scope: ref.scope, layoutId: ref.id }
      const blocker = changeBlocker(ref)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const saved = find(ref)!
      const updated: SavedLayout = {
        ...saved,
        updatedAt: now().toISOString(),
        arrangement: layout.getArrangement(),
        view: captureViewSnapshot(view.getState()),
      }
      const failure = commit(ref.scope, (list) => ({
        ...list,
        layouts: list.layouts.map((each) =>
          each.id === ref.id ? updated : each,
        ),
      }))
      if (failure) return rejectWith(type, title, input, source, failure)
      store.setState({
        applied: { ref, name: updated.name, fingerprint: fingerprint() },
      })
      const summary = `Updated the ${SCOPE_LABELS[ref.scope].toLowerCase()} layout "${updated.name}" with the current panels and views.`
      return {
        status: 'applied',
        summary,
        ref,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    rename: (ref, name, source = 'manual') => {
      const type = 'layouts.rename'
      const title = 'Rename layout'
      const input = { scope: ref.scope, layoutId: ref.id, name }
      const blocker = changeBlocker(ref)
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
      const saved = find(ref)!
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
      const taken = nameIssue(ref.scope, parsed.data, ref.id)
      if (taken) return rejectWith(type, title, input, source, taken, 'name')
      const applied = store.getState().applied
      const failure = commit(
        ref.scope,
        (list) => ({
          ...list,
          layouts: list.layouts.map((each) =>
            each.id === ref.id
              ? { ...each, name: parsed.data, updatedAt: now().toISOString() }
              : each,
          ),
        }),
        applied && applied.ref.scope === ref.scope && applied.ref.id === ref.id
          ? { applied: { ...applied, name: parsed.data } }
          : {},
      )
      if (failure) return rejectWith(type, title, input, source, failure)
      const summary = `Renamed the layout "${saved.name}" to "${parsed.data}".`
      return {
        status: 'applied',
        summary,
        ref,
        operationId: record(type, title, input, source, { summary }),
      }
    },

    duplicate: (ref, source = 'manual', toScope = ref.scope) => {
      const type = 'layouts.duplicate'
      const title = 'Duplicate layout'
      const input = { scope: ref.scope, layoutId: ref.id, toScope }
      const saved = find(ref)
      if (!saved) {
        return rejectWith(type, title, input, source, missing(ref), 'layoutId')
      }
      const blocker = saveBlocker(toScope)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const list = listOf(toScope)
      const at = now().toISOString()
      const copy: SavedLayout = {
        ...structuredClone(saved),
        id: newLayoutId(),
        scope: toScope,
        name: uniqueLayoutName(
          toScope === ref.scope ? `${saved.name} copy` : saved.name,
          list.layouts,
        ),
        createdAt: at,
        updatedAt: at,
        createdBy: source,
      }
      const failure = commit(toScope, (current) => ({
        ...current,
        layouts: [...current.layouts, copy],
      }))
      if (failure) return rejectWith(type, title, input, source, failure)
      const summary =
        toScope === ref.scope
          ? `Duplicated the layout "${saved.name}" as "${copy.name}".`
          : `Copied the ${SCOPE_LABELS[ref.scope].toLowerCase()} layout "${saved.name}" to the ${SCOPE_LABELS[toScope].toLowerCase()} layouts as "${copy.name}".`
      return {
        status: 'applied',
        summary,
        ref: { scope: toScope, id: copy.id },
        operationId: record(
          type,
          title,
          { ...input, newLayoutId: copy.id },
          source,
          { summary },
        ),
      }
    },

    remove: (ref, source = 'manual') => {
      const type = 'layouts.delete'
      const title = 'Delete layout'
      const input = { scope: ref.scope, layoutId: ref.id }
      const blocker = changeBlocker(ref)
      if (blocker) return rejectWith(type, title, input, source, blocker)
      const saved = find(ref)!
      const { applied, defaultId } = store.getState()
      const wasDefault = ref.scope === 'project' && defaultId === ref.id
      const failure = commit(
        ref.scope,
        (list) => ({
          ...list,
          layouts: list.layouts.filter((each) => each.id !== ref.id),
        }),
        {
          ...(wasDefault ? { defaultId: null } : {}),
          ...(applied?.ref.scope === ref.scope && applied.ref.id === ref.id
            ? { applied: null }
            : {}),
        },
      )
      if (failure) return rejectWith(type, title, input, source, failure)
      const summary = `Deleted the ${SCOPE_LABELS[ref.scope].toLowerCase()} layout "${saved.name}".${wasDefault ? ' The project no longer opens with a default layout.' : ''}`
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
      if (!projectWritable) {
        return rejectWith(type, title, input, source, PROJECT_READ_ONLY)
      }
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
      const saved = find({ scope: 'project', id })
      if (!saved) {
        return rejectWith(
          type,
          title,
          input,
          source,
          `There is no project layout "${id}". Only project layouts can open with the project.`,
          'layoutId',
        )
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
        ref: { scope: 'project', id },
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
      return applyLayout(applied.ref, source, 'layouts.reset')
    },

    removeUnreadablePersonal: (source = 'manual') => {
      const type = 'layouts.removeUnreadable'
      const title = 'Remove unreadable personal layouts'
      const status = store.getState().personalStatus
      const unreadable = store.getState().personal.unreadable.length
      if (status.kind === 'unavailable') {
        return rejectWith(type, title, {}, source, status.message)
      }
      if (status.kind === 'ready' && unreadable === 0) {
        return rejectWith(
          type,
          title,
          {},
          source,
          'Every personal layout stored here can be read.',
        )
      }
      const result =
        status.kind === 'unreadable'
          ? removePersonalLayouts(storage, personalKey)
          : writePersonalLayouts(
              storage,
              { ...store.getState().personal, unreadable: [] },
              personalKey,
            )
      if (!result.ok) return rejectWith(type, title, {}, source, result.message)
      store.setState({
        personal: {
          layouts:
            status.kind === 'unreadable'
              ? []
              : store.getState().personal.layouts,
          unreadable: [],
        },
        personalStatus: { kind: 'ready' },
      })
      const summary =
        'Removed the personal layouts that could not be read. New personal layouts can be kept again.'
      return {
        status: 'applied',
        summary,
        operationId: record(type, title, {}, source, { summary }),
      }
    },

    resetForProject: (saved, key) => {
      sessionView = saved
      const project = parseLayoutList(saved?.layouts, 'project')
      const defaultId = defaultFrom(saved, project)
      store.setState({
        project,
        defaultId,
        keptDefaultId: keptDefaultFrom(saved, project),
        applied: null,
        openedView: null,
      })
      if (!defaultId) return
      const outcome = applyLayout(
        { scope: 'project', id: defaultId },
        'system',
        'layouts.apply',
      )
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
      const stored = parseLayoutList(saved?.layouts, 'project')
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
  find: (ref: LayoutRef) => SavedLayout | null,
): string | null {
  const { applied } = snapshot
  if (!applied) {
    return 'No saved layout has been applied in this project yet. Apply one from View > Layouts first, or use Reset layout for the default arrangement.'
  }
  if (!find(applied.ref)) {
    return `The layout "${applied.name}" was deleted, so there is nothing to reset to.`
  }
  return null
}
