import type {
  Building,
  EditableBuildingField,
  EditValue,
  GridElement,
  GridElementKind,
  SelectableEntity,
  WorkbenchState,
} from '../../domain/types.ts'

// Read-only view model for the Inspection mode of the context panel
// (guidelines section 10). It follows the shared selection and never changes
// state; inspecting a linked object goes through the selection commands.

export type Fact = { label: string; value: string }

export type LinkedEntity = {
  entityType: SelectableEntity
  id: string
  label: string
}

export type SingleInspection = {
  kind: 'single'
  entityType: SelectableEntity
  id: string
  eyebrow: string
  title: string
  properties: Fact[]
  results: Fact[]
  /** Shown instead of results when there are none yet. */
  resultsHint: string
  warnings: string[]
  linked: LinkedEntity[]
  linkedMore: number
  provenance: string[]
}

export type MultipleInspection = {
  kind: 'multiple'
  entityType: SelectableEntity
  eyebrow: string
  title: string
  summary: Fact[]
  items: LinkedEntity[]
  itemsMore: number
}

export type Inspection =
  { kind: 'empty' } | SingleInspection | MultipleInspection

/** Longest list of linked or selected objects shown before "and N more". */
export const LIST_LIMIT = 10

const NO_DATA = 'No data'

const USE_LABELS: Record<NonNullable<Building['use']>, string> = {
  residential: 'Residential',
  office: 'Office',
  retail: 'Retail',
  school: 'School',
  mixed: 'Mixed use',
}

const GRID_KIND_LABELS: Record<GridElementKind, string> = {
  bus: 'Bus',
  line: 'Line',
  transformer: 'Transformer',
  utilityPv: 'Utility PV',
  load: 'Load',
}

const FIELD_LABELS: Record<EditableBuildingField, string> = {
  floors: 'Floors',
  archetypeId: 'Archetype',
}

const STAGE_PROVENANCE =
  'Other values come from the latest runs of the workflow stages.'

function formatNumber(value: number | null, unit = ''): string {
  if (value === null) return NO_DATA
  const text = value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return unit ? `${text} ${unit}` : text
}

function formatDemand(kwh: number): string {
  return `${(kwh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} MWh/yr`
}

function formatEditValue(
  state: WorkbenchState,
  field: EditableBuildingField,
  value: EditValue,
): string {
  if (value === null) return 'no value'
  if (field === 'archetypeId' && typeof value === 'string') {
    return state.archetypes[value]?.name ?? value
  }
  return typeof value === 'number' ? value.toLocaleString('en-US') : value
}

function compareWithBaseline(
  kwh: number,
  baselineKwh: number | undefined,
): string {
  if (!baselineKwh) return ''
  const change = (1 - kwh / baselineKwh) * 100
  const percent = Math.abs(change).toLocaleString('en-US', {
    maximumFractionDigits: 1,
  })
  if (change > 0) return `, ${percent}% below baseline`
  if (change < 0) return `, ${percent}% above baseline`
  return ', same as baseline'
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function limited<T>(
  items: T[],
  toEntity: (item: T) => LinkedEntity,
): { entities: LinkedEntity[]; more: number } {
  return {
    entities: items.slice(0, LIST_LIMIT).map(toEntity),
    more: Math.max(0, items.length - LIST_LIMIT),
  }
}

function buildingEntity(building: Building): LinkedEntity {
  return { entityType: 'building', id: building.id, label: building.name }
}

function gridEntity(element: GridElement): LinkedEntity {
  return { entityType: 'gridElement', id: element.id, label: element.name }
}

function buildingResultsHint(
  state: WorkbenchState,
  building: Building,
): string {
  if (!state.results.baseline) {
    return 'No results yet. Run "Baseline model setup" to compute demand.'
  }
  // The baseline model skips buildings without an archetype or a floor area
  // (src/domain/simulation.ts).
  const reasons = [
    building.archetypeId === null ? 'no archetype' : null,
    building.floorAreaM2 === null ? 'no floor area' : null,
  ].filter((reason): reason is string => reason !== null)
  return reasons.length > 0
    ? `The baseline model skipped this building: it has ${reasons.join(' and ')}.`
    : 'The baseline model has no demand result for this building.'
}

function inspectBuilding(
  state: WorkbenchState,
  building: Building,
): SingleInspection {
  const archetype = building.archetypeId
    ? state.archetypes[building.archetypeId]
    : undefined
  const baselineKwh = state.results.baseline?.byBuildingKwh[building.id]

  const results: Fact[] = []
  if (baselineKwh !== undefined) {
    results.push({ label: 'Baseline demand', value: formatDemand(baselineKwh) })
  }
  for (const scenario of Object.values(state.scenarios)) {
    const kwh = state.results.scenarios[scenario.id]?.byBuildingKwh[building.id]
    if (kwh === undefined) continue
    results.push({
      label: `${scenario.name} demand`,
      value: `${formatDemand(kwh)}${compareWithBaseline(kwh, baselineKwh)}`,
    })
  }

  const warnings: string[] = []
  const missing = [
    building.use === null ? 'use' : null,
    building.floors === null ? 'floors' : null,
    building.archetypeId === null ? 'archetype' : null,
  ].filter((label): label is string => label !== null)
  if (missing.length > 0) {
    warnings.push(`No data for ${missing.join(', ')}.`)
  }
  for (const edit of Object.values(state.pendingEdits)) {
    if (edit.entityId !== building.id) continue
    warnings.push(
      `Pending edit, not applied: ${FIELD_LABELS[edit.field]} ${formatEditValue(state, edit.field, edit.from)} to ${formatEditValue(state, edit.field, edit.to)}.`,
    )
  }

  const connected = Object.values(state.gridElements).filter((element) =>
    element.buildingIds.includes(building.id),
  )
  const { entities, more } = limited(connected, gridEntity)

  const provenance = Object.values(state.overrides)
    .filter((override) => override.entityId === building.id)
    .map(
      (override) =>
        `${FIELD_LABELS[override.field]} set to ${formatEditValue(state, override.field, override.value)} by a ${override.source} edit (operation ${override.operationId}); it survives stage reruns.`,
    )
  const imported = Object.values(state.sourceRecords).find(
    (record) => record.buildingId === building.id,
  )
  if (imported) {
    const dataset = state.datasets[imported.datasetId]
    const fields = Object.keys(imported.fields).join(', ') || 'no attributes'
    provenance.push(
      `${imported.footprint ? 'Added' : 'Matched'} by source ID ${imported.sourceKey} from the synthetic dataset "${dataset?.label ?? imported.datasetId}" (${fields}; operation ${imported.operationId}). Manual edits win over imported values.`,
    )
  }
  if (building.sourceRef?.startsWith('OpenStreetMap')) {
    provenance.push(
      `Footprint geometry from ${building.sourceRef} (© OpenStreetMap contributors, ODbL). Use, year, floors, and results are synthetic.`,
    )
  }
  provenance.push(STAGE_PROVENANCE)

  return {
    kind: 'single',
    entityType: 'building',
    id: building.id,
    eyebrow: `Building ${building.id}`,
    title: building.name,
    properties: [
      {
        label: 'Use',
        value: building.use ? USE_LABELS[building.use] : NO_DATA,
      },
      {
        label: 'Year built',
        value:
          building.yearBuilt === null ? NO_DATA : String(building.yearBuilt),
      },
      { label: 'Floors', value: formatNumber(building.floors) },
      { label: 'Height', value: formatNumber(building.heightM, 'm') },
      {
        label: 'Footprint area',
        value: formatNumber(building.footprintAreaM2, 'm²'),
      },
      { label: 'Floor area', value: formatNumber(building.floorAreaM2, 'm²') },
      { label: 'Thermal zones', value: formatNumber(building.zoneCount) },
      { label: 'Archetype', value: archetype?.name ?? NO_DATA },
      {
        label: 'Shading factor',
        value:
          building.shadingFactor === null
            ? NO_DATA
            : building.shadingFactor.toFixed(2),
      },
      { label: 'PV yield', value: formatNumber(building.pvYieldKwh, 'kWh/yr') },
    ],
    results,
    resultsHint: buildingResultsHint(state, building),
    warnings,
    linked: entities,
    linkedMore: more,
    provenance,
  }
}

function inspectBuildings(
  state: WorkbenchState,
  buildings: Building[],
): MultipleInspection {
  const floorAreas = buildings.flatMap((building) =>
    building.floorAreaM2 === null ? [] : [building.floorAreaM2],
  )
  const floors = buildings.flatMap((building) =>
    building.floors === null ? [] : [building.floors],
  )
  const baseline = state.results.baseline
  const summary: Fact[] = [
    { label: 'Buildings', value: buildings.length.toLocaleString('en-US') },
    {
      label: 'Floor area',
      value:
        floorAreas.length === 0
          ? NO_DATA
          : `${formatNumber(sum(floorAreas), 'm²')}${floorAreas.length < buildings.length ? ` (${floorAreas.length} of ${buildings.length} known)` : ''}`,
    },
    {
      label: 'Floors',
      value:
        floors.length === 0
          ? NO_DATA
          : `${Math.min(...floors)} to ${Math.max(...floors)}`,
    },
  ]
  if (baseline) {
    summary.push({
      label: 'Baseline demand',
      value: formatDemand(
        sum(
          buildings.map((building) => baseline.byBuildingKwh[building.id] ?? 0),
        ),
      ),
    })
  }
  const { entities, more } = limited(buildings, buildingEntity)
  return {
    kind: 'multiple',
    entityType: 'building',
    eyebrow: 'Selection',
    title: `${buildings.length.toLocaleString('en-US')} buildings`,
    summary,
    items: entities,
    itemsMore: more,
  }
}

function inspectGridElement(
  state: WorkbenchState,
  element: GridElement,
): SingleInspection {
  const loading = state.gridResult?.transformerLoadingPercent[element.id]
  const connected = element.buildingIds.flatMap((id) => {
    const building = state.buildings[id]
    return building ? [building] : []
  })
  const { entities, more } = limited(connected, buildingEntity)
  const warnings: string[] = []
  if (loading !== undefined && loading > 100) {
    warnings.push('Over rating at peak load.')
  } else if (loading !== undefined && loading >= 80) {
    warnings.push('Near rating at peak load.')
  }
  return {
    kind: 'single',
    entityType: 'gridElement',
    id: element.id,
    eyebrow: `${GRID_KIND_LABELS[element.kind]} ${element.id}`,
    title: element.name,
    properties: [
      { label: 'Kind', value: GRID_KIND_LABELS[element.kind] },
      { label: 'Rating', value: formatNumber(element.ratingKva, 'kVA') },
      {
        label: 'Connected buildings',
        value: element.buildingIds.length.toLocaleString('en-US'),
      },
    ],
    results:
      loading === undefined
        ? []
        : [{ label: 'Peak loading', value: `${loading}% of rating` }],
    resultsHint:
      element.kind === 'transformer'
        ? 'No loading yet. Run "Grid modeling" to compute transformer loading.'
        : 'Grid modeling reports loading for transformers only.',
    warnings,
    linked: entities,
    linkedMore: more,
    provenance: ['Values come from the latest runs of the workflow stages.'],
  }
}

function inspectGridElements(elements: GridElement[]): MultipleInspection {
  const counts = new Map<GridElementKind, number>()
  for (const element of elements) {
    counts.set(element.kind, (counts.get(element.kind) ?? 0) + 1)
  }
  const ratings = elements.flatMap((element) =>
    element.ratingKva === null ? [] : [element.ratingKva],
  )
  const { entities, more } = limited(elements, gridEntity)
  return {
    kind: 'multiple',
    entityType: 'gridElement',
    eyebrow: 'Selection',
    title: `${elements.length.toLocaleString('en-US')} grid elements`,
    summary: [
      {
        label: 'Grid elements',
        value: elements.length.toLocaleString('en-US'),
      },
      {
        label: 'By kind',
        value: [...counts]
          .map(([kind, count]) => `${GRID_KIND_LABELS[kind]}: ${count}`)
          .join(', '),
      },
      {
        label: 'Total rating',
        value:
          ratings.length === 0 ? NO_DATA : formatNumber(sum(ratings), 'kVA'),
      },
    ],
    items: entities,
    itemsMore: more,
  }
}

export function buildInspection(state: WorkbenchState): Inspection {
  const { entityType, ids } = state.selection
  if (entityType === 'building') {
    const buildings = ids.flatMap((id) => {
      const building = state.buildings[id]
      return building ? [building] : []
    })
    const [first] = buildings
    if (!first) return { kind: 'empty' }
    return buildings.length === 1
      ? inspectBuilding(state, first)
      : inspectBuildings(state, buildings)
  }
  if (entityType === 'gridElement') {
    const elements = ids.flatMap((id) => {
      const element = state.gridElements[id]
      return element ? [element] : []
    })
    const [first] = elements
    if (!first) return { kind: 'empty' }
    return elements.length === 1
      ? inspectGridElement(state, first)
      : inspectGridElements(elements)
  }
  return { kind: 'empty' }
}
