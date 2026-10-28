import { GROUP, upsertAsset } from '../assets.ts'
import type { ValidationIssue } from '../commands.ts'
import { applySourceRecords } from '../intake/fusion.ts'
import {
  checkTarget,
  compulsoryBlocker,
  distribution,
  profileSource,
  readValue,
  targetIssues,
  unrecognisedCount,
  type Bucket,
  type SourceAttribute,
  type TargetCheck,
  type TargetSpec,
} from '../mapping/mapping.ts'
import {
  applyFloorOverrides,
  fromStage,
  syntheticAttributes,
  type StageRunContext,
  type StageRunResult,
} from '../simulation.ts'
import type {
  Building,
  BuildingUse,
  MappingWarning,
  PublishedMapping,
  SchemaMatchingState,
  WorkbenchState,
} from '../types.ts'
import { STAGE_IDS } from '../workflow.ts'
import {
  FOOTPRINT_TAGS,
  footprintIndex,
  footprintTags,
  type FootprintTags,
} from './footprintTags.ts'
import { CUSTOM_PREFIX, copyValueMaps, schemaTargets } from './registry.ts'

// Schema matching over the captured footprints (decision 0032, stage 4). The
// source collection is every building's captured tags; reviewing it is pure,
// and a Schema matching run publishes the mapping. Values are read from the
// tags whenever they are applied, so the original attributes are kept, and
// the precedence on every application is: synthetic enrichment, then the
// published mapping, then fused source records, then manual overrides. Only
// function declarations are exported: simulation.ts imports this module in a
// cycle.

export type SourceRecordRow = {
  buildingId: string
  tags: FootprintTags | null
}

export type SourceCollection = {
  records: SourceRecordRow[]
  attributes: SourceAttribute[]
  names: string[]
}

const collections = new WeakMap<string[], SourceCollection>()

/**
 * The working footprint collection's source attributes, profiled. Buildings a
 * dataset added carry no tags, so their values count as missing. Empty until
 * footprints are captured.
 */
export function sourceCollection(state: WorkbenchState): SourceCollection {
  const cached = collections.get(state.buildingIds)
  if (cached) return cached
  const records = state.buildingIds.flatMap((buildingId) => {
    const building = state.buildings[buildingId]
    return building ? [{ buildingId, tags: footprintTags(building) }] : []
  })
  const names = records.length > 0 ? [...FOOTPRINT_TAGS] : []
  const collection: SourceCollection = {
    records,
    names,
    attributes: names.map((name) =>
      profileSource(
        name,
        records.map((record) => record.tags?.[name] ?? null),
      ),
    ),
  }
  collections.set(state.buildingIds, collection)
  return collection
}

export function sourceValues(
  collection: SourceCollection,
  name: string,
): (string | null)[] {
  return collection.records.map((record) => record.tags?.[name] ?? null)
}

/** A source attribute's value distribution, or null when it is not in the collection. */
export function sourceDistribution(
  collection: SourceCollection,
  name: string,
): Bucket[] | null {
  const attribute = collection.attributes.find((item) => item.name === name)
  return attribute
    ? distribution(attribute, sourceValues(collection, name))
    : null
}

type MappingConfig = Pick<
  SchemaMatchingState,
  'mapping' | 'valueMaps' | 'customTargets'
>

function checksOf(
  targets: readonly TargetSpec[],
  collection: SourceCollection,
  config: MappingConfig,
): Record<string, TargetCheck> {
  const checks: Record<string, TargetCheck> = {}
  for (const target of targets) {
    const source = config.mapping[target.id]
    if (!source || !collection.names.includes(source)) continue
    checks[target.id] = checkTarget(
      target,
      source,
      sourceValues(collection, source),
      config.valueMaps[target.id],
    )
  }
  return checks
}

/** RC's coded warnings for what applying the mapping copies and skips. */
export function mappingWarnings(
  targets: readonly TargetSpec[],
  checks: Record<string, TargetCheck>,
): MappingWarning[] {
  const warnings: MappingWarning[] = []
  for (const target of targets) {
    const check = checks[target.id]
    if (!check) continue
    const keeps =
      target.tier === 'computed'
        ? 'they keep the computed value'
        : target.tier === 'custom'
          ? 'they have no value'
          : target.id === 'name'
            ? 'they keep their names'
            : 'they keep their enriched values'
    const unrecognised = unrecognisedCount(check)
    if (unrecognised > 0) {
      warnings.push({
        code: 'enum_values_unrecognised',
        target: target.id,
        count: unrecognised,
        examples: check.unrecognised.slice(0, 3).map((entry) => entry.value),
        message: `${target.label}: ${unrecognised} values of "${check.source}" are not recognised (${check.unrecognised
          .slice(0, 3)
          .map((entry) => `"${entry.value}" ${entry.count}`)
          .join(
            ', ',
          )}); ${keeps}. Allowed: ${(target.allowed ?? []).join(', ')}.`,
      })
    }
    if (check.invalid > 0) {
      warnings.push({
        code: 'values_invalid',
        target: target.id,
        count: check.invalid,
        examples: check.invalidExamples,
        message: `${target.label}: ${check.invalid} values of "${check.source}" are not valid (${check.invalidExamples.map((example) => `"${example}"`).join(', ')}); ${keeps}.`,
      })
    }
    if (check.missing > 0) {
      warnings.push({
        code: 'values_missing',
        target: target.id,
        count: check.missing,
        examples: [],
        message: `${target.label}: ${check.missing} buildings have no "${check.source}"; ${keeps}.`,
      })
    }
    if (target.unit) {
      warnings.push({
        code: 'unit_not_converted',
        target: target.id,
        count: check.valid,
        examples: [],
        message: `${target.label} is read from "${check.source}" as ${target.unit}; units are not converted.`,
      })
    }
  }
  return warnings
}

/** Everything the review shows, and what a run would report; pure. */
export type SchemaReview = {
  targets: TargetSpec[]
  collection: SourceCollection
  issues: ValidationIssue[]
  checks: Record<string, TargetCheck>
  warnings: MappingWarning[]
  /** Why the run cannot be submitted for the mapping, or null. */
  blocker: string | null
  pending: number
}

export function reviewSchema(state: WorkbenchState): SchemaReview {
  const matching = state.schemaMatching
  const targets = schemaTargets(matching)
  const collection = sourceCollection(state)
  const checks = checksOf(targets, collection, matching)
  const empty = collection.names.length === 0
  return {
    targets,
    collection,
    issues: empty
      ? []
      : targetIssues(
          targets,
          collection.names,
          matching.mapping,
          matching.suggestions,
        ),
    checks,
    warnings: mappingWarnings(targets, checks),
    blocker: empty
      ? 'There are no source attributes yet. Run "Location setup / footprint capturing" first.'
      : compulsoryBlocker(
          targets,
          collection.names,
          matching.mapping,
          matching.suggestions,
        ),
    pending: Object.keys(matching.suggestions).length,
  }
}

/** Why Schema matching cannot run for its mapping, or null; the stage checks come first. */
export function schemaRunBlocker(state: WorkbenchState): string | null {
  const blocker = reviewSchema(state).blocker
  return blocker
    ? `${blocker} Map the compulsory fields on the Schema matching page first.`
    : null
}

/** Values the mapping gives one building; custom targets are text. */
export type MappedValues = {
  name?: string
  use?: BuildingUse
  yearBuilt?: number
  floors?: number
  heightM?: number
  floorAreaM2?: number
  custom: Record<string, string>
  /** Which source attribute each value came from, by target. */
  sources: Record<string, string>
}

const MODEL_TARGETS = new Set([
  'name',
  'use',
  'yearBuilt',
  'floors',
  'heightM',
  'floorAreaM2',
])

/** What a mapping gives a building, read from its captured tags. */
export function mappedValuesFor(
  building: Pick<Building, 'sourceRef'>,
  config: MappingConfig | null,
): MappedValues {
  const values: MappedValues = { custom: {}, sources: {} }
  const tags = footprintTags(building)
  if (!config || !tags) return values
  for (const target of schemaTargets(config)) {
    const source = config.mapping[target.id]
    if (!source) continue
    const result = readValue(target, tags[source], config.valueMaps[target.id])
    if (result.status !== 'value') continue
    values.sources[target.id] = source
    if (target.id.startsWith(CUSTOM_PREFIX)) {
      values.custom[target.label] = String(result.value)
    } else if (MODEL_TARGETS.has(target.id)) {
      Object.assign(values, { [target.id]: result.value })
    }
  }
  return values
}

/** The published mapping's heights and floor areas, which preprocessing uses instead of computing them. */
export function computedOverrides(
  state: WorkbenchState,
  building: Building,
): { heightM?: number; floorAreaM2?: number } {
  const values = mappedValuesFor(building, state.schemaMatching.published)
  return {
    ...(values.heightM === undefined ? {} : { heightM: values.heightM }),
    ...(values.floorAreaM2 === undefined
      ? {}
      : { floorAreaM2: values.floorAreaM2 }),
  }
}

/**
 * Whether the buildings' heights and floor areas came from a Geospatial
 * preprocessing run that read the published mapping: its last successful run
 * consumed the Schema matching revision that published it.
 */
export function preprocessingUsedPublished(state: WorkbenchState): boolean {
  const published = state.schemaMatching.published
  const schema = state.workflow.stages[STAGE_IDS.schema]
  const preprocessing = state.workflow.stages[STAGE_IDS.preprocessing]
  if (!published || !schema?.lastRun || !preprocessing?.lastRun) return false
  return (
    schema.lastRun.outcome === 'succeeded' &&
    schema.lastRun.runId === published.runId &&
    preprocessing.lastRun.outcome === 'succeeded' &&
    preprocessing.lastRun.inputRevisions[STAGE_IDS.schema] === schema.revision
  )
}

/** The name a building has before any mapped or fused name. */
export function baseName(building: Building): string {
  const index = footprintIndex(building)
  return index === null ? `Building ${building.id}` : `Building ${index + 1}`
}

/**
 * Applies every attribute layer in order: synthetic enrichment, the
 * published mapping, fused source records, and manual overrides. Returns how
 * many buildings each later layer changed.
 */
export function applyAttributeLayers(state: WorkbenchState): {
  mapped: number
  imported: number
  kept: number
} {
  const published = state.schemaMatching.published
  let mapped = 0
  state.buildingIds.forEach((id, index) => {
    const building = state.buildings[id]
    if (!building) return
    const synthetic = syntheticAttributes(index)
    building.use = synthetic.use
    building.yearBuilt = synthetic.yearBuilt
    building.floors = synthetic.floors
    building.name = baseName(building)
    if (!published) return
    const values = mappedValuesFor(building, published)
    if (values.name !== undefined) building.name = values.name
    if (values.use !== undefined) building.use = values.use
    if (values.yearBuilt !== undefined) building.yearBuilt = values.yearBuilt
    if (values.floors !== undefined) building.floors = values.floors
    if (Object.keys(values.sources).length > 0) mapped += 1
  })
  const imported = applySourceRecords(state)
  const kept = applyFloorOverrides(state)
  return { mapped, imported, kept }
}

/**
 * The Schema matching stage run: publishes the current mapping, copies its
 * values into the model fields under fused records and manual overrides, and
 * reports applied counts and RC's warnings. The original tags are unchanged.
 */
export function runSchemaMatching(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.some((id) => state.buildings[id]?.use === null)) {
    return {
      ok: false,
      message: 'Footprints are not enriched. Run "Geospatial data enriching".',
    }
  }
  const review = reviewSchema(state)
  if (review.blocker) return { ok: false, message: review.blocker }
  const matching = state.schemaMatching
  const applied: Record<string, number> = {}
  for (const [target, check] of Object.entries(review.checks)) {
    applied[target] = check.valid
  }
  const published: PublishedMapping = {
    runId: context.runId,
    operationId: context.operationId,
    mapping: { ...matching.mapping },
    valueMaps: copyValueMaps(matching.valueMaps),
    customTargets: [...matching.customTargets],
    applied,
    warnings: review.warnings,
  }
  matching.published = published
  const { mapped } = applyAttributeLayers(state)
  const targets = review.targets.filter((target) => applied[target.id])
  const values = Object.values(applied).reduce((sum, count) => sum + count, 0)
  upsertAsset(state, {
    id: 'asset:schema-rules',
    kind: 'schemaRules',
    name: 'Attribute mapping rules',
    parentId: GROUP.schemaRules,
    provenance: fromStage(STAGE_IDS.schema, context),
    capability: 'schema.mapping',
    summary: `${Object.keys(published.mapping).length} targets mapped; ${values} values copied to ${mapped} buildings (synthetic tags)`,
  })
  return {
    ok: true,
    summary: `Applied the mapping to ${mapped} of ${state.buildingIds.length} buildings: ${targets
      .map((target) => `${target.label} ${applied[target.id] ?? 0}`)
      .join(', ')} values copied. The original attributes are kept.`,
    warnings: review.warnings.map((warning) => warning.message),
  }
}
