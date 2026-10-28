import {
  PART_LABELS,
  archetypeLabel,
  effectiveParts,
} from '../../domain/archetypes/parts.ts'
import { isAdopted } from '../../domain/scenarios/rules.ts'
import {
  FOOTPRINT_TAGS,
  footprintTags,
} from '../../domain/schema/footprintTags.ts'
import {
  mappedValuesFor,
  preprocessingUsedPublished,
} from '../../domain/schema/matching.ts'
import { customTargetId } from '../../domain/schema/registry.ts'
import { MEASURE_KINDS, PART_KINDS } from '../../domain/types.ts'
import type {
  Building,
  EditableBuildingField,
  EditValue,
  GridElement,
  GridElementKind,
  SelectableEntity,
  WorkbenchState,
} from '../../domain/types.ts'
import { NO_DATA, formatEnergy, formatNumber } from '../format.ts'

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
  /** Where each building attribute's value comes from (decision 0032, stage 4). */
  attributeSources?: Fact[]
  /** The captured source attributes, kept unchanged by Schema matching. */
  sourceAttributes?: Fact[]
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
  ...PART_LABELS,
}

const STAGE_PROVENANCE =
  'Other values come from the latest runs of the workflow stages.'

function formatValue(value: number | null, unit?: string): string {
  return formatNumber(value, { maxDigits: 1, unit })
}

function formatDemand(kwh: number): string {
  return `${formatEnergy(kwh)}/yr`
}

function formatEditValue(
  state: WorkbenchState,
  field: EditableBuildingField,
  value: EditValue,
): string {
  if (value === null) return field === 'floors' ? 'no value' : 'the rules'
  if (field !== 'floors' && typeof value === 'string') {
    return state.parts[value]?.name ?? value
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

/** "a", "a or b", "a, b, or c". */
function orList(items: string[]): string {
  if (items.length <= 2) return items.join(' or ')
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`
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
  // The baseline model skips buildings without all four archetype parts or
  // a floor area (src/domain/simulation.ts).
  const parts = effectiveParts(state, building)
  const missingParts = PART_KINDS.filter((kind) => parts[kind] === null)
  const reasons = [
    missingParts.length > 0
      ? `no ${orList(missingParts.map((kind) => PART_LABELS[kind].toLowerCase()))} part`
      : null,
    building.floorAreaM2 === null ? 'no floor area' : null,
  ].filter((reason): reason is string => reason !== null)
  return reasons.length > 0
    ? `The baseline model skipped this building: it has ${reasons.join(' and ')}.`
    : 'The baseline model has no demand result for this building.'
}

const SOURCED_FIELDS: {
  id: 'name' | 'use' | 'yearBuilt' | 'floors' | 'heightM' | 'floorAreaM2'
  label: string
}[] = [
  { id: 'name', label: 'Name' },
  { id: 'use', label: 'Use' },
  { id: 'yearBuilt', label: 'Year built' },
  { id: 'floors', label: 'Floors' },
  { id: 'heightM', label: 'Height' },
  { id: 'floorAreaM2', label: 'Floor area' },
]

/**
 * Which layer each attribute's value comes from, in the precedence order of
 * decision 0032, stage 4: a manual edit, a fused dataset, the published
 * Schema matching mapping, then synthetic enrichment or a computed value.
 */
export function attributeSources(
  state: WorkbenchState,
  building: Building,
): Fact[] {
  const published = state.schemaMatching.published
  const usedPublished = preprocessingUsedPublished(state)
  const mapped = mappedValuesFor(building, published)
  const tags = footprintTags(building)
  const fused = Object.values(state.sourceRecords).find(
    (record) => record.buildingId === building.id,
  )
  const facts: Fact[] = SOURCED_FIELDS.map(({ id, label }) => {
    const override = state.overrides[`${building.id}:${id}`]
    if (id === 'floors' && override) {
      return {
        label,
        value: `Manual edit by ${override.source} (operation ${override.operationId})`,
      }
    }
    if (
      id !== 'heightM' &&
      id !== 'floorAreaM2' &&
      fused?.fields[id] !== undefined
    ) {
      return {
        label,
        value: `Dataset "${state.datasets[fused.datasetId]?.label ?? fused.datasetId}" by source ID ${fused.sourceKey}`,
      }
    }
    const source = mapped.sources[id]
    if (source && published) {
      const raw = tags?.[source] ?? ''
      // Preprocessing reads mapped heights and areas only when it runs
      // after the Schema matching run that published them.
      const applied =
        id === 'heightM' || id === 'floorAreaM2'
          ? building[id] !== null && usedPublished
          : true
      return {
        label,
        value: applied
          ? `Schema matching from "${source}" = "${raw}" (run ${published.runId})`
          : `Computed; Schema matching maps "${source}" = "${raw}", used when Geospatial preprocessing runs again`,
      }
    }
    if (id === 'name') return { label, value: 'Captured footprint' }
    if (id === 'heightM' || id === 'floorAreaM2') {
      return {
        label,
        value:
          building[id] === null
            ? NO_DATA
            : 'Computed by Geospatial preprocessing',
      }
    }
    return {
      label,
      value: building[id] === null ? NO_DATA : 'Synthetic enrichment',
    }
  })
  for (const [name, value] of Object.entries(mapped.custom)) {
    facts.push({
      label: name,
      value: `${value} (custom, from "${mapped.sources[customTargetId(name)] ?? name}")`,
    })
  }
  return facts
}

/** The captured tags of a footprint, as they were captured. */
export function sourceAttributeFacts(building: Building): Fact[] {
  const tags = footprintTags(building)
  if (!tags) return []
  return FOOTPRINT_TAGS.map((name) => ({
    label: name,
    value: tags[name] ?? 'missing',
  }))
}

function inspectBuilding(
  state: WorkbenchState,
  building: Building,
): SingleInspection {
  const parts = effectiveParts(state, building)
  const baselineKwh = state.results.baseline?.byBuildingKwh[building.id]

  const results: Fact[] = []
  if (baselineKwh !== undefined) {
    results.push({ label: 'Baseline demand', value: formatDemand(baselineKwh) })
  }
  for (const scenario of Object.values(state.scenarios)) {
    const kwh = state.results.scenarios[scenario.id]?.byBuildingKwh[building.id]
    if (kwh === undefined) continue
    // Versions compare with the baseline they were modeled against.
    const versions = state.results.scenarioVersions[scenario.id]
    results.push({
      label: `${scenario.name} demand`,
      value: `${formatDemand(kwh)}${compareWithBaseline(kwh, versions ? versions.baseKwh[building.id] : baselineKwh)}`,
    })
    // Which measures the scenario's rules gave it, and whether it adopts them.
    if (!versions) continue
    const taken = versions.measures[building.id]
    const names = taken
      ? MEASURE_KINDS.flatMap((kind) => {
          const measure = taken[kind]
          return measure
            ? [
                `${state.measures[measure.measureId]?.name ?? measure.measureId} (rule ${measure.ruleName})`,
              ]
            : []
        })
      : []
    results.push({
      label: `${scenario.name} measures`,
      value:
        names.length === 0
          ? 'None: no rule gives this building a measure.'
          : `${names.join(', ')}; ${isAdopted(scenario.adoptionSeed, building.id, scenario.adoptionPercent) ? 'adopted' : 'not adopted'} at ${scenario.adoptionPercent}% adoption, seed ${scenario.adoptionSeed}.`,
    })
  }

  const warnings: string[] = []
  const missing = [
    building.use === null ? 'use' : null,
    building.floors === null ? 'floors' : null,
    ...PART_KINDS.map((kind) =>
      parts[kind] === null ? `${PART_LABELS[kind].toLowerCase()} part` : null,
    ),
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
  // Parts and the rules that set them link to their Properties.
  const definitions: LinkedEntity[] = []
  for (const kind of PART_KINDS) {
    const part = parts[kind]
    if (!part) continue
    definitions.push({
      entityType: 'archetypePart',
      id: part.partId,
      label: `${PART_LABELS[kind]}: ${state.parts[part.partId]?.name ?? part.partId}`,
    })
  }
  const ruleIds = [
    ...new Set(
      PART_KINDS.flatMap((kind) => {
        const part = parts[kind]
        return part?.via === 'rule' && state.rules[part.ruleId]
          ? [part.ruleId]
          : []
      }),
    ),
  ]
  for (const ruleId of ruleIds) {
    definitions.push({
      entityType: 'assignmentRule',
      id: ruleId,
      label: `Rule: ${state.rules[ruleId]?.name ?? ruleId}`,
    })
  }
  const linkedGrid = limited(connected, gridEntity)
  const entities = [...definitions, ...linkedGrid.entities]
  const more = linkedGrid.more

  const provenance = Object.values(state.overrides)
    .filter((override) => override.entityId === building.id)
    .map((override) =>
      override.field === 'floors'
        ? `${FIELD_LABELS[override.field]} set to ${formatEditValue(state, override.field, override.value)} by a ${override.source} edit (operation ${override.operationId}); it survives stage reruns.`
        : `${FIELD_LABELS[override.field]} part set to ${formatEditValue(state, override.field, override.value)} by a ${override.source} edit (operation ${override.operationId}); it wins over the assignment rules.`,
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
      imported
        ? `Footprint geometry from ${building.sourceRef} (© OpenStreetMap contributors, ODbL). Values the dataset supplied replace synthetic ones; other attributes and all results are synthetic.`
        : `Footprint geometry from ${building.sourceRef} (© OpenStreetMap contributors, ODbL). Its source attributes are synthetic OpenStreetMap-like tags; use, year, floors, and results are synthetic.`,
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
      { label: 'Floors', value: formatValue(building.floors) },
      { label: 'Height', value: formatValue(building.heightM, 'm') },
      {
        label: 'Footprint area',
        value: formatValue(building.footprintAreaM2, 'm²'),
      },
      { label: 'Floor area', value: formatValue(building.floorAreaM2, 'm²') },
      { label: 'Thermal zones', value: formatValue(building.zoneCount) },
      { label: 'Archetype', value: archetypeLabel(state, building) ?? NO_DATA },
      ...PART_KINDS.map((kind) => {
        const part = parts[kind]
        const name = part
          ? (state.parts[part.partId]?.name ?? part.partId)
          : null
        return {
          label: PART_LABELS[kind],
          value: !part
            ? NO_DATA
            : part.via === 'manual'
              ? `${name} (manual)`
              : `${name} (rule "${part.ruleName}")`,
        }
      }),
      {
        label: 'Shading factor',
        value:
          building.shadingFactor === null
            ? NO_DATA
            : building.shadingFactor.toFixed(2),
      },
      { label: 'PV yield', value: formatValue(building.pvYieldKwh, 'kWh/yr') },
    ],
    results,
    resultsHint: buildingResultsHint(state, building),
    warnings,
    linked: entities,
    linkedMore: more,
    provenance,
    attributeSources: attributeSources(state, building),
    sourceAttributes: sourceAttributeFacts(building),
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
          : `${formatValue(sum(floorAreas), 'm²')}${floorAreas.length < buildings.length ? ` (${floorAreas.length} of ${buildings.length} known)` : ''}`,
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
      { label: 'Rating', value: formatValue(element.ratingKva, 'kVA') },
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
          ratings.length === 0 ? NO_DATA : formatValue(sum(ratings), 'kVA'),
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
