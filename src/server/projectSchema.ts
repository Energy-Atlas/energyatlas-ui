import { z } from 'zod'
import { capabilities, type CapabilityId } from '../domain/capabilities.ts'
import {
  ARCHETYPE_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../domain/archetypes/library.ts'
import type { WorkbenchState } from '../domain/types.ts'

const id = z.string().min(1)
const text = z.string()
const number = z.number()
const nullableNumber = number.nullable()
const ids = z.array(id)
const point = z.tuple([number, number])
const source = z.enum(['manual', 'agent', 'system'])
const use = z.enum(['residential', 'office', 'retail', 'school', 'mixed'])
const capability = z.enum(
  Object.keys(capabilities) as [CapabilityId, ...CapabilityId[]],
)
const record = <Schema extends z.ZodType>(schema: Schema) =>
  z.record(id, schema)
const editValue = z.union([number, text, z.null()])
const field = z.enum(['floors', 'archetypeId'])
const provenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skeleton') }),
  z.object({
    kind: z.literal('stage'),
    stageId: id,
    runId: id,
    operationId: id,
  }),
  z.object({ kind: z.literal('operation'), source, operationId: id }),
])
const result = z.object({
  id,
  label: text,
  runId: id,
  totalKwh: number,
  peakKw: number,
  monthlyKwh: z.array(number),
  byBuildingKwh: record(number),
})
const taskStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'invalidated',
])
const targetField = z.enum([
  'sourceId',
  'name',
  'use',
  'yearBuilt',
  'floors',
  'footprint',
])
const mapping = z.record(text, targetField.nullable())
const importedFields = z.object({
  name: text.optional(),
  use: use.optional(),
  yearBuilt: number.optional(),
  floors: number.optional(),
})
const ring = z.array(point)
const heldFusion = z.object({
  kind: z.literal('fusion'),
  action: z.enum(['update', 'add']),
  sourceKey: id,
  buildingId: id,
  fields: importedFields,
  conflicts: z.array(
    z.object({
      field: z.literal('floors'),
      manual: nullableNumber,
      imported: number,
    }),
  ),
  footprint: ring.nullable(),
})
const heldAssignment = z.object({
  kind: z.literal('assignment'),
  archetypeId: id.nullable(),
})
const heldPreprocessing = z.object({
  heightM: number,
  floorAreaM2: number,
  zoneCount: number,
})
const definitionSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library'), libraryId: id }),
  z.object({
    kind: z.literal('project'),
    operationId: id,
    libraryId: id.optional(),
  }),
])
const archetypeFields = z.object({
  id,
  name: text,
  use,
  yearFrom: nullableNumber,
  yearTo: nullableNumber,
  euiKwhPerM2: number,
  scheduleId: id.nullable(),
  source: definitionSource,
})
/**
 * Archetypes saved before definitions had year ranges and schedules take them
 * from the library entry of the same id, so assignment stays as it was.
 */
const archetype = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || 'source' in value) return value
  const saved = value as { id?: unknown }
  const entry = ARCHETYPE_LIBRARY.find((candidate) => candidate.id === saved.id)
  return entry
    ? { ...entry, ...saved, source: entry.source }
    : {
        yearFrom: null,
        yearTo: null,
        scheduleId: null,
        ...saved,
        source: { kind: 'project', operationId: 'saved-before-definitions' },
      }
}, archetypeFields)
const schedule = z.object({
  id,
  name: text,
  weekday: z.array(number).length(24),
  weekend: z.array(number).length(24),
  source: definitionSource,
})
const runGroup = z.object({
  id,
  kind: z.enum(['stage', 'fusion']).default('stage'),
  stageId: id,
  signature: z.object({
    ancestors: record(number),
    editRevision: number,
    membership: ids,
    options: text.default(''),
  }),
  fusion: z.object({ datasetId: id, mapping }).nullable().default(null),
  attemptIds: ids,
  held: record(z.union([heldFusion, heldAssignment, heldPreprocessing])),
  status: z.enum([
    'open',
    'published',
    'cancelled',
    'invalidated',
    'superseded',
  ]),
  statusReason: text.nullable(),
  createdAt: text,
})
const stageRun = z.object({
  runId: id,
  operationId: id,
  outcome: z.enum(['succeeded', 'failed']),
  message: text.nullable(),
  inputRevisions: record(number),
  inputEditRevision: number,
  finishedAt: text,
})

/**
 * Storage is an input boundary: check every field the workbench dereferences.
 * Fields added after projects were first saved have defaults, so parsing an
 * older save migrates it; use the parsed output, not the stored value.
 */
export const projectStateSchema: z.ZodType<WorkbenchState, unknown> = z
  .object({
    project: z.object({
      id,
      name: text,
      location: z.object({ name: text, center: point }).nullable(),
    }),
    assets: record(
      z.object({
        id,
        kind: z.enum([
          'group',
          'location',
          'gisDataset',
          'schemaRules',
          'buildings',
          'zones',
          'shadingResult',
          'pvYield',
          'archetypes',
          'weather',
          'energyModel',
          'energyResult',
          'measure',
          'scenario',
          'gridElements',
          'gridResult',
          'view',
          'report',
        ]),
        name: text,
        parentId: id.nullable(),
        childIds: ids,
        provenance,
        capability: capability.nullable(),
        summary: text.nullable(),
        entityIds: ids,
      }),
    ),
    rootAssetIds: ids,
    buildings: record(
      z.object({
        id,
        name: text,
        footprint: z.array(point),
        footprintAreaM2: number,
        sourceRef: text.nullable(),
        use: use.nullable(),
        yearBuilt: nullableNumber,
        floors: nullableNumber,
        heightM: nullableNumber,
        floorAreaM2: nullableNumber,
        zoneCount: nullableNumber,
        shadingFactor: nullableNumber,
        pvYieldKwh: nullableNumber,
        archetypeId: id.nullable(),
      }),
    ),
    buildingIds: ids,
    archetypes: record(archetype),
    schedules: record(schedule).default({}),
    measures: record(
      z.object({
        id,
        name: text,
        kind: z.enum(['envelope', 'heating', 'lighting', 'pv']),
        savingsPercent: number,
        appliesTo: z.enum([
          'all',
          'residential',
          'office',
          'retail',
          'school',
          'mixed',
        ]),
      }),
    ),
    scenarios: record(
      z.object({ id, name: text, measureIds: ids, adoptionPercent: number }),
    ),
    results: z.object({
      baseline: result.nullable(),
      scenarios: record(result),
    }),
    gridElements: record(
      z.object({
        id,
        kind: z.enum(['bus', 'line', 'transformer', 'utilityPv', 'load']),
        name: text,
        coordinates: z.array(point),
        ratingKva: nullableNumber,
        buildingIds: ids,
      }),
    ),
    gridResult: z
      .object({ runId: id, transformerLoadingPercent: record(number) })
      .nullable(),
    overrides: record(
      z.object({
        entityId: id,
        field,
        value: editValue,
        operationId: id,
        source,
      }),
    ),
    workflow: z.object({
      stageIds: ids,
      stages: record(
        z.object({
          id,
          name: text,
          description: text,
          capability,
          skippable: z.boolean(),
          custom: z.boolean(),
          skipped: z.boolean(),
          revision: number,
          editRevision: number,
          runCount: number,
          lastRun: stageRun.nullable(),
          unavailableReason: text.nullable(),
        }),
      ),
      edges: z.array(z.object({ from: id, to: id })),
      currentStageId: id.nullable(),
    }),
    tasks: record(
      z.object({
        id,
        label: text,
        stageId: id,
        runId: id,
        status: taskStatus,
        progress: number,
        message: text.nullable(),
        source,
        createdAt: text,
        updatedAt: text,
        log: z.array(z.object({ at: text, message: text })).default([]),
        groupId: id.nullable().default(null),
        attempt: number.int().positive().default(1),
        parentTaskId: id.nullable().default(null),
        requestId: text.nullable().default(null),
        items: z
          .object({
            ids,
            processed: number.int().nonnegative(),
            succeeded: number.int().nonnegative(),
            failures: record(text),
          })
          .nullable()
          .default(null),
      }),
    ),
    taskIds: ids,
    runGroups: record(runGroup).default({}),
    runGroupIds: ids.default([]),
    sourceRecords: record(
      z.object({
        sourceKey: id,
        datasetId: id,
        buildingId: id,
        fields: importedFields,
        footprint: ring.nullable(),
        operationId: id,
        source,
      }),
    ).default({}),
    sourceRecordIds: ids.default([]),
    datasets: record(
      z.object({
        datasetId: id,
        label: text,
        mapping,
        updated: number,
        added: number,
        conflicts: number,
        appliedAt: text,
        operationId: id,
      }),
    ).default({}),
    issues: z.array(
      z.object({
        id,
        severity: z.enum(['info', 'warning', 'error']),
        message: text,
        stageId: id.nullable(),
        createdAt: text,
      }),
    ),
    selection: z.object({
      entityType: z.enum(['building', 'gridElement']).nullable(),
      ids,
    }),
    pendingEdits: record(
      z.object({ entityId: id, field, from: editValue, to: editValue }),
    ),
    nextId: number.int().positive(),
  })
  .transform((state) => {
    // Library archetypes migrated above bring the library schedule they use.
    for (const item of Object.values(state.archetypes)) {
      if (item.scheduleId === null || item.scheduleId in state.schedules)
        continue
      const entry = SCHEDULE_LIBRARY.find(
        (candidate) => candidate.id === item.scheduleId,
      )
      if (entry && item.source.kind === 'library') {
        state.schedules[entry.id] = structuredClone(entry)
      }
    }
    return state
  })
  .superRefine((state, context) => {
    function fail(message: string) {
      context.addIssue({ code: 'custom', message })
    }
    function references(list: string[], collection: Record<string, unknown>) {
      if (
        new Set(list).size !== list.length ||
        list.some((key) => !(key in collection))
      )
        fail('A saved index contains duplicate or missing entities.')
    }
    references(state.rootAssetIds, state.assets)
    references(state.buildingIds, state.buildings)
    references(state.taskIds, state.tasks)
    references(state.runGroupIds, state.runGroups)
    for (const item of Object.values(state.archetypes)) {
      if (item.scheduleId !== null && !(item.scheduleId in state.schedules))
        fail('An archetype refers to a missing schedule.')
    }
    for (const [key, value] of Object.entries(state.schedules))
      if (key !== value.id) fail('A saved schedule has the wrong identity.')
    references(state.sourceRecordIds, state.sourceRecords)
    for (const [key, sourceRecord] of Object.entries(state.sourceRecords)) {
      if (sourceRecord.sourceKey !== key)
        fail('A saved source record has the wrong identity.')
      if (!(sourceRecord.buildingId in state.buildings))
        fail('A source record refers to a missing building.')
    }
    for (const group of Object.values(state.runGroups)) {
      if ((group.kind === 'fusion') !== (group.fusion !== null))
        fail('A data fusion run is missing its dataset.')
    }
    if (Object.keys(state.runGroups).length !== state.runGroupIds.length)
      fail('A run group is missing from the saved index.')
    for (const group of Object.values(state.runGroups)) {
      references(group.attemptIds, state.tasks)
      if (!(group.stageId in state.workflow.stages))
        fail('A run group stage is missing.')
      if (group.status === 'open' && group.attemptIds.length === 0)
        fail('An open run group has no attempts.')
      for (const attemptId of group.attemptIds) {
        const attempt = state.tasks[attemptId]
        if (
          attempt &&
          (attempt.groupId !== group.id || attempt.stageId !== group.stageId)
        )
          fail('A run group lists a job of another run.')
      }
    }
    for (const task of Object.values(state.tasks)) {
      const group = task.groupId ? state.runGroups[task.groupId] : undefined
      if (task.groupId !== null && !group)
        fail('A job refers to a missing run group.')
      if (group && !group.attemptIds.includes(task.id))
        fail('A run group does not list one of its jobs.')
      if (task.items && task.items.processed > task.items.ids.length)
        fail('A job processed more items than it has.')
    }
    references(state.workflow.stageIds, state.workflow.stages)
    const identifiedCollections: Record<string, { id: string }>[] = [
      state.assets,
      state.buildings,
      state.tasks,
      state.workflow.stages,
      state.measures,
      state.scenarios,
      state.archetypes,
      state.gridElements,
      state.runGroups,
    ]
    for (const collection of identifiedCollections) {
      for (const [key, value] of Object.entries(collection))
        if (key !== value.id) fail('A saved entity has the wrong identity.')
    }
    for (const asset of Object.values(state.assets)) {
      references(asset.childIds, state.assets)
      if (asset.parentId !== null && !(asset.parentId in state.assets))
        fail('An asset parent is missing.')
    }
    for (const scenario of Object.values(state.scenarios))
      references(scenario.measureIds, state.measures)
    for (const task of Object.values(state.tasks))
      if (!(task.stageId in state.workflow.stages))
        fail('A job stage is missing.')
    const stages = new Set(state.workflow.stageIds)
    if (
      state.workflow.currentStageId !== null &&
      !stages.has(state.workflow.currentStageId)
    )
      fail('The focused stage is missing.')
    if (
      state.workflow.edges.some(
        (edge) => !stages.has(edge.from) || !stages.has(edge.to),
      )
    )
      fail('A workflow edge refers to a missing stage.')
    function acyclic(keys: string[], edges: { from: string; to: string }[]) {
      const degrees = new Map(keys.map((key) => [key, 0]))
      const outgoing = new Map(keys.map((key) => [key, [] as string[]]))
      for (const edge of edges) {
        if (degrees.has(edge.to) && outgoing.has(edge.from)) {
          degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
          outgoing.get(edge.from)?.push(edge.to)
        }
      }
      const ready = keys.filter((key) => degrees.get(key) === 0)
      let visited = 0
      for (let index = 0; index < ready.length; index += 1) {
        const key = ready[index] ?? ''
        visited += 1
        for (const next of outgoing.get(key) ?? []) {
          const degree = (degrees.get(next) ?? 0) - 1
          degrees.set(next, degree)
          if (degree === 0) ready.push(next)
        }
      }
      return visited === keys.length
    }
    if (
      !acyclic(state.workflow.stageIds, state.workflow.edges) ||
      !acyclic(
        Object.keys(state.assets),
        Object.values(state.assets).flatMap((asset) =>
          asset.childIds.map((child) => ({ from: asset.id, to: child })),
        ),
      )
    )
      fail('A saved graph contains a cycle.')
  })
