import type { ValidationIssue } from '../commands.ts'
import { GROUP, upsertAsset } from '../assets.ts'
import { ringAreaM2, round } from '../simulation.ts'
import type {
  Building,
  BuildingUse,
  CommandSource,
  FieldMapping,
  HeldFusionOutput,
  ImportedFields,
  LngLat,
  TargetField,
  WorkbenchState,
} from '../types.ts'
import { STAGE_IDS, hasActiveTask, stageRunBlocker } from '../workflow.ts'
import type { Dataset, DatasetRecord, DatasetValue } from './datasets.ts'

// Schema mapping, validation, and stable-ID fusion (jobs rollout plan, D9).
// Incoming records match existing buildings by an explicit source ID; matched
// records update source attributes, new records with geometry add buildings,
// unmatched existing buildings are kept, manual overrides win, and ambiguous
// IDs are rejected rather than guessed. Nothing is ever deleted implicitly.

export const TARGET_FIELDS: Record<
  TargetField,
  { label: string; description: string }
> = {
  sourceId: {
    label: 'Source ID',
    description:
      'Stable identifier that matches a building, such as an OpenStreetMap way. Required.',
  },
  name: { label: 'Name', description: 'Building name, 1 to 80 characters.' },
  use: {
    label: 'Use',
    description:
      'residential, office, retail, school, or mixed, or the codes RES, OFF, RET, SCH, MIX.',
  },
  yearBuilt: {
    label: 'Year built',
    description: 'Whole year from 1600 to 2030.',
  },
  floors: { label: 'Floors', description: 'Whole number from 1 to 60.' },
  footprint: {
    label: 'Footprint',
    description:
      'Closed ring of longitude and latitude pairs; required to add a new building.',
  },
}

export const TARGET_FIELD_IDS = Object.keys(TARGET_FIELDS) as TargetField[]

const SYNONYMS: Record<TargetField, string[]> = {
  sourceId: ['osm_ref', 'source_id', 'building_id', 'id'],
  name: ['name', 'building_name'],
  use: ['use_code', 'building_use', 'use', 'land_use'],
  yearBuilt: ['yr_built', 'year_built', 'year'],
  floors: ['stories', 'floors', 'levels'],
  footprint: ['geometry', 'footprint'],
}

/** A first mapping from field names; people review and change it before applying. */
export function suggestMapping(dataset: Dataset): FieldMapping {
  const mapping: FieldMapping = {}
  const taken = new Set<TargetField>()
  for (const field of dataset.fields) {
    const target =
      TARGET_FIELD_IDS.find(
        (candidate) =>
          !taken.has(candidate) &&
          SYNONYMS[candidate].includes(field.trim().toLowerCase()),
      ) ?? null
    if (target) taken.add(target)
    mapping[field] = target
  }
  return mapping
}

/** Mapping problems that block the whole dataset, on the field they concern. */
export function mappingIssues(
  dataset: Dataset,
  mapping: FieldMapping,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const field of Object.keys(mapping)) {
    if (!dataset.fields.includes(field)) {
      issues.push({
        path: `mapping.${field}`,
        message: `"${field}" is not a field of this dataset.`,
      })
    }
  }
  const byTarget = new Map<TargetField, string[]>()
  for (const field of dataset.fields) {
    const target = mapping[field]
    if (target) byTarget.set(target, [...(byTarget.get(target) ?? []), field])
  }
  for (const [target, fields] of byTarget) {
    if (fields.length > 1) {
      for (const field of fields.slice(1)) {
        issues.push({
          path: `mapping.${field}`,
          message: `${TARGET_FIELDS[target].label} is already mapped from "${fields[0]}". Map each model field once.`,
        })
      }
    }
  }
  if (!byTarget.has('sourceId')) {
    issues.push({
      path: 'mapping',
      message:
        'Map a field to Source ID. Without a stable identifier no record can be matched, so nothing is applied.',
    })
  }
  if (byTarget.size === 1 && byTarget.has('sourceId')) {
    issues.push({
      path: 'mapping',
      message: 'Map at least one attribute besides Source ID.',
    })
  }
  return issues
}

const USE_CODES: Record<string, BuildingUse> = {
  res: 'residential',
  residential: 'residential',
  off: 'office',
  office: 'office',
  ret: 'retail',
  retail: 'retail',
  sch: 'school',
  school: 'school',
  mix: 'mixed',
  mixed: 'mixed',
}

/** "OpenStreetMap way/123", "way/123", and " WAY/123 " are the same source. */
export function sourceKey(reference: string): string {
  return reference
    .replace(/^OpenStreetMap /i, '')
    .trim()
    .toLowerCase()
}

function wholeNumber(value: DatasetValue, min: number, max: number) {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' &&
    Number.isInteger(number) &&
    number >= min &&
    number <= max
    ? number
    : null
}

function isRing(value: DatasetValue): value is LngLat[] {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Math.abs(point[0]) <= 180 &&
        Math.abs(point[1]) <= 90,
    ) &&
    value[0]?.[0] === value.at(-1)?.[0] &&
    value[0]?.[1] === value.at(-1)?.[1]
  )
}

type ParsedRecord = {
  key: string | null
  fields: ImportedFields
  footprint: LngLat[] | null
  issues: ValidationIssue[]
}

function parseRecord(
  record: DatasetRecord,
  mapping: FieldMapping,
): ParsedRecord {
  const parsed: ParsedRecord = {
    key: null,
    fields: {},
    footprint: null,
    issues: [],
  }
  for (const [field, target] of Object.entries(mapping)) {
    if (!target) continue
    const value = record[field] ?? null
    if (value === null || value === '') {
      if (target === 'sourceId') {
        parsed.issues.push({ path: field, message: 'Source ID is empty.' })
      }
      continue
    }
    switch (target) {
      case 'sourceId':
        if (typeof value === 'string' && value.trim()) {
          parsed.key = sourceKey(value)
        } else {
          parsed.issues.push({
            path: field,
            message: 'Source ID must be text.',
          })
        }
        break
      case 'name':
        if (typeof value === 'string' && value.trim().length <= 80) {
          parsed.fields.name = value.trim()
        } else {
          parsed.issues.push({
            path: field,
            message: 'Name must be text of at most 80 characters.',
          })
        }
        break
      case 'use': {
        const use =
          typeof value === 'string'
            ? USE_CODES[value.trim().toLowerCase()]
            : null
        if (use) parsed.fields.use = use
        else {
          parsed.issues.push({
            path: field,
            message: `Use "${String(value)}" is not one of residential, office, retail, school, or mixed (or RES, OFF, RET, SCH, MIX).`,
          })
        }
        break
      }
      case 'yearBuilt': {
        const year = wholeNumber(value, 1600, 2030)
        if (year !== null) parsed.fields.yearBuilt = year
        else {
          parsed.issues.push({
            path: field,
            message: `Year built "${String(value)}" must be a whole year from 1600 to 2030.`,
          })
        }
        break
      }
      case 'floors': {
        const floors = wholeNumber(value, 1, 60)
        if (floors !== null) parsed.fields.floors = floors
        else {
          parsed.issues.push({
            path: field,
            message: `Floors "${String(value)}" must be a whole number from 1 to 60.`,
          })
        }
        break
      }
      case 'footprint':
        if (isRing(value)) parsed.footprint = value
        else {
          parsed.issues.push({
            path: field,
            message:
              'Footprint must be a closed ring of longitude and latitude pairs.',
          })
        }
        break
    }
  }
  return parsed
}

/** One dataset row after validation and matching. */
export type PreparedRow = {
  index: number
  key: string | null
  status: 'valid' | 'rejected'
  issues: ValidationIssue[]
  plan: HeldFusionOutput | null
}

export type PreparedDataset = {
  dataset: Dataset
  mapping: FieldMapping
  schemaIssues: ValidationIssue[]
  rows: PreparedRow[]
  /** Valid records' fusion plans, in record order. */
  plans: HeldFusionOutput[]
  counts: {
    records: number
    valid: number
    rejected: number
    updates: number
    unchanged: number
    adds: number
    conflicts: number
    /** Existing buildings no record matches; they are kept as they are. */
    retained: number
  }
}

function buildingKeys(state: WorkbenchState): Map<string, string[]> {
  const keys = new Map<string, string[]>()
  for (const id of state.buildingIds) {
    const building = state.buildings[id]
    if (!building?.sourceRef) continue
    const key = sourceKey(building.sourceRef)
    keys.set(key, [...(keys.get(key) ?? []), id])
  }
  return keys
}

/**
 * IDs for buildings a dataset adds. They have their own namespace (BX0001…),
 * so a regenerated footprint extract can never take an added building's ID.
 */
function nextBuildingIds(state: WorkbenchState, count: number): string[] {
  const ids: string[] = []
  let number = 1
  while (ids.length < count) {
    const id = `BX${String(number).padStart(4, '0')}`
    const taken =
      Boolean(state.buildings[id]) ||
      Object.values(state.sourceRecords).some(
        (record) => record.buildingId === id,
      )
    if (!taken) ids.push(id)
    number += 1
  }
  return ids
}

/** The imported values that would change a matched building, and manual overrides that win. */
function plannedChanges(
  state: WorkbenchState,
  building: Building,
  fields: ImportedFields,
): Pick<HeldFusionOutput, 'fields' | 'conflicts'> {
  const changes: ImportedFields = {}
  const conflicts: HeldFusionOutput['conflicts'] = []
  if (fields.name !== undefined && fields.name !== building.name) {
    changes.name = fields.name
  }
  if (fields.use !== undefined && fields.use !== building.use) {
    changes.use = fields.use
  }
  if (
    fields.yearBuilt !== undefined &&
    fields.yearBuilt !== building.yearBuilt
  ) {
    changes.yearBuilt = fields.yearBuilt
  }
  if (fields.floors !== undefined) {
    const override = state.overrides[`${building.id}:floors`]
    if (override) {
      if (override.value !== fields.floors) {
        conflicts.push({
          field: 'floors',
          manual: typeof override.value === 'number' ? override.value : null,
          imported: fields.floors,
        })
      }
    } else if (fields.floors !== building.floors) {
      changes.floors = fields.floors
    }
  }
  return { fields: changes, conflicts }
}

/** Validates and matches every record against the current project; pure. */
export function prepareDataset(
  state: WorkbenchState,
  dataset: Dataset,
  mapping: FieldMapping,
): PreparedDataset {
  const schemaIssues = mappingIssues(dataset, mapping)
  const parsed = schemaIssues.length
    ? []
    : dataset.records.map((record) => parseRecord(record, mapping))
  const occurrences = new Map<string, number>()
  for (const record of parsed) {
    if (record.key) {
      occurrences.set(record.key, (occurrences.get(record.key) ?? 0) + 1)
    }
  }
  const keys = buildingKeys(state)
  const addCount = parsed.filter(
    (record) =>
      record.key &&
      record.issues.length === 0 &&
      occurrences.get(record.key) === 1 &&
      !keys.has(record.key) &&
      record.footprint,
  ).length
  const newIds = nextBuildingIds(state, addCount)
  let added = 0
  const matched = new Set<string>()

  const rows = parsed.map((record, index): PreparedRow => {
    const issues = [...record.issues]
    const key = record.key
    if (key && (occurrences.get(key) ?? 0) > 1) {
      issues.push({
        path: 'sourceId',
        message: `Source ID "${key}" appears ${occurrences.get(key)} times in this dataset. Ambiguous IDs are rejected, not guessed.`,
      })
    }
    const candidates = key ? (keys.get(key) ?? []) : []
    if (candidates.length > 1) {
      issues.push({
        path: 'sourceId',
        message: `Source ID "${key}" matches ${candidates.length} buildings. Ambiguous IDs are rejected, not guessed.`,
      })
    }
    if (
      key &&
      candidates.length === 0 &&
      !record.footprint &&
      issues.length === 0
    ) {
      issues.push({
        path: 'sourceId',
        message: `No building has source ID "${key}", and the record has no footprint to add one.`,
      })
    }
    if (!key || issues.length > 0) {
      return { index, key, status: 'rejected', issues, plan: null }
    }
    const buildingId = candidates[0]
    const building = buildingId ? state.buildings[buildingId] : undefined
    if (building) {
      matched.add(building.id)
      return {
        index,
        key,
        status: 'valid',
        issues,
        plan: {
          kind: 'fusion',
          action: 'update',
          sourceKey: key,
          buildingId: building.id,
          footprint: null,
          ...plannedChanges(state, building, record.fields),
        },
      }
    }
    const id = newIds[added] ?? `B-new-${index}`
    added += 1
    return {
      index,
      key,
      status: 'valid',
      issues,
      plan: {
        kind: 'fusion',
        action: 'add',
        sourceKey: key,
        buildingId: id,
        fields: record.fields,
        conflicts: [],
        footprint: record.footprint,
      },
    }
  })
  const plans = rows.flatMap((row) => (row.plan ? [row.plan] : []))
  return {
    dataset,
    mapping,
    schemaIssues,
    rows,
    plans,
    counts: {
      records: dataset.records.length,
      valid: plans.length,
      rejected: rows.filter((row) => row.status === 'rejected').length,
      updates: plans.filter(
        (plan) =>
          plan.action === 'update' && Object.keys(plan.fields).length > 0,
      ).length,
      unchanged: plans.filter(
        (plan) =>
          plan.action === 'update' && Object.keys(plan.fields).length === 0,
      ).length,
      adds: plans.filter((plan) => plan.action === 'add').length,
      conflicts: plans.reduce((sum, plan) => sum + plan.conflicts.length, 0),
      retained: state.buildingIds.length - matched.size,
    },
  }
}

/** A stable text form of a fusion's options, for input signatures. */
export function fusionOptions(
  datasetId: string,
  mapping: FieldMapping,
): string {
  const entries = Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify({ datasetId, mapping: entries })
}

/** Why held fusion outputs cannot be published, or null. */
export function validateFusion(
  state: WorkbenchState,
  membership: string[],
  held: Record<string, HeldFusionOutput>,
): string | null {
  for (const key of membership) {
    const output = held[key]
    if (!output) return `record ${key} has no held result`
    if (output.action === 'update' && !state.buildings[output.buildingId]) {
      return `building ${output.buildingId} no longer exists`
    }
    if (output.action === 'add') {
      if (state.buildings[output.buildingId]) {
        return `building ID ${output.buildingId} is already taken`
      }
      if (!output.footprint || !isRing(output.footprint)) {
        return `record ${key} has no valid footprint`
      }
    }
  }
  return null
}

function applyFields(building: Building, fields: ImportedFields) {
  if (fields.name !== undefined) building.name = fields.name
  if (fields.use !== undefined) building.use = fields.use
  if (fields.yearBuilt !== undefined) building.yearBuilt = fields.yearBuilt
  if (fields.floors !== undefined) building.floors = fields.floors
}

export function newBuilding(
  id: string,
  sourceRef: string,
  footprint: LngLat[],
  fields: ImportedFields,
): Building {
  const building: Building = {
    id,
    name: `Building ${id}`,
    footprint: footprint.map(([lng, lat]): LngLat => [lng, lat]),
    footprintAreaM2: round(ringAreaM2(footprint)),
    sourceRef,
    use: null,
    yearBuilt: null,
    floors: null,
    heightM: null,
    floorAreaM2: null,
    zoneCount: null,
    shadingFactor: null,
    pvYieldKwh: null,
    archetypeId: null,
  }
  applyFields(building, fields)
  return building
}

/**
 * Publishes a complete fusion at once: updates matched buildings, adds new
 * ones, records the source records and the dataset, and reports which stage
 * revisions to bump. Call only after `validateFusion` accepts the outputs.
 */
export function publishFusion(
  state: WorkbenchState,
  dataset: Dataset,
  mapping: FieldMapping,
  membership: string[],
  held: Record<string, HeldFusionOutput>,
  context: { operationId: string; source: CommandSource; now: string },
): { added: number; updated: number; conflicts: number; summary: string } {
  let added = 0
  let updated = 0
  let conflicts = 0
  for (const key of membership) {
    const output = held[key]
    if (!output) continue
    conflicts += output.conflicts.length
    if (output.action === 'add' && output.footprint) {
      state.buildings[output.buildingId] = newBuilding(
        output.buildingId,
        key,
        output.footprint,
        output.fields,
      )
      state.buildingIds.push(output.buildingId)
      added += 1
    } else {
      const building = state.buildings[output.buildingId]
      if (!building) continue
      if (Object.keys(output.fields).length > 0) updated += 1
      applyFields(building, output.fields)
    }
    const previous = state.sourceRecords[key]
    state.sourceRecords[key] = {
      sourceKey: key,
      datasetId: dataset.id,
      buildingId: output.buildingId,
      // Later datasets add to what earlier ones supplied for the same source.
      fields: { ...previous?.fields, ...output.fields },
      footprint: output.footprint ?? previous?.footprint ?? null,
      operationId: context.operationId,
      source: context.source,
    }
    if (!previous) state.sourceRecordIds.push(key)
  }
  state.datasets[dataset.id] = {
    datasetId: dataset.id,
    label: dataset.label,
    mapping,
    updated,
    added,
    conflicts,
    appliedAt: context.now,
    operationId: context.operationId,
  }
  upsertAsset(state, {
    id: `asset:${dataset.id}`,
    kind: 'gisDataset',
    name: `${dataset.label} (imported)`,
    parentId: GROUP.gisDatasets,
    provenance: {
      kind: 'operation',
      source: context.source,
      operationId: context.operationId,
    },
    capability: 'intake.fusion',
    summary: `${membership.length} records: ${updated} updated, ${added} added, ${conflicts} manual overrides kept (synthetic)`,
  })
  return {
    added,
    updated,
    conflicts,
    summary: `Applied "${dataset.label}": ${updated} buildings updated, ${added} added, ${conflicts} manual overrides kept; unmatched buildings were kept.`,
  }
}

/** Reapplies published source records after a stage rerun; manual overrides are applied after this. */
export function applySourceRecords(state: WorkbenchState): number {
  let applied = 0
  for (const key of state.sourceRecordIds) {
    const record = state.sourceRecords[key]
    const building = record ? state.buildings[record.buildingId] : undefined
    if (!record || !building) continue
    applyFields(building, record.fields)
    if (Object.keys(record.fields).length > 0) applied += 1
  }
  return applied
}

/**
 * Buildings that datasets added, rebuilt with their footprints when footprints
 * are captured again. Like captured buildings, their attributes return when
 * enrichment reapplies source records and manual overrides.
 */
export function addedBuildings(state: WorkbenchState): Building[] {
  return state.sourceRecordIds.flatMap((key) => {
    const record = state.sourceRecords[key]
    return record?.footprint
      ? [
          newBuilding(record.buildingId, key, record.footprint, {
            ...(record.fields.name ? { name: record.fields.name } : {}),
          }),
        ]
      : []
  })
}

/** Why no data fusion can be submitted now, or null. Shared by the command and the page. */
export function fusionSubmitBlocker(state: WorkbenchState): string | null {
  if (state.buildingIds.length === 0) {
    return 'There are no buildings to match yet. Run "Location setup / footprint capturing" first.'
  }
  if (hasActiveTask(state.tasks, STAGE_IDS.schema)) {
    return 'Schema matching or another data fusion is queued or running. Wait for it to finish.'
  }
  return stageRunBlocker(state.workflow, state.tasks, STAGE_IDS.schema)
}
