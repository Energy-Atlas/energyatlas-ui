import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker, retryScope } from '../jobs/runGroups.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import { DATASETS, findDataset, type Dataset } from './datasets.ts'
import { mappingIssues, prepareDataset, suggestMapping } from './fusion.ts'

function dataset(id: string): Dataset {
  const found = findDataset(id)
  if (!found) throw new Error(`Missing dataset ${id}`)
  return found
}

function partway(): Workbench {
  return createWorkbench({
    initialState: buildFixture('partway', () => new Date()),
  })
}

function applyDataset(workbench: Workbench, id: string) {
  const source = dataset(id)
  return workbench.execute({
    type: 'intake.applyDataset',
    input: { datasetId: id, mapping: suggestMapping(source) },
  })
}

describe('dataset mapping and validation', () => {
  test('suggests one model field per dataset field for review', () => {
    expect(suggestMapping(dataset('dataset:assessor'))).toEqual({
      osm_ref: 'sourceId',
      use_code: 'use',
      yr_built: 'yearBuilt',
      stories: 'floors',
      assessed_note: null,
    })
    expect(suggestMapping(dataset('dataset:infill')).geometry).toBe('footprint')
  })

  test('blocks the whole dataset without a source ID or with a doubled target', () => {
    const broken = dataset('dataset:broken')
    const issues = mappingIssues(broken, suggestMapping(broken))
    expect(issues.map((issue) => issue.path)).toEqual(['mapping'])
    expect(issues[0]?.message).toMatch(/Source ID/)
    const assessor = dataset('dataset:assessor')
    const doubled = {
      ...suggestMapping(assessor),
      assessed_note: 'floors' as const,
    }
    expect(mappingIssues(assessor, doubled)).toEqual([
      expect.objectContaining({ path: 'mapping.assessed_note' }),
    ])
  })

  test('reports row errors, rejects ambiguous and unmatched IDs, and keeps unmatched buildings', () => {
    const state = partway().getState()
    const source = dataset('dataset:assessor')
    const prepared = prepareDataset(state, source, suggestMapping(source))
    const rejected = prepared.rows.filter((row) => row.status === 'rejected')
    const messages = rejected.flatMap((row) =>
      row.issues.map((issue) => `${row.index}:${issue.message}`),
    )
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^4:Floors "0"/),
        expect.stringMatching(/^9:Floors "twelve"/),
        expect.stringMatching(/^14:Year built "2150"/),
        expect.stringMatching(/^20:Source ID .* appears 2 times/),
        expect.stringMatching(/^21:Source ID .* appears 2 times/),
        expect.stringMatching(/^25:Use "IND"/),
        expect.stringMatching(/^30:No building has source ID "way\/0"/),
      ]),
    )
    expect(prepared.counts.rejected).toBe(7)
    expect(prepared.counts.valid).toBe(53)
    expect(prepared.counts.adds).toBe(0)
    expect(prepared.counts.retained).toBe(464 - 53)
  })

  test('shows manual overrides winning over imported values as conflicts', () => {
    const workbench = partway()
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'floors', value: 30 },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    const source = dataset('dataset:assessor')
    const prepared = prepareDataset(
      workbench.getState(),
      source,
      suggestMapping(source),
    )
    const first = prepared.plans.find((plan) => plan.buildingId === 'B0001')
    expect(first?.conflicts).toHaveLength(1)
    expect(first?.conflicts[0]).toMatchObject({ field: 'floors', manual: 30 })
    expect(first?.fields.floors).toBeUndefined()
  })
})

describe('fusion jobs', () => {
  test('hold every record until all succeed, then publish once and stale dependents', () => {
    const workbench = partway()
    const before = structuredClone(workbench.getState().buildings.B0001)
    expect(applyDataset(workbench, 'dataset:assessor').outcome.status).toBe(
      'applied',
    )
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const failingKey = workbench.getState().tasks[taskId]?.items?.ids[3] ?? ''
    finishJobNow(workbench, taskId, { failures: { [failingKey]: 'Fault.' } })
    let state = workbench.getState()
    expect(state.tasks[taskId]).toMatchObject({
      status: 'failed',
      label: 'Data fusion: Assessor attributes',
    })
    // Nothing reached the project, and the stage itself is not failed.
    expect(state.buildings.B0001).toEqual(before)
    expect(state.workflow.stages[STAGE_IDS.schema]?.lastRun?.outcome).toBe(
      'succeeded',
    )
    const group = state.runGroups[state.tasks[taskId]?.groupId ?? '']!
    expect(retryScope(group)).toBe('Retry 1 failed record')
    expect(retryBlocker(state, taskId)).toBeNull()

    workbench.execute({ type: 'job.retry', input: { taskId } })
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    state = workbench.getState()
    expect(state.runGroups[group.id]?.status).toBe('published')
    expect(state.datasets['dataset:assessor']).toMatchObject({ added: 0 })
    expect(Object.keys(state.sourceRecords)).toHaveLength(53)
    expect(state.buildingIds).toHaveLength(464)
    const states = deriveStageStates(state.workflow, state.tasks)
    expect(states[STAGE_IDS.enrichment]).toBe('executed')
    expect(states[STAGE_IDS.schema]).toBe('stale')
  })

  test('adds buildings with geometry, keeps them through reruns, and keeps imported values under overrides', () => {
    const workbench = partway()
    applyDataset(workbench, 'dataset:infill')
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    let state = workbench.getState()
    expect(state.buildingIds).toHaveLength(470)
    const added = state.buildings.B0465
    expect(added).toMatchObject({
      name: 'Infill building 1',
      use: 'residential',
      floors: 3,
      sourceRef: 'infill/1',
    })
    expect(added?.footprintAreaM2).toBeGreaterThan(0)
    // Adding buildings changes captured footprints, so everything downstream is outdated.
    expect(
      deriveStageStates(state.workflow, state.tasks)[STAGE_IDS.enrichment],
    ).toBe('stale')

    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0465', field: 'floors', value: 12 },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    runStageNow(workbench, STAGE_IDS.location)
    runStageNow(workbench, STAGE_IDS.enrichment)
    state = workbench.getState()
    expect(state.buildingIds).toHaveLength(470)
    expect(state.buildings.B0465).toMatchObject({
      use: 'residential',
      yearBuilt: 2026,
      floors: 12,
    })
  })

  test('reject a schema-blocked dataset and a second fusion while one is queued', () => {
    const workbench = partway()
    expect(applyDataset(workbench, 'dataset:broken').outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'mapping' }],
    })
    applyDataset(workbench, 'dataset:assessor')
    const second = applyDataset(workbench, 'dataset:infill').outcome
    expect(second.status).toBe('rejected')
    expect(
      second.status === 'rejected' ? second.issues[0]?.message : '',
    ).toMatch(/queued or running/)
  })

  test('a changed mapping is a changed input', () => {
    const workbench = partway()
    applyDataset(workbench, 'dataset:assessor')
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    finishJobNow(workbench, taskId, {
      failures: {
        [workbench.getState().tasks[taskId]?.items?.ids[0] ?? '']: 'Fault.',
      },
    })
    const source = dataset('dataset:assessor')
    const remapped = { ...suggestMapping(source), yr_built: null }
    workbench.execute({
      type: 'intake.applyDataset',
      input: { datasetId: source.id, mapping: remapped },
    })
    const state = workbench.getState()
    expect(state.runGroups[state.tasks[taskId]?.groupId ?? '']?.status).toBe(
      'superseded',
    )
  })

  test('every dataset fixture prepares deterministically', () => {
    const state = partway().getState()
    for (const source of DATASETS) {
      const first = prepareDataset(state, source, suggestMapping(source))
      const second = prepareDataset(state, source, suggestMapping(source))
      expect(second).toEqual(first)
    }
  })
})
