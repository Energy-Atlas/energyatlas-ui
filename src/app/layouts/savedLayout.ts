import { z } from 'zod'
import type { CommandSource, WorkbenchState } from '../../domain/types.ts'
import {
  defaultLayers,
  readStoredLayers,
  type MapLayer,
} from '../pages/mapLayers.ts'
import { LIGHTING_LIMITS, type LightingState } from '../pages/lighting.ts'
import { MAX_EXAGGERATION, MIN_EXAGGERATION } from '../pages/terrain.ts'
import {
  parseStoredTables,
  type TableSettings,
} from '../tables/tableSettings.ts'
import {
  chartSpecInputSchema,
  validateChartSpec,
  type ChartSpec,
} from '../view/chartSpec.ts'
import type { JobFilter, TableView, ViewState } from '../view/viewOperations.ts'

// A saved layout (decision 0032): a named panel arrangement plus the view
// settings shown with it. Project layouts are saved with the project and will
// travel in a handover package; personal layouts stay in this browser and
// work in every project. Both share this shape and its validation.

/** Bumped when a change makes older layouts unreadable; they then fall back. */
export const LAYOUT_FORMAT = 1

export type LayoutScope = 'project' | 'personal'

export const SCOPE_LABELS: Record<LayoutScope, string> = {
  project: 'Project',
  personal: 'Personal',
}

/** Most layouts kept per scope, so menus and saved projects stay small. */
export const MAX_LAYOUTS_PER_SCOPE = 50
export const MAX_LAYOUT_NAME = 60

/**
 * The view settings a layout carries. Selections, drafts (the intake
 * mapping), the chosen job, appearance, and the basemap preference stay out:
 * they belong to the person or the moment, not to an arrangement.
 */
export type ViewSnapshot = {
  /** Table arrangements by table id (decision 0029). */
  tables: Record<string, TableSettings>
  map: {
    /** The layer stack, top first (decision 0031). */
    layers: MapLayer[]
    view3d: boolean
    terrain: boolean
    terrainExaggeration: number
    lighting: LightingState
  }
  /** The Table page's view and text filter. */
  table: { view: TableView; quickFilter: string }
  /** Scenarios left out of the Dashboard comparison, and added charts. */
  dashboard: { hiddenScenarioIds: string[]; charts: ChartSpec[] }
  /** The Jobs list filter. */
  jobs: { filter: JobFilter }
  /** The chosen result, drilled-down building, and resolution. */
  results: {
    resultId: string
    buildingId: string | null
    resolution: 'monthly' | 'hourly'
  }
}

export type SavedLayout = {
  format: typeof LAYOUT_FORMAT
  id: string
  name: string
  scope: LayoutScope
  createdAt: string
  updatedAt: string
  /** Who saved it, for provenance in the asset tree. */
  createdBy: CommandSource
  /** The FlexLayout model JSON, prepared again by the layout controller on apply. */
  arrangement: Record<string, unknown>
  /** Sections are read one by one on apply, so one broken section never blocks the rest. */
  view: Record<string, unknown>
}

export const layoutNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a layout name.')
  .max(MAX_LAYOUT_NAME, `Use at most ${MAX_LAYOUT_NAME} characters.`)

const arrangementSchema = z.looseObject({
  global: z.record(z.string(), z.unknown()).optional(),
  borders: z.array(z.unknown()).optional(),
  layout: z.looseObject({ type: z.literal('row') }),
})

export const savedLayoutSchema = z.object({
  format: z.literal(LAYOUT_FORMAT),
  id: z.string().min(1).max(100),
  name: layoutNameSchema,
  scope: z.enum(['project', 'personal']),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.enum(['manual', 'agent', 'system']),
  arrangement: arrangementSchema,
  view: z.record(z.string(), z.unknown()),
})

/** Valid layouts of one scope, and the entries that are not, kept as stored. */
export type LayoutList = { layouts: SavedLayout[]; unreadable: unknown[] }

/**
 * Reads stored layouts. An entry that does not parse, belongs to another
 * scope, or repeats an id is kept aside unchanged, so saving never erases
 * what a newer version wrote.
 */
export function parseLayoutList(
  value: unknown,
  scope: LayoutScope,
): LayoutList {
  const list: LayoutList = { layouts: [], unreadable: [] }
  if (!Array.isArray(value)) return list
  const ids = new Set<string>()
  for (const entry of value) {
    const parsed = savedLayoutSchema.safeParse(entry)
    if (
      parsed.success &&
      parsed.data.scope === scope &&
      !ids.has(parsed.data.id)
    ) {
      ids.add(parsed.data.id)
      list.layouts.push(parsed.data)
    } else {
      list.unreadable.push(entry)
    }
  }
  return list
}

/** What a scope saves: readable layouts, then unreadable ones as found. */
export function storedLayouts(list: LayoutList): unknown[] {
  return [...list.layouts, ...list.unreadable]
}

/** Whether two lists of one scope would save differently. */
export function layoutListsDiffer(a: LayoutList, b: LayoutList): boolean {
  return JSON.stringify(storedLayouts(a)) !== JSON.stringify(storedLayouts(b))
}

/** The view settings to keep in a layout. */
export function captureViewSnapshot(view: ViewState): ViewSnapshot {
  return structuredClone({
    tables: view.tables,
    map: {
      layers: view.map.layers,
      view3d: view.map.view3d,
      terrain: view.map.terrain,
      terrainExaggeration: view.map.terrainExaggeration,
      lighting: view.map.lighting,
    },
    table: view.table,
    dashboard: view.dashboard,
    jobs: { filter: view.jobs.filter },
    results: view.results,
  })
}

const percent = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max)

const SECTIONS = {
  tables: z.record(z.string(), z.unknown()),
  map: z.object({
    layers: z.array(z.unknown()),
    view3d: z.boolean(),
    terrain: z.boolean(),
    terrainExaggeration: z
      .number()
      .int()
      .min(MIN_EXAGGERATION)
      .max(MAX_EXAGGERATION),
    lighting: z.object({
      dayOfYear: percent(LIGHTING_LIMITS.dayOfYear),
      minutesUtc: percent(LIGHTING_LIMITS.minutesUtc),
      intensityPercent: percent(LIGHTING_LIMITS.intensityPercent),
      diffusionPercent: percent(LIGHTING_LIMITS.diffusionPercent),
      hazePercent: percent(LIGHTING_LIMITS.hazePercent),
    }),
  }),
  table: z.object({
    view: z.enum(['buildings', 'grid']),
    quickFilter: z.string().max(100),
  }),
  dashboard: z.object({
    hiddenScenarioIds: z.array(z.string()),
    charts: z.array(z.unknown()),
  }),
  jobs: z.object({
    filter: z.enum(['all', 'active', 'attention', 'finished']),
  }),
  results: z.object({
    resultId: z.string().min(1),
    buildingId: z.string().min(1).nullable(),
    resolution: z.enum(['monthly', 'hourly']),
  }),
}

const SECTION_LABELS: Record<keyof typeof SECTIONS, string> = {
  tables: 'table arrangements',
  map: 'map settings',
  table: 'Table page view',
  dashboard: 'Dashboard settings',
  jobs: 'Jobs filter',
  results: 'Results choice',
}

const chartSchema = chartSpecInputSchema.and(
  z.object({ id: z.string().min(1) }),
)

function publishedResult(project: WorkbenchState, resultId: string) {
  return resultId === 'baseline'
    ? project.results.baseline
    : project.results.scenarios[resultId]
}

/**
 * Applies a layout's view settings to a view state (an Immer draft in the
 * view store) and returns notes on what could not be applied. Sections the
 * layout lacks stay as they are; a section that does not parse is skipped;
 * values that do not fit this project (charts, results, scenarios) are left
 * out with a note.
 */
export function applyViewSnapshot(
  view: ViewState,
  snapshot: Record<string, unknown>,
  project: WorkbenchState,
): string[] {
  const notes: string[] = []
  const section = <Key extends keyof typeof SECTIONS>(
    key: Key,
  ): z.output<(typeof SECTIONS)[Key]> | null => {
    if (snapshot[key] === undefined) return null
    const parsed = SECTIONS[key].safeParse(snapshot[key])
    if (parsed.success) return parsed.data as z.output<(typeof SECTIONS)[Key]>
    notes.push(
      `The ${SECTION_LABELS[key]} in this layout could not be read and were left as they are.`,
    )
    return null
  }

  const tables = section('tables')
  if (tables) view.tables = parseStoredTables(tables)

  const map = section('map')
  if (map) {
    const layers = readStoredLayers(map.layers)
    if (!layers) {
      notes.push(
        'The map layers in this layout could not be read; the map shows its default layers.',
      )
    }
    view.map.layers = layers ?? defaultLayers()
    view.map.view3d = map.view3d
    // Terrain belongs to the 3D scene, as map.setTerrain requires.
    view.map.terrain = map.terrain && map.view3d
    view.map.terrainExaggeration = map.terrainExaggeration
    view.map.lighting = map.lighting
  }

  const table = section('table')
  if (table) view.table = table

  const dashboard = section('dashboard')
  if (dashboard) {
    view.dashboard.hiddenScenarioIds = dashboard.hiddenScenarioIds.filter(
      (id) => project.scenarios[id] !== undefined,
    )
    const charts: ChartSpec[] = []
    let dropped = 0
    for (const entry of dashboard.charts) {
      const parsed = chartSchema.safeParse(entry)
      if (
        parsed.success &&
        validateChartSpec(parsed.data, project).length === 0
      ) {
        charts.push(parsed.data)
      } else {
        dropped += 1
      }
    }
    view.dashboard.charts = charts
    // New charts must not reuse an id a restored chart carries.
    const highest = charts.reduce((max, chart) => {
      const number = Number(/^chart-(\d+)$/.exec(chart.id)?.[1] ?? 0)
      return Math.max(max, number)
    }, 0)
    view.nextChartNumber = Math.max(view.nextChartNumber, highest + 1)
    if (dropped > 0) {
      notes.push(
        `${dropped} Dashboard chart${dropped === 1 ? '' : 's'} need results this project has not published and ${dropped === 1 ? 'was' : 'were'} left out.`,
      )
    }
  }

  const jobs = section('jobs')
  if (jobs) view.jobs.filter = jobs.filter

  const results = section('results')
  if (results) {
    const shown = publishedResult(project, results.resultId)
    if (shown) {
      view.results.resultId = results.resultId
    } else {
      view.results.resultId = 'baseline'
      if (results.resultId !== 'baseline') {
        notes.push(
          `The layout shows the result "${results.resultId}", which this project has not published; Results show the baseline.`,
        )
      }
    }
    const result = publishedResult(project, view.results.resultId)
    const building =
      results.buildingId !== null &&
      result?.byBuildingKwh[results.buildingId] !== undefined
        ? results.buildingId
        : null
    view.results.buildingId = building
    view.results.resolution = building ? results.resolution : 'monthly'
  }

  return notes
}

/** A fresh layout id. */
export function newLayoutId(): string {
  return `layout-${crypto.randomUUID()}`
}

/** A name not used in the list: "Name", then "Name (2)", "Name (3)". */
export function uniqueLayoutName(
  name: string,
  layouts: SavedLayout[],
  exceptId?: string,
): string {
  const taken = new Set(
    layouts
      .filter((layout) => layout.id !== exceptId)
      .map((layout) => layout.name.toLowerCase()),
  )
  const base = name.slice(0, MAX_LAYOUT_NAME)
  if (!taken.has(base.toLowerCase())) return base
  for (let number = 2; ; number += 1) {
    const suffix = ` (${number})`
    const candidate = `${base.slice(0, MAX_LAYOUT_NAME - suffix.length)}${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
