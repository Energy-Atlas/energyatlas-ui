import { z } from 'zod'
import type { ValidationIssue } from '../../domain/commands.ts'
import { findDataset } from '../../domain/intake/datasets.ts'
import {
  TARGET_FIELDS,
  isTargetField,
  suggestIntakeMatches,
  withTarget,
} from '../../domain/intake/fusion.ts'
import type { Suggestions } from '../../domain/mapping/mapping.ts'
import { sourceCollection } from '../../domain/schema/matching.ts'
import { previewAssignment } from '../../domain/archetypes/assignment.ts'
import {
  previewScenarioRules,
  scenarioRules,
} from '../../domain/scenarios/rules.ts'
import { PART_LABELS } from '../../domain/archetypes/parts.ts'
import type {
  FieldMapping,
  PartKind,
  SelectableEntity,
  WorkbenchState,
} from '../../domain/types.ts'
import { PART_KINDS } from '../../domain/types.ts'
import { computeMetric, METRICS } from '../pages/mapMetrics.ts'
import {
  BUILDING_COLORS,
  colorLabel,
  defaultLayers,
  LAYER_KINDS,
  MAP_LAYER_KINDS,
  newLayer,
  nextLayerId,
  parseStoredLayers,
  type MapLayer,
  type MapLayerKind,
} from '../pages/mapLayers.ts'
import {
  createInitialLighting,
  LIGHTING_LIMITS,
  type LightingState,
} from '../pages/lighting.ts'
import { dayOfYearLabel, timeOfDayLabel } from '../pages/sunPosition.ts'
import {
  exaggerationLabel,
  MAX_EXAGGERATION,
  MIN_EXAGGERATION,
} from '../pages/terrain.ts'
import { applyViewSnapshot } from '../layouts/savedLayout.ts'
import { TABLE_VIEWS, type TableView } from './tableViews.ts'
import { describeTableChange, tableChangeIssue } from '../tables/tableChange.ts'
import { registeredTable, registeredTableIds } from '../tables/tableRegistry.ts'
import {
  applyTableChange,
  defaultTableSettings,
  parseStoredTables,
  tableChangeSchema,
  type TableSettings,
} from '../tables/tableSettings.ts'
import {
  chartSpecInputSchema,
  validateChartSpec,
  type ChartSpec,
} from './chartSpec.ts'
import { selectedBuildingIds } from '../../domain/zoning/zoning.ts'
import { MAX_ZONED_BUILDINGS } from '../pages/zoneFeatures.ts'

// View operations change what the workbench shows, not the project model. Like
// commands they validate their input and return a result, and every one is
// recorded in the shared operation log with its source, so manual controls and
// the agent use one path (first-slice stage 4, prerequisite 1). View state is
// not undoable; only table arrangements and the map's layers are saved with
// the project.

export type { TableView } from './tableViews.ts'

const TABLE_VIEW_NAMES: Record<TableView, string> = {
  buildings: 'buildings',
  floors: 'the floors of every building',
  zones: 'the zones of every building',
  grid: 'grid elements',
}

/** What a map zoom names, by the kind of selection the map shows. */
const MAP_SELECTION_NOUNS: Partial<Record<SelectableEntity, string>> = {
  building: 'building(s)',
  floor: 'floor(s)',
  zone: 'zone(s)',
  gridElement: 'grid element(s)',
}

/** Which jobs the Jobs list shows. */
export type JobFilter = 'all' | 'active' | 'attention' | 'finished'

export const JOB_FILTERS: Record<JobFilter, string> = {
  all: 'All',
  active: 'Active',
  attention: 'Needs attention',
  finished: 'Finished',
}

export type ViewState = {
  map: {
    /**
     * The layer stack, top first (decision 0031). Saved with the project and
     * restored when it opens.
     */
    layers: MapLayer[]
    /** Increments when a map.focusSelection operation asks the map to zoom. */
    focusRequest: number
    /**
     * The 3D view, a basemap setting (decision 0031): the map tilts, and
     * building layers that extrude show their heights (decision 0013).
     */
    view3d: boolean
    /** Whether live terrain is shown, for display only (decision 0015). */
    terrain: boolean
    /** Vertical exaggeration of the terrain; 1 is true scale. */
    terrainExaggeration: number
    /** Contextual lighting for the 3D scene, display only (decision 0018). */
    lighting: LightingState
  }
  table: { view: TableView; quickFilter: string }
  dashboard: { hiddenScenarioIds: string[]; charts: ChartSpec[] }
  /** The Jobs page's selected job and list filter; selecting never edits the project. */
  jobs: { selectedTaskId: string | null; filter: JobFilter }
  /**
   * Which part the assignment preview counts on the Archetypes page
   * (decision 0032); "all" counts every part.
   */
  archetypes: { previewPart: PartKind | 'all' }
  /**
   * Which scenario's rules and preview the Scenarios page shows
   * (decision 0032, stage 3); null shows the first scenario.
   */
  scenarios: { previewScenarioId: string | null }
  /**
   * The data intake draft: a dataset, its mapping, suggestions waiting for
   * review, and the field whose values are shown; not sent until applied.
   */
  intake: {
    datasetId: string | null
    mapping: FieldMapping
    suggestions: Suggestions
    field: string | null
  }
  /** The source attribute whose values the Schema matching page shows (decision 0032, stage 4). */
  schema: { source: string | null }
  /** The Results page's chosen result, drilled-down building, and resolution. */
  results: {
    resultId: string
    buildingId: string | null
    resolution: 'monthly' | 'hourly'
  }
  nextChartNumber: number
  /**
   * How each table is arranged, by table id (decision 0027). Saved with the
   * project and restored when it opens (decision 0028).
   */
  tables: Record<string, TableSettings>
}

export function createInitialViewState(
  tables: Record<string, TableSettings> = {},
  layers: MapLayer[] = defaultLayers(),
): ViewState {
  return {
    map: {
      layers,
      focusRequest: 0,
      view3d: false,
      terrain: false,
      terrainExaggeration: MIN_EXAGGERATION,
      lighting: createInitialLighting(),
    },
    table: { view: 'buildings', quickFilter: '' },
    dashboard: { hiddenScenarioIds: [], charts: [] },
    jobs: { selectedTaskId: null, filter: 'all' },
    archetypes: { previewPart: 'all' },
    scenarios: { previewScenarioId: null },
    intake: { datasetId: null, mapping: {}, suggestions: {}, field: null },
    schema: { source: null },
    results: { resultId: 'baseline', buildingId: null, resolution: 'monthly' },
    nextChartNumber: 1,
    tables,
  }
}

export type ViewOutcome =
  | {
      status: 'applied'
      summary: string
      /** What could not be applied, such as parts of a saved layout. */
      notes?: string[]
    }
  | { status: 'rejected'; issues: ValidationIssue[] }

type ViewOperationDefinition<Schema extends z.ZodType> = {
  title: string
  /** Written for agent tool descriptions. */
  description: string
  /**
   * Run only by another operation that records its own entry, such as
   * applying a saved layout; left out of the agent's tool catalog.
   */
  internal?: boolean
  input: Schema
  run: (
    view: ViewState,
    input: z.output<Schema>,
    project: WorkbenchState,
  ) => ViewOutcome
}

function defineViewOperation<Schema extends z.ZodType>(
  definition: ViewOperationDefinition<Schema>,
): ViewOperationDefinition<Schema> {
  return definition
}

function unknownLayer(layerId: string): string {
  return `The map has no layer "${layerId}".`
}

/** Why buildings cannot be colored by a metric yet, if they cannot. */
function colorIssue(
  metric: (typeof METRICS)[number]['id'],
  project: WorkbenchState,
): string | null {
  if (computeMetric(project, metric).available) return null
  const definition = METRICS.find((candidate) => candidate.id === metric)
  return `${definition?.label ?? metric} has no data yet. ${definition?.requirement ?? ''}`.trim()
}

function applied(summary: string): ViewOutcome {
  return { status: 'applied', summary }
}

function rejected(message: string, path = ''): ViewOutcome {
  return { status: 'rejected', issues: [{ path, message }] }
}

const EXAGGERATION_MESSAGE = `Use a whole number from ${MIN_EXAGGERATION} to ${MAX_EXAGGERATION}.`

export const viewOperationDefinitions = {
  'view.resetForProject': defineViewOperation({
    title: 'Reset project views',
    description:
      'Clear project-specific view state when the project session changes, restoring the table arrangements and map layers saved with the project.',
    input: z.object({
      /** The table arrangements saved with the project; invalid ones are dropped. */
      tables: z.record(z.string(), z.unknown()).optional(),
      /** The map's layers saved with the project; unreadable ones give the defaults. */
      layers: z.unknown().optional(),
    }),
    run(view, { tables, layers }) {
      Object.assign(
        view,
        createInitialViewState(
          parseStoredTables(tables),
          parseStoredLayers(layers),
        ),
      )
      return applied('Reset project-specific views for the new session.')
    },
  }),
  'view.applyLayout': defineViewOperation({
    title: 'Apply layout view settings',
    description:
      'Apply the view settings of a saved layout. Saved-layout operations run it; call layouts.apply instead.',
    internal: true,
    input: z.object({
      name: z.string().min(1),
      view: z.record(z.string(), z.unknown()),
    }),
    run(view, input, project) {
      const notes = applyViewSnapshot(view, input.view, project)
      return {
        status: 'applied',
        summary: `Applied the view settings of "${input.name}".`,
        notes,
      }
    },
  }),
  'map.setMetric': defineViewOperation({
    title: 'Color map by metric',
    description:
      'Color building footprints on the Map by one metric. A metric without data is rejected with the stage that produces it.',
    input: z.object({
      metric: z.enum([
        'floors',
        'pvYield',
        'baselineDemand',
        'scenarioReduction',
      ]),
    }),
    run(view, { metric }, project) {
      // The agent's shortcut: it colors the top building layer.
      const layer = view.map.layers.find((each) => each.kind === 'buildings')
      if (!layer) {
        return rejected('The map has no building layer. Add one first.')
      }
      const issue = colorIssue(metric, project)
      if (issue) return rejected(issue, 'metric')
      layer.colorBy = metric
      return applied(`Map buildings are colored by ${colorLabel(metric)}.`)
    },
  }),

  'map.addLayer': defineViewOperation({
    title: 'Add a map layer',
    description: `Add a layer above the others on the Map. Kinds: ${MAP_LAYER_KINDS.map((kind) => `${kind} (${LAYER_KINDS[kind].description})`).join('; ')}. Several layers may show the same objects.`,
    input: z.object({
      kind: z.enum(MAP_LAYER_KINDS as [MapLayerKind, ...MapLayerKind[]]),
      name: z.string().trim().min(1, 'Enter a name.').optional(),
    }),
    run(view, { kind, name }) {
      const layer = newLayer(nextLayerId(view.map.layers, kind), kind, name)
      view.map.layers.unshift(layer)
      return applied(`Added the map layer "${layer.name}" on top.`)
    },
  }),

  'map.removeLayer': defineViewOperation({
    title: 'Remove a map layer',
    description: 'Remove one layer from the Map; the project is not changed.',
    input: z.object({ layerId: z.string() }),
    run(view, { layerId }) {
      const index = view.map.layers.findIndex((layer) => layer.id === layerId)
      const layer = view.map.layers[index]
      if (!layer) return rejected(unknownLayer(layerId), 'layerId')
      view.map.layers.splice(index, 1)
      return applied(`Removed the map layer "${layer.name}".`)
    },
  }),

  'map.moveLayer': defineViewOperation({
    title: 'Move a map layer',
    description:
      'Move one Map layer to a position in the stack, counted from the top: 0 is drawn above all others.',
    input: z.object({
      layerId: z.string(),
      position: z.number().int().min(0, 'Use a position from 0.'),
    }),
    run(view, { layerId, position }) {
      const layers = view.map.layers
      const index = layers.findIndex((layer) => layer.id === layerId)
      const layer = layers[index]
      if (!layer) return rejected(unknownLayer(layerId), 'layerId')
      if (position > layers.length - 1) {
        return rejected(
          `Use a position from 0 to ${layers.length - 1}.`,
          'position',
        )
      }
      if (position === index) {
        return rejected(`"${layer.name}" is already there.`, 'position')
      }
      layers.splice(index, 1)
      layers.splice(position, 0, layer)
      return applied(
        `Moved the map layer "${layer.name}" to position ${position + 1} of ${layers.length}.`,
      )
    },
  }),

  'map.setLayerVisible': defineViewOperation({
    title: 'Show or hide a map layer',
    description: 'Show or hide one layer on the Map.',
    input: z.object({ layerId: z.string(), visible: z.boolean() }),
    run(view, { layerId, visible }) {
      const layer = view.map.layers.find((each) => each.id === layerId)
      if (!layer) return rejected(unknownLayer(layerId), 'layerId')
      layer.visible = visible
      return applied(
        `The map ${visible ? 'shows' : 'hides'} the layer "${layer.name}".`,
      )
    },
  }),

  'map.setLayerStyle': defineViewOperation({
    title: 'Style a map layer',
    description: `Rename a Map layer or set its opacity (0 to 100). Building layers also take colorBy (${BUILDING_COLORS.join(', ')}; a metric without data is rejected), extrude (shown at their heights in the 3D view), and floorSlabs (an extruded building drawn as a stack of floor slabs, one per storey).`,
    input: z.object({
      layerId: z.string(),
      name: z.string().trim().min(1, 'Enter a name.').optional(),
      opacityPercent: z
        .number()
        .int('Use a whole percentage.')
        .min(0, 'Use 0 to 100.')
        .max(100, 'Use 0 to 100.')
        .optional(),
      colorBy: z.enum(BUILDING_COLORS).optional(),
      extrude: z.boolean().optional(),
      floorSlabs: z.boolean().optional(),
    }),
    run(view, input, project) {
      const layer = view.map.layers.find((each) => each.id === input.layerId)
      if (!layer) return rejected(unknownLayer(input.layerId), 'layerId')
      const buildingOnly =
        input.colorBy !== undefined ||
        input.extrude !== undefined ||
        input.floorSlabs !== undefined
      if (buildingOnly && layer.kind !== 'buildings') {
        return rejected(
          `"${layer.name}" shows ${LAYER_KINDS[layer.kind].label.toLowerCase()}; only building layers are colored by a metric or extruded.`,
          input.colorBy !== undefined
            ? 'colorBy'
            : input.extrude !== undefined
              ? 'extrude'
              : 'floorSlabs',
        )
      }
      if (input.colorBy !== undefined && input.colorBy !== 'single') {
        const issue = colorIssue(input.colorBy, project)
        if (issue) return rejected(issue, 'colorBy')
      }
      const changes: string[] = []
      if (input.name !== undefined && input.name !== layer.name) {
        changes.push(`renamed from "${layer.name}"`)
        layer.name = input.name
      }
      if (input.opacityPercent !== undefined) {
        layer.opacityPercent = input.opacityPercent
        changes.push(`opacity ${input.opacityPercent}%`)
      }
      if (input.colorBy !== undefined) {
        layer.colorBy = input.colorBy
        changes.push(`colored by ${colorLabel(input.colorBy)}`)
      }
      if (input.extrude !== undefined) {
        layer.extrude = input.extrude
        changes.push(input.extrude ? 'extruded in 3D' : 'flat in 3D')
      }
      if (input.floorSlabs !== undefined) {
        layer.floorSlabs = input.floorSlabs
        changes.push(
          input.floorSlabs
            ? 'extruded buildings drawn floor by floor'
            : 'extruded buildings drawn whole',
        )
      }
      if (changes.length === 0) return rejected('Nothing to change.')
      return applied(`Map layer "${layer.name}": ${changes.join(', ')}.`)
    },
  }),

  'map.focusSelection': defineViewOperation({
    title: 'Zoom map to selection',
    description:
      'Zoom the Map to the buildings, floors or zones (their buildings), or grid elements in the shared selection.',
    input: z.object({}),
    run(view, _input, project) {
      const { entityType, ids } = project.selection
      if (!entityType || ids.length === 0) {
        return rejected('Nothing is selected to zoom to.')
      }
      const noun = MAP_SELECTION_NOUNS[entityType]
      if (!noun) {
        return rejected(
          'The selection is not on the map. Select buildings, floors, zones, or grid elements first.',
        )
      }
      view.map.focusRequest += 1
      // Zones are drawn for the first buildings only (decision 0034); say so
      // rather than leave the rest unexplained.
      const owners = selectedBuildingIds(project.selection).length
      const beyond =
        view.map.view3d && owners > MAX_ZONED_BUILDINGS
          ? ` Zones are drawn for the first ${MAX_ZONED_BUILDINGS} of ${owners} buildings.`
          : ''
      return applied(
        `Zoomed the map to ${ids.length} selected ${noun}.${beyond}`,
      )
    },
  }),

  'map.set3d': defineViewOperation({
    title: 'Show the map in 3D',
    description:
      'Turn the 3D view on or off, a basemap setting: the Map tilts, shows terrain and lighting when they are on, and building layers that extrude show their synthetic heights. Buildings stay flat until "Geospatial preprocessing" has computed heights.',
    input: z.object({ enabled: z.boolean() }),
    run(view, { enabled }, project) {
      view.map.view3d = enabled
      if (!enabled) return applied('The map is shown flat, in 2D.')
      const hasHeights = project.buildingIds.some(
        (id) => (project.buildings[id]?.heightM ?? null) !== null,
      )
      return applied(
        hasHeights
          ? 'The map is shown in 3D.'
          : 'The map is in 3D, but buildings stay flat until "Geospatial preprocessing" computes heights.',
      )
    },
  }),

  'map.setTerrain': defineViewOperation({
    title: 'Show or hide terrain',
    description:
      'Show live 3D terrain with hillshade under the Map, for display only; it never changes project data. Relief is visible when the map is tilted in 3D.',
    input: z.object({ enabled: z.boolean() }),
    run(view, { enabled }) {
      // Terrain belongs to the 3D scene; a flat map never shows relief.
      if (enabled && !view.map.view3d) {
        return rejected(
          'Terrain needs the 3D view. Turn on the 3D view first.',
          'enabled',
        )
      }
      view.map.terrain = enabled
      if (!enabled) return applied('The map hides terrain.')
      const scale = exaggerationLabel(view.map.terrainExaggeration)
      return applied(`The map shows terrain at ${scale}.`)
    },
  }),

  'map.setTerrainExaggeration': defineViewOperation({
    title: 'Set terrain exaggeration',
    description: `Set the vertical exaggeration of Map terrain as a whole number from ${MIN_EXAGGERATION} (true scale) to ${MAX_EXAGGERATION}.`,
    input: z.object({
      exaggeration: z
        .number()
        .int(EXAGGERATION_MESSAGE)
        .min(MIN_EXAGGERATION, EXAGGERATION_MESSAGE)
        .max(MAX_EXAGGERATION, EXAGGERATION_MESSAGE),
    }),
    run(view, { exaggeration }) {
      view.map.terrainExaggeration = exaggeration
      return applied(`Terrain is shown at ${exaggerationLabel(exaggeration)}.`)
    },
  }),

  'map.setSeason': defineViewOperation({
    title: 'Set the season on the map',
    description: `Set the day of the year that lights the 3D map scene, from ${LIGHTING_LIMITS.dayOfYear.min} to ${LIGHTING_LIMITS.dayOfYear.max}. Lighting is display only and changes no result.`,
    input: z.object({
      dayOfYear: z
        .number()
        .int()
        .min(LIGHTING_LIMITS.dayOfYear.min)
        .max(LIGHTING_LIMITS.dayOfYear.max),
    }),
    run(view, { dayOfYear }) {
      view.map.lighting.dayOfYear = dayOfYear
      return applied(`Map lighting is set to ${dayOfYearLabel(dayOfYear)}.`)
    },
  }),

  'map.setTimeOfDay': defineViewOperation({
    title: 'Set the time of day on the map',
    description: `Set the time that lights the 3D map scene, as minutes past midnight UTC from ${LIGHTING_LIMITS.minutesUtc.min} to ${LIGHTING_LIMITS.minutesUtc.max}. Display only.`,
    input: z.object({
      minutesUtc: z
        .number()
        .int()
        .min(LIGHTING_LIMITS.minutesUtc.min)
        .max(LIGHTING_LIMITS.minutesUtc.max),
    }),
    run(view, { minutesUtc }) {
      view.map.lighting.minutesUtc = minutesUtc
      return applied(`Map lighting is set to ${timeOfDayLabel(minutesUtc)}.`)
    },
  }),

  'map.setLightIntensity': defineViewOperation({
    title: 'Set the map light intensity',
    description: `Set how bright the scene light is, as a percentage from ${LIGHTING_LIMITS.intensityPercent.min} to ${LIGHTING_LIMITS.intensityPercent.max}.`,
    input: z.object({
      percent: z
        .number()
        .int()
        .min(LIGHTING_LIMITS.intensityPercent.min)
        .max(LIGHTING_LIMITS.intensityPercent.max),
    }),
    run(view, { percent }) {
      view.map.lighting.intensityPercent = percent
      return applied(`Scene light intensity is ${percent}%.`)
    },
  }),

  'map.setSunDiffusion': defineViewOperation({
    title: 'Set the sun diffusion on the map',
    description: `Set how soft the sun is, as a percentage from ${LIGHTING_LIMITS.diffusionPercent.min} to ${LIGHTING_LIMITS.diffusionPercent.max}. A softer sun widens the day-to-night transition and spreads the glow around the horizon.`,
    input: z.object({
      percent: z
        .number()
        .int()
        .min(LIGHTING_LIMITS.diffusionPercent.min)
        .max(LIGHTING_LIMITS.diffusionPercent.max),
    }),
    run(view, { percent }) {
      view.map.lighting.diffusionPercent = percent
      return applied(`Sun diffusion is ${percent}%.`)
    },
  }),

  'map.setHaze': defineViewOperation({
    title: 'Set the haze on the map',
    description: `Set horizon occlusion and dustiness, as a percentage from ${LIGHTING_LIMITS.hazePercent.min} to ${LIGHTING_LIMITS.hazePercent.max}. Haze thickens the fog and dims the light.`,
    input: z.object({
      percent: z
        .number()
        .int()
        .min(LIGHTING_LIMITS.hazePercent.min)
        .max(LIGHTING_LIMITS.hazePercent.max),
    }),
    run(view, { percent }) {
      view.map.lighting.hazePercent = percent
      return applied(`Horizon haze is ${percent}%.`)
    },
  }),

  'table.setView': defineViewOperation({
    title: 'Switch table view',
    description:
      'Show buildings, floors, zones (of the published zoning, decision 0032), or grid elements on the Table page.',
    input: z.object({ view: z.enum(TABLE_VIEWS) }),
    run(view, input) {
      view.table.view = input.view
      return applied(`The table shows ${TABLE_VIEW_NAMES[input.view]}.`)
    },
  }),

  'table.setQuickFilter': defineViewOperation({
    title: 'Filter table',
    description:
      'Filter the buildings table by text across its columns. An empty text clears the filter.',
    input: z.object({
      text: z.string().max(100, 'Use at most 100 characters.'),
    }),
    run(view, { text }) {
      view.table.quickFilter = text
      return applied(
        text
          ? `Filtered the buildings table by "${text}".`
          : 'Cleared the table filter.',
      )
    },
  }),

  'dashboard.setScenarioCompared': defineViewOperation({
    title: 'Compare scenario on dashboard',
    description:
      'Include or exclude a scenario from the Dashboard comparison charts and tiles.',
    input: z.object({
      scenarioId: z.string().min(1, 'Choose a scenario.'),
      compared: z.boolean(),
    }),
    run(view, { scenarioId, compared }, project) {
      const scenario = project.scenarios[scenarioId]
      if (!scenario) {
        return rejected(`Unknown scenario "${scenarioId}".`, 'scenarioId')
      }
      const hidden = new Set(view.dashboard.hiddenScenarioIds)
      if (compared) hidden.delete(scenarioId)
      else hidden.add(scenarioId)
      view.dashboard.hiddenScenarioIds = [...hidden]
      return applied(
        compared
          ? `The Dashboard compares "${scenario.name}".`
          : `The Dashboard no longer compares "${scenario.name}".`,
      )
    },
  }),

  'jobs.select': defineViewOperation({
    title: 'Select job',
    description:
      'Show a job in the Jobs detail pane, or clear the selection with null. Selecting a job does not change the project.',
    input: z.object({ taskId: z.string().min(1).nullable() }),
    run(view, { taskId }, project) {
      if (taskId === null) {
        view.jobs.selectedTaskId = null
        return applied('No job is selected.')
      }
      const task = project.tasks[taskId]
      if (!task) return rejected(`Unknown job "${taskId}".`, 'taskId')
      view.jobs.selectedTaskId = taskId
      return applied(`Selected "${task.label}", attempt ${task.attempt}.`)
    },
  }),

  'jobs.setFilter': defineViewOperation({
    title: 'Filter jobs',
    description:
      'Show all jobs, only active (queued or running) ones, ones needing attention (failed, cancelled, or not run), or finished ones.',
    input: z.object({
      filter: z.enum(['all', 'active', 'attention', 'finished']),
    }),
    run(view, { filter }) {
      view.jobs.filter = filter
      return applied(`Jobs list shows: ${JOB_FILTERS[filter].toLowerCase()}.`)
    },
  }),

  'archetypes.setPreviewPart': defineViewOperation({
    title: 'Preview a part',
    description:
      'Choose which archetype part the assignment preview on the Archetypes page counts: all, construction, systems, spaceLoads, or externalLoads. The summary reports, for that part, how many buildings each rule takes and how many stay unassigned with the current rules, before Archetype modeling runs.',
    input: z.object({ part: z.enum(['all', ...PART_KINDS]) }),
    run(view, { part }, project) {
      view.archetypes.previewPart = part
      const preview = previewAssignment(project)
      const kinds = part === 'all' ? [...PART_KINDS] : [part]
      const taking = preview.rules
        .map((rule) => ({
          name: project.rules[rule.ruleId]?.name ?? rule.ruleId,
          count: kinds.reduce((sum, kind) => sum + rule.takes[kind], 0),
        }))
        .filter((rule) => rule.count > 0)
      const unassigned = kinds.reduce(
        (sum, kind) => sum + preview.unassigned[kind],
        0,
      )
      const label =
        part === 'all' ? 'all parts' : PART_LABELS[part].toLowerCase()
      return applied(
        `Previewing ${label}: ${taking.length === 0 ? 'no rule takes a part' : taking.map((rule) => `"${rule.name}" ${rule.count}`).join(', ')}; ${unassigned} unassigned of ${preview.buildings * kinds.length}.`,
      )
    },
  }),

  'scenarios.setPreviewScenario': defineViewOperation({
    title: 'Preview a scenario',
    description:
      'Choose which scenario the rule list and preview on the Scenarios page show, by scenario id. The summary reports, before Scenario modeling runs, how many buildings each rule matches and takes measures for, how many buildings take a measure, how many of those adopt at the scenario adoption and seed, and the estimate against the baseline when it exists.',
    input: z.object({ scenarioId: z.string().min(1, 'Choose a scenario.') }),
    run(view, { scenarioId }, project) {
      const scenario = project.scenarios[scenarioId]
      if (!scenario) {
        return rejected(`Unknown scenario "${scenarioId}".`, 'scenarioId')
      }
      view.scenarios.previewScenarioId = scenarioId
      const rules = scenarioRules(project, scenario)
      const preview = previewScenarioRules(project, {
        id: scenario.id,
        rules,
        adoptionPercent: scenario.adoptionPercent,
        adoptionSeed: scenario.adoptionSeed,
      })
      const taking = preview.rules
        .map((rule) => ({
          name: project.scenarioRules[rule.ruleId]?.name ?? rule.ruleId,
          count: Object.values(rule.takes).reduce((sum, n) => sum + n, 0),
        }))
        .filter((rule) => rule.count > 0)
      return applied(
        `Previewing "${scenario.name}": ${rules.length === 0 ? 'it has no rules' : taking.length === 0 ? 'no rule takes a measure' : taking.map((rule) => `"${rule.name}" ${rule.count} measures`).join(', ')}; ${preview.affectedIds.length} of ${preview.buildings} buildings take a measure and ${preview.adoptedIds.length} adopt at ${scenario.adoptionPercent}%, seed ${scenario.adoptionSeed}.${preview.estimate ? ` Estimated ${preview.estimate.reductionPercent}% lower annual demand than the baseline (synthetic).` : ` ${preview.reason ?? ''}`}`,
      )
    },
  }),

  'table.change': defineViewOperation({
    title: 'Arrange table',
    description:
      'Change how a table on screen shows its rows: hide or show a column, sort, filter a column (text "contains", a list of values for enum columns, or a numeric range), format a column (decimals, thousands separators, alignment, kWh shown as MWh), set the table style (compact or comfortable rows, shaded alternate rows, wrapped text, column widths fitted or even, first column frozen), or reset it. A table id and its column ids are named in the rejection when unknown.',
    input: z.object({
      tableId: z.string().min(1, 'Name the table.').max(100),
      change: tableChangeSchema,
    }),
    run(view, { tableId, change }) {
      const table = registeredTable(tableId)
      if (!table) {
        const open = registeredTableIds()
        return rejected(
          open.length
            ? `No table "${tableId}" is on screen. Tables on screen: ${open.join(', ')}.`
            : `No table "${tableId}" is on screen, and no table is open now.`,
          'tableId',
        )
      }
      const issue = tableChangeIssue(table, change)
      if (issue) return rejected(issue.message, issue.path)
      view.tables[tableId] = applyTableChange(
        view.tables[tableId] ?? defaultTableSettings(),
        change,
      )
      return applied(describeTableChange(table, change))
    },
  }),

  'intake.chooseDataset': defineViewOperation({
    title: 'Choose dataset',
    description:
      'Choose a synthetic dataset for data intake. Its fields get suggested matches to model fields, which wait for review (intake.reviewSuggestions) before the mapping uses them.',
    input: z.object({ datasetId: z.string().min(1, 'Choose a dataset.') }),
    run(view, { datasetId }) {
      const dataset = findDataset(datasetId)
      if (!dataset) {
        return rejected(`Unknown dataset "${datasetId}".`, 'datasetId')
      }
      const suggestions = suggestIntakeMatches(dataset)
      view.intake = {
        datasetId,
        mapping: Object.fromEntries(
          dataset.fields.map((field) => [field, null]),
        ),
        suggestions,
        field: dataset.fields[0] ?? null,
      }
      const count = Object.keys(suggestions).length
      return applied(
        `Chose "${dataset.label}" with ${dataset.fields.length} fields; ${count} suggested match${count === 1 ? '' : 'es'} ${count === 1 ? 'waits' : 'wait'} for review.`,
      )
    },
  }),

  'intake.mapTarget': defineViewOperation({
    title: 'Map model field',
    description:
      'Map one model field of data intake (sourceId, name, use, yearBuilt, floors, footprint) from a field of the chosen dataset, or from null to unmap it. Each model field takes one dataset field, and a dataset field feeds one model field.',
    input: z.object({
      target: z.enum([
        'sourceId',
        'name',
        'use',
        'yearBuilt',
        'floors',
        'footprint',
      ]),
      field: z.string().min(1).nullable(),
    }),
    run(view, { target, field }) {
      const dataset = view.intake.datasetId
        ? findDataset(view.intake.datasetId)
        : null
      if (!dataset) return rejected('Choose a dataset first.', 'target')
      if (field !== null && !dataset.fields.includes(field)) {
        return rejected(`"${field}" is not a field of this dataset.`, 'field')
      }
      view.intake.mapping = withTarget(view.intake.mapping, target, field)
      delete view.intake.suggestions[target]
      return applied(
        field
          ? `${TARGET_FIELDS[target].label} now takes "${field}".`
          : `${TARGET_FIELDS[target].label} is not mapped.`,
      )
    },
  }),

  'intake.reviewSuggestions': defineViewOperation({
    title: 'Review intake suggestions',
    description:
      'Accept or reject suggested matches of data intake. Name the model fields, or give an empty list for every pending suggestion.',
    input: z.object({
      targets: z
        .array(
          z.enum([
            'sourceId',
            'name',
            'use',
            'yearBuilt',
            'floors',
            'footprint',
          ]),
        )
        .default([]),
      decision: z.enum(['accept', 'reject']),
    }),
    run(view, { targets, decision }) {
      const pending = Object.keys(view.intake.suggestions).filter(isTargetField)
      if (pending.length === 0) {
        return rejected('There are no suggestions to review.', 'targets')
      }
      const chosen = targets.length > 0 ? targets : pending
      const missing = chosen.find((target) => !view.intake.suggestions[target])
      if (missing) {
        return rejected(
          `${TARGET_FIELDS[missing].label} has no suggestion to review.`,
          'targets',
        )
      }
      const labels: string[] = []
      const skipped: string[] = []
      for (const target of chosen) {
        const suggestion = view.intake.suggestions[target]
        delete view.intake.suggestions[target]
        // A field mapped by hand to another model field stays there.
        const current = suggestion
          ? (view.intake.mapping[suggestion.source] ?? null)
          : null
        if (
          decision === 'accept' &&
          suggestion &&
          current !== null &&
          current !== target
        ) {
          skipped.push(
            `${TARGET_FIELDS[target].label} (its suggested "${suggestion.source}" already feeds ${TARGET_FIELDS[current].label})`,
          )
          continue
        }
        if (decision === 'accept' && suggestion) {
          view.intake.mapping = withTarget(
            view.intake.mapping,
            target,
            suggestion.source,
          )
        }
        labels.push(TARGET_FIELDS[target].label)
      }
      const verb = decision === 'accept' ? 'Accepted' : 'Rejected'
      return applied(
        `${verb} ${labels.length} suggestion${labels.length === 1 ? '' : 's'}${labels.length > 0 ? `: ${labels.join(', ')}` : ''}.${skipped.length > 0 ? ` Dropped ${skipped.length}: ${skipped.join('; ')}.` : ''}`,
      )
    },
  }),

  'intake.inspectField': defineViewOperation({
    title: 'Show dataset field values',
    description:
      'Show the value distribution of one field of the chosen intake dataset.',
    input: z.object({ field: z.string().min(1, 'Choose a field.') }),
    run(view, { field }) {
      const dataset = view.intake.datasetId
        ? findDataset(view.intake.datasetId)
        : null
      if (!dataset) return rejected('Choose a dataset first.', 'field')
      if (!dataset.fields.includes(field)) {
        return rejected(`"${field}" is not a field of this dataset.`, 'field')
      }
      view.intake.field = field
      return applied(`Showing the values of "${field}".`)
    },
  }),

  'schema.inspectSource': defineViewOperation({
    title: 'Show source attribute values',
    description:
      'Schema matching: show the value distribution of one source attribute of the captured footprints (osm_id, building, building:levels, start_date, height, name, roof:shape).',
    input: z.object({ source: z.string().min(1, 'Choose an attribute.') }),
    run(view, { source }, project) {
      const names = sourceCollection(project).names
      if (names.length === 0) {
        return rejected(
          'There are no source attributes yet. Run "Location setup / footprint capturing" first.',
          'source',
        )
      }
      if (!names.includes(source)) {
        return rejected(
          `"${source}" is not an attribute of the captured footprints. Choose one of ${names.join(', ')}.`,
          'source',
        )
      }
      view.schema.source = source
      return applied(`Showing the values of "${source}".`)
    },
  }),

  'results.select': defineViewOperation({
    title: 'Show result',
    description:
      'Show a published result on the Results page: "baseline" or a modeled scenario id. Held or unpublished results cannot be shown.',
    input: z.object({ resultId: z.string().min(1, 'Choose a result.') }),
    run(view, { resultId }, project) {
      const published =
        resultId === 'baseline'
          ? project.results.baseline
          : project.results.scenarios[resultId]
      if (!published) {
        return rejected(
          `"${resultId}" has no published result. Run the stage that produces it first.`,
          'resultId',
        )
      }
      view.results.resultId = resultId
      if (
        view.results.buildingId !== null &&
        published.byBuildingKwh[view.results.buildingId] === undefined
      ) {
        view.results.buildingId = null
        view.results.resolution = 'monthly'
      }
      return applied(`Results show "${published.label}".`)
    },
  }),

  'results.showBuilding': defineViewOperation({
    title: 'Show building results',
    description:
      'Drill down into one building of the shown result, or pass null for the district.',
    input: z.object({ buildingId: z.string().min(1).nullable() }),
    run(view, { buildingId }, project) {
      if (buildingId !== null && !project.buildings[buildingId]) {
        return rejected(`Unknown building "${buildingId}".`, 'buildingId')
      }
      const shown =
        (view.results.resultId === 'baseline'
          ? project.results.baseline
          : project.results.scenarios[view.results.resultId]) ??
        project.results.baseline
      if (
        buildingId !== null &&
        shown?.byBuildingKwh[buildingId] === undefined
      ) {
        return rejected(
          `${buildingId} has no result in the shown result set; it was not modeled.`,
          'buildingId',
        )
      }
      view.results.buildingId = buildingId
      if (buildingId === null) view.results.resolution = 'monthly'
      return applied(
        buildingId
          ? `Results drill down into ${buildingId}.`
          : 'Results show the district.',
      )
    },
  }),

  'results.setResolution': defineViewOperation({
    title: 'Set results resolution',
    description:
      'Show monthly totals, or a typical weekday by hour for the drilled-down building. Daily resolution is not offered.',
    input: z.object({ resolution: z.enum(['monthly', 'hourly']) }),
    run(view, { resolution }) {
      if (resolution === 'hourly' && view.results.buildingId === null) {
        return rejected(
          'Hourly profiles are kept for single buildings only. Choose a building first.',
          'resolution',
        )
      }
      view.results.resolution = resolution
      return applied(
        resolution === 'hourly'
          ? 'Results show a typical weekday by hour.'
          : 'Results show monthly totals.',
      )
    },
  }),

  'dashboard.addChart': defineViewOperation({
    title: 'Add dashboard chart',
    description:
      'Add a chart to the Dashboard from a validated specification: a line chart of monthly demand, or a bar chart of annual or peak demand, for "baseline" and up to two modeled scenario ids.',
    input: chartSpecInputSchema,
    run(view, spec, project) {
      const issues = validateChartSpec(spec, project)
      if (issues.length > 0) return { status: 'rejected', issues }
      const id = `chart-${view.nextChartNumber}`
      view.nextChartNumber += 1
      view.dashboard.charts.push({ id, ...spec })
      return applied(`Added the chart "${spec.title}" to the Dashboard.`)
    },
  }),

  'dashboard.removeChart': defineViewOperation({
    title: 'Remove dashboard chart',
    description: 'Remove a chart that was added from a specification.',
    input: z.object({ chartId: z.string().min(1, 'Choose a chart.') }),
    run(view, { chartId }) {
      const chart = view.dashboard.charts.find((item) => item.id === chartId)
      if (!chart) return rejected(`Unknown chart "${chartId}".`, 'chartId')
      view.dashboard.charts = view.dashboard.charts.filter(
        (item) => item.id !== chartId,
      )
      return applied(`Removed the chart "${chart.title}".`)
    },
  }),
}

export type ViewOperationType = keyof typeof viewOperationDefinitions

export type ViewOperationInput<Type extends ViewOperationType> = z.input<
  (typeof viewOperationDefinitions)[Type]['input']
>

export type ViewOperation = {
  [Type in ViewOperationType]: { type: Type; input: ViewOperationInput<Type> }
}[ViewOperationType]

export type ViewOperationDescription = {
  type: ViewOperationType
  title: string
  description: string
  inputSchema: unknown
}

/** View operation catalog with JSON Schema inputs, for agent tool definitions. */
export function describeViewOperations(): ViewOperationDescription[] {
  return (Object.keys(viewOperationDefinitions) as ViewOperationType[])
    .filter(
      (type) =>
        !(viewOperationDefinitions[type] as { internal?: boolean }).internal,
    )
    .map((type) => {
      const definition = viewOperationDefinitions[type]
      return {
        type,
        title: definition.title,
        description: definition.description,
        inputSchema: z.toJSONSchema(definition.input, { io: 'input' }),
      }
    })
}
