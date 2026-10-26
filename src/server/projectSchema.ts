import { z } from 'zod'
import { capabilities, type CapabilityId } from '../domain/capabilities.ts'
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
const stageRun = z.object({
  runId: id,
  operationId: id,
  outcome: z.enum(['succeeded', 'failed']),
  message: text.nullable(),
  inputRevisions: record(number),
  inputEditRevision: number,
  finishedAt: text,
})

/** Storage is an input boundary: check every field the workbench dereferences. */
export const projectStateSchema: z.ZodType<WorkbenchState> = z
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
    archetypes: record(z.object({ id, name: text, use, euiKwhPerM2: number })),
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
        status: z.enum([
          'queued',
          'running',
          'succeeded',
          'failed',
          'cancelled',
        ]),
        progress: number,
        message: text.nullable(),
        source,
        createdAt: text,
        updatedAt: text,
        log: z.array(z.object({ at: text, message: text })),
      }),
    ),
    taskIds: ids,
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
