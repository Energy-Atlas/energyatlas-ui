import { describe, expect, test } from 'vitest'
import { requiresApproval, command } from '../../app/agent/tools.ts'
import { createViewStore } from '../../app/view/viewStore.ts'
import { buildFixture } from '../../server/fixtures.ts'
import { SCHEMA_MIGRATION_ISSUE_ID } from '../../server/migrateSchemaMatching.ts'
import { projectStateSchema } from '../../server/projectSchema.ts'
import { createInitialState } from '../initialState.ts'
import { findDataset } from '../intake/datasets.ts'
import {
  INTAKE_TARGETS,
  reviewDataset,
  suggestIntakeMatches,
  suggestMapping,
} from '../intake/fusion.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker } from '../jobs/runGroups.ts'
import type { WorkbenchState } from '../types.ts'
import { attributeSources } from '../../app/panels/inspection.ts'
import { createTestProject } from '../../testing/testProject.ts'
import {
  checkTarget,
  compulsoryBlocker,
  distribution,
  profileSource,
  readValue,
  suggestMatches,
} from '../mapping/mapping.ts'
import { syntheticAttributes } from '../simulation.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import { footprintTags, tagsAt } from './footprintTags.ts'
import {
  mappedValuesFor,
  preprocessingUsedPublished,
  reviewSchema,
  schemaRunBlocker,
  sourceCollection,
} from './matching.ts'
import {
  SCHEMA_TARGETS,
  createSchemaMatching,
  findSchemaTarget,
} from './registry.ts'
import { checkRuleSet, parseRuleSetFile, ruleSetFile } from './ruleSets.ts'

function partway(): Workbench {
  return createWorkbench({
    initialState: buildFixture('partway', () => new Date()),
  })
}

function target(id: string) {
  const found = SCHEMA_TARGETS.find((item) => item.id === id)
  if (!found) throw new Error(`Missing target ${id}`)
  return found
}

function run(workbench: Workbench, stageId: string) {
  const result = runStageNow(workbench, stageId)
  expect(result.outcome.status).toBe('applied')
}

describe('target registry and source profiles', () => {
  test('puts the demo fields in RC tiers with types, units, and allowed values', () => {
    expect(
      SCHEMA_TARGETS.map((item) => [item.id, item.tier, item.required]),
    ).toEqual([
      ['use', 'compulsory', true],
      ['yearBuilt', 'compulsory', true],
      ['floors', 'compulsory', true],
      ['heightM', 'computed', false],
      ['floorAreaM2', 'computed', false],
      ['name', 'optional', false],
    ])
    expect(target('heightM').unit).toBe('m')
    expect(target('use').allowed).toContain('mixed')
    expect(
      findSchemaTarget({ customTargets: ['roof'] }, 'custom:roof'),
    ).toMatchObject({ tier: 'custom', type: 'text' })
  })

  test('infers types, examples, and distributions from values', () => {
    expect(profileSource('levels', ['3', '4', null, '3'])).toMatchObject({
      type: 'integer',
      example: '3',
      present: 3,
      missing: 1,
    })
    const height = profileSource('height', ['12.5', '48 ft', '9.0'])
    expect(height.type).toBe('category')
    const levels = profileSource('levels', ['3', '4', null, '3'])
    expect(distribution(levels, ['3', '4', null, '3'])).toEqual([
      { label: '3', count: 2 },
      { label: '4', count: 1 },
      { label: 'Missing', count: 1 },
    ])
  })

  test('reads values by type, recognises codes, and never converts units', () => {
    expect(readValue(target('use'), 'RES')).toEqual({
      status: 'value',
      value: 'residential',
    })
    expect(readValue(target('use'), 'yes')).toEqual({
      status: 'unrecognised',
      text: 'yes',
    })
    expect(readValue(target('use'), 'yes', { yes: 'mixed' })).toEqual({
      status: 'value',
      value: 'mixed',
    })
    expect(readValue(target('yearBuilt'), 'c. 1925').status).toBe('invalid')
    expect(readValue(target('heightM'), '48 ft').status).toBe('invalid')
    expect(readValue(target('heightM'), '15.6')).toEqual({
      status: 'value',
      value: 15.6,
    })
    expect(readValue(target('floors'), null).status).toBe('missing')
  })

  test('suggests each source once, best names first, and skips mapped targets', () => {
    const suggestions = suggestMatches(
      SCHEMA_TARGETS,
      ['building', 'YearBuilt', 'building:levels', 'bldg_heigth', 'name'],
      { floors: 'building:levels' },
    )
    expect(suggestions.use?.source).toBe('building')
    expect(suggestions.yearBuilt).toMatchObject({
      source: 'YearBuilt',
      reason: 'the same name',
    })
    expect(suggestions.floors).toBeUndefined()
    expect(suggestions.heightM?.source).toBe('bldg_heigth')
    expect(suggestions.heightM?.score).toBeLessThan(1)
    expect(suggestions.name?.source).toBe('name')
  })

  test('the footprint tags agree with the synthetic enrichment where present', () => {
    for (let index = 0; index < 50; index += 1) {
      const tags = tagsAt(index)
      const synthetic = syntheticAttributes(index)
      if (tags['building:levels'] !== null) {
        expect(Number(tags['building:levels'])).toBe(synthetic.floors)
      }
      if (tags.start_date && /^\d+$/.test(tags.start_date)) {
        expect(Number(tags.start_date)).toBe(synthetic.yearBuilt)
      }
    }
    expect(footprintTags({ sourceRef: 'infill/1' })).toBeNull()
  })
})

describe('review and validation', () => {
  test('has no source attributes before footprints are captured', () => {
    const review = reviewSchema(createInitialState())
    expect(review.collection.names).toEqual([])
    expect(review.blocker).toMatch(/no source attributes yet/)
  })

  test('the built-in mapping can run; unmapping a compulsory field blocks with a reason', () => {
    const workbench = partway()
    expect(reviewSchema(workbench.getState()).blocker).toBeNull()
    expect(reviewSchema(workbench.getState()).pending).toBe(2)
    workbench.execute({
      type: 'schema.mapTarget',
      input: { target: 'use', source: null },
    })
    const state = workbench.getState()
    expect(schemaRunBlocker(state)).toBe(
      '1 compulsory field is missing or invalid: Use. Map the compulsory fields on the Schema matching page first.',
    )
    expect(reviewSchema(state).issues).toEqual([
      {
        path: 'targets.use',
        message: 'Use is compulsory: choose the attribute that holds it.',
      },
    ])
    const rejected = workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.schema },
    })
    expect(rejected.outcome.status).toBe('rejected')
    expect(
      compulsoryBlocker(
        SCHEMA_TARGETS,
        ['building'],
        {},
        {
          use: { source: 'building', score: 1, reason: '' },
        },
      ),
    ).toMatch(/Review its suggestion first/)
  })

  test('reports unrecognised enumerated values with counts, and value maps read them', () => {
    const workbench = partway()
    const before = reviewSchema(workbench.getState()).checks.use
    const yes = before?.unrecognised.find((entry) => entry.value === 'yes')
    expect(yes?.count).toBeGreaterThan(0)
    expect(
      before?.enumValues.find((entry) => entry.value === 'apartments'),
    ).toMatchObject({ readAs: 'residential', via: 'map' })
    workbench.execute({
      type: 'schema.mapValue',
      input: { target: 'use', value: 'yes', to: 'mixed' },
    })
    const after = reviewSchema(workbench.getState()).checks.use
    expect(after?.unrecognised).toEqual([])
    expect(after?.valid).toBe((before?.valid ?? 0) + (yes?.count ?? 0))
    expect(
      workbench.execute({
        type: 'schema.mapValue',
        input: { target: 'use', value: 'yes', to: 'industrial' },
      }).outcome.status,
    ).toBe('rejected')
  })

  test('unmapping a value that is not mapped changes nothing', () => {
    // Without any value map for use, the no-op must not create an empty one.
    const initialState = structuredClone(
      buildFixture('partway', () => new Date()),
    )
    delete initialState.schemaMatching.valueMaps.use
    const workbench = createWorkbench({ initialState })
    const revision =
      workbench.getState().workflow.stages[STAGE_IDS.schema]?.editRevision
    const result = workbench.execute({
      type: 'schema.mapValue',
      input: { target: 'use', value: 'yes', to: null },
    })
    expect(result.outcome).toMatchObject({
      status: 'applied',
      summary: '"yes" is already unmapped.',
    })
    const after = workbench.getState()
    expect('use' in after.schemaMatching.valueMaps).toBe(false)
    expect(after.workflow.stages[STAGE_IDS.schema]?.editRevision).toBe(revision)
  })

  test('rejects sources and targets that do not exist', () => {
    const workbench = partway()
    expect(
      workbench.execute({
        type: 'schema.mapTarget',
        input: { target: 'use', source: 'landuse' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'source' }] })
    expect(
      workbench.execute({
        type: 'schema.mapTarget',
        input: { target: 'roof', source: 'building' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'target' }] })
  })

  test('accepts and rejects suggestions, and suggests again', () => {
    const workbench = partway()
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: ['name'], decision: 'accept' },
    })
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: ['heightM'], decision: 'reject' },
    })
    let matching = workbench.getState().schemaMatching
    expect(matching.mapping.name).toBe('name')
    expect(matching.mapping.heightM).toBeUndefined()
    expect(matching.suggestions).toEqual({})
    workbench.execute({ type: 'schema.suggest', input: {} })
    matching = workbench.getState().schemaMatching
    expect(Object.keys(matching.suggestions)).toEqual(['heightM'])
    expect(
      workbench.execute({
        type: 'schema.reviewSuggestions',
        input: { targets: ['use'], decision: 'accept' },
      }).outcome.status,
    ).toBe('rejected')
  })
})

describe('applying the mapping', () => {
  test('the built-in mapping reproduces the enrichment and publishes warnings', () => {
    const state = buildFixture('partway', () => new Date())
    const published = state.schemaMatching.published
    expect(published?.applied.use).toBeGreaterThan(400)
    expect(published?.warnings.map((warning) => warning.code)).toContain(
      'enum_values_unrecognised',
    )
    state.buildingIds.forEach((id, index) => {
      const building = state.buildings[id]
      const synthetic = syntheticAttributes(index)
      expect(building?.use).toBe(synthetic.use)
      expect(building?.floors).toBe(synthetic.floors)
    })
  })

  test('a mapping change makes the stage and everything after it outdated, and a run copies values with the tags kept', () => {
    const workbench = partway()
    const tagsBefore = JSON.stringify(
      sourceCollection(workbench.getState()).records,
    )
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: [], decision: 'accept' },
    })
    workbench.execute({
      type: 'schema.mapValue',
      input: { target: 'use', value: 'yes', to: 'mixed' },
    })
    let states = deriveStageStates(
      workbench.getState().workflow,
      workbench.getState().tasks,
    )
    expect(states[STAGE_IDS.schema]).toBe('stale')
    expect(states[STAGE_IDS.preprocessing]).toBe('stale')
    run(workbench, STAGE_IDS.schema)
    const state = workbench.getState()
    states = deriveStageStates(state.workflow, state.tasks)
    expect(states[STAGE_IDS.schema]).toBe('executed')
    expect(states[STAGE_IDS.preprocessing]).toBe('stale')
    const named = state.buildingIds
      .map((id) => state.buildings[id])
      .find((building) => building && footprintTags(building)?.name)
    expect(named?.name).toBe(named ? footprintTags(named)?.name : undefined)
    const yes = state.buildingIds
      .map((id) => state.buildings[id])
      .find(
        (building) => building && footprintTags(building)?.building === 'yes',
      )
    expect(yes?.use).toBe('mixed')
    expect(JSON.stringify(sourceCollection(state).records)).toBe(tagsBefore)
    // Computed heights take effect when preprocessing runs again.
    run(workbench, STAGE_IDS.preprocessing)
    const after = workbench.getState()
    const tall = after.buildingIds
      .map((id) => after.buildings[id])
      .find(
        (building) =>
          building && /^\d+\.\d$/.test(footprintTags(building)?.height ?? ''),
      )
    expect(tall?.heightM).toBe(Number(tall ? footprintTags(tall)?.height : 0))
  })

  test('precedence: synthetic, then mapped, then fused records, then manual overrides', () => {
    const workbench = partway()
    const state = workbench.getState()
    const id =
      state.buildingIds.find((candidate) => {
        const building = state.buildings[candidate]
        return building && footprintTags(building)?.['building:levels']
      }) ?? ''
    // A fused dataset value wins over the mapped one.
    workbench.execute({
      type: 'schema.mapValue',
      input: { target: 'use', value: 'yes', to: 'retail' },
    })
    const sourceKey = (state.buildings[id]?.sourceRef ?? '')
      .replace(/^OpenStreetMap /, '')
      .toLowerCase()
    const loaded = createWorkbench({
      initialState: {
        ...workbench.getState(),
        sourceRecords: {
          [sourceKey]: {
            sourceKey,
            datasetId: 'dataset:assessor',
            buildingId: id,
            fields: { yearBuilt: 1801 },
            footprint: null,
            operationId: 'op-fused',
            source: 'manual',
          },
        },
        sourceRecordIds: [sourceKey],
        overrides: {
          [`${id}:floors`]: {
            entityId: id,
            field: 'floors',
            value: 42,
            operationId: 'op-manual',
            source: 'manual',
          },
        },
      },
    })
    run(loaded, STAGE_IDS.schema)
    const building = loaded.getState().buildings[id]
    expect(building?.yearBuilt).toBe(1801)
    expect(building?.floors).toBe(42)
    expect(
      mappedValuesFor(
        building ?? { sourceRef: null },
        workbench.getState().schemaMatching.published,
      ).floors,
    ).toBe(
      Number(
        footprintTags(building ?? { sourceRef: null })?.['building:levels'],
      ),
    )
  })

  test('custom targets copy text and keep it with the building', () => {
    const workbench = partway()
    expect(
      workbench.execute({
        type: 'schema.addCustomTarget',
        input: { name: 'roof_shape', source: 'roof:shape' },
      }).outcome.status,
    ).toBe('applied')
    expect(
      workbench.execute({
        type: 'schema.addCustomTarget',
        input: { name: 'Use', source: 'roof:shape' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'name' }] })
    run(workbench, STAGE_IDS.schema)
    const state = workbench.getState()
    const building = state.buildings[state.buildingIds[0] ?? '']
    const values = mappedValuesFor(
      building ?? { sourceRef: null },
      state.schemaMatching.published,
    )
    expect(values.custom.roof_shape).toBe(
      footprintTags(building ?? { sourceRef: null })?.['roof:shape'],
    )
    workbench.execute({
      type: 'schema.removeCustomTarget',
      input: { name: 'roof_shape' },
    })
    expect(workbench.getState().schemaMatching.customTargets).toEqual([])
  })
})

describe('rule sets', () => {
  test('save, load, and the built-in rule set', () => {
    const workbench = partway()
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: [], decision: 'accept' },
    })
    workbench.execute({
      type: 'schema.saveRuleSet',
      input: { name: 'All tags' },
    })
    const saved = Object.values(workbench.getState().schemaMatching.ruleSets)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.mappings).toContainEqual({
      target: 'heightM',
      source: 'height',
      tier: 'computed',
      transform: null,
    })
    workbench.execute({
      type: 'schema.loadRuleSet',
      input: { ruleSetId: 'ruleSet:builtin' },
    })
    expect(workbench.getState().schemaMatching.mapping).toEqual(
      createSchemaMatching().mapping,
    )
    workbench.execute({
      type: 'schema.loadRuleSet',
      input: { ruleSetId: saved[0]?.id ?? '' },
    })
    expect(workbench.getState().schemaMatching.mapping.name).toBe('name')
    expect(workbench.getState().schemaMatching.loadedFrom).toBe('All tags')
    workbench.execute({
      type: 'schema.deleteRuleSet',
      input: { ruleSetId: saved[0]?.id ?? '' },
    })
    expect(workbench.getState().schemaMatching.ruleSetIds).toEqual([])
  })

  test('loading skips targets, sources, and transforms that do not exist, with reasons', () => {
    const workbench = partway()
    const file = {
      version: 1 as const,
      name: 'County export',
      mappings: [
        { target: 'use', source: 'land_use', tier: 'compulsory' as const },
        { target: 'floors', source: 'building:levels' },
        { target: 'roofType', source: 'roof:shape' },
        { target: 'yearBuilt', source: 'start_date', transform: 'year()' },
        { target: 'floors', source: 'height' },
      ],
      valueMaps: { use: { yes: 'mixed', shed: 'garage' } },
    }
    const check = checkRuleSet(workbench.getState(), file)
    expect(check.applicable).toEqual([
      {
        target: 'floors',
        source: 'building:levels',
        tier: 'compulsory',
        transform: null,
      },
    ])
    expect(check.skipped).toHaveLength(5)
    expect(check.skipped.join(' ')).toMatch(/transform_not_supported/)
    const result = workbench.execute({
      type: 'schema.loadRuleSet',
      input: { file },
    })
    expect(result.outcome.status).toBe('applied')
    expect(workbench.getState().schemaMatching.mapping).toEqual({
      floors: 'building:levels',
    })
    expect(workbench.getState().schemaMatching.valueMaps).toEqual({
      use: { yes: 'mixed' },
    })
    expect(
      workbench.execute({
        type: 'schema.loadRuleSet',
        input: {
          file: { version: 1, mappings: [{ target: 'x', source: 'y' }] },
        },
      }).outcome.status,
    ).toBe('rejected')
  })

  test('a rule set file round-trips and bad files are explained', () => {
    const workbench = partway()
    workbench.execute({ type: 'schema.saveRuleSet', input: { name: 'Base' } })
    const ruleSet = Object.values(
      workbench.getState().schemaMatching.ruleSets,
    )[0]
    if (!ruleSet) throw new Error('Missing rule set')
    const parsed = parseRuleSetFile(ruleSetFile(ruleSet))
    expect(parsed).toMatchObject({ ok: true, file: { name: 'Base' } })
    expect(parseRuleSetFile('{')).toEqual({
      ok: false,
      message: 'The file is not JSON.',
    })
    expect(parseRuleSetFile('{"version":2,"mappings":[]}').ok).toBe(false)
  })
})

describe('saved projects and parity', () => {
  test('a save from before the mapping gets the built-in mapping and an outdated stage', () => {
    const state = buildFixture('partway', () => new Date())
    const saved = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete saved.schemaMatching
    const parsed = projectStateSchema.parse(saved)
    expect(parsed.schemaMatching.mapping).toEqual(
      createSchemaMatching().mapping,
    )
    expect(parsed.schemaMatching.published).toBeNull()
    expect(
      deriveStageStates(parsed.workflow, parsed.tasks)[STAGE_IDS.schema],
    ).toBe('stale')
    expect(parsed.issues.map((issue) => issue.id)).toContain(
      SCHEMA_MIGRATION_ISSUE_ID,
    )
    const empty = JSON.parse(JSON.stringify(createInitialState())) as Record<
      string,
      unknown
    >
    delete empty.schemaMatching
    expect(projectStateSchema.parse(empty).issues).toEqual([])
  })

  test('saves rule sets, suggestions, and the published mapping', () => {
    const workbench = partway()
    workbench.execute({ type: 'schema.saveRuleSet', input: { name: 'Base' } })
    const state = workbench.getState()
    const parsed = projectStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(parsed.schemaMatching).toEqual(state.schemaMatching)
  })

  test('schema commands wait for approval; reviewing the values is a view operation', () => {
    expect(
      requiresApproval(
        command({
          type: 'schema.mapTarget',
          input: { target: 'use', source: 'building' },
        }),
      ),
    ).toBe(true)
    const workbench = partway()
    const view = createViewStore(workbench)
    expect(
      view.execute({
        type: 'schema.inspectSource',
        input: { source: 'height' },
      }).outcome.status,
    ).toBe('applied')
    expect(view.getState().schema.source).toBe('height')
    expect(
      view.execute({ type: 'schema.inspectSource', input: { source: 'nope' } })
        .outcome.status,
    ).toBe('rejected')
  })
})

describe('Data intake on the shared mapping', () => {
  test('choosing a dataset leaves suggestions to review, and the mapping takes one field per target', () => {
    const workbench = partway()
    const view = createViewStore(workbench)
    view.execute({
      type: 'intake.chooseDataset',
      input: { datasetId: 'dataset:assessor' },
    })
    expect(view.getState().intake.mapping.osm_ref).toBeNull()
    expect(Object.keys(view.getState().intake.suggestions)).toHaveLength(4)
    view.execute({
      type: 'intake.reviewSuggestions',
      input: { targets: [], decision: 'accept' },
    })
    expect(view.getState().intake.mapping).toMatchObject({
      osm_ref: 'sourceId',
      stories: 'floors',
    })
    view.execute({
      type: 'intake.mapTarget',
      input: { target: 'floors', field: 'yr_built' },
    })
    expect(view.getState().intake.mapping).toMatchObject({
      stories: null,
      yr_built: 'floors',
    })
    expect(
      view.execute({
        type: 'intake.mapTarget',
        input: { target: 'floors', field: 'missing' },
      }).outcome.status,
    ).toBe('rejected')
  })

  test('the review checks values and lists unrecognised uses', () => {
    const dataset = findDataset('dataset:assessor')
    if (!dataset) throw new Error('Missing dataset')
    expect(suggestIntakeMatches(dataset).sourceId?.source).toBe('osm_ref')
    const review = reviewDataset(dataset, {
      osm_ref: 'sourceId',
      use_code: 'use',
      stories: 'floors',
      yr_built: null,
      assessed_note: null,
    })
    expect(review.checks.use?.unrecognised).toEqual([
      { value: 'IND', count: 1 },
    ])
    expect(review.checks.floors?.invalid).toBe(2)
    expect(review.sources.map((source) => source.name)).toEqual(dataset.fields)
    const use = INTAKE_TARGETS.find((item) => item.id === 'use')
    if (!use) throw new Error('Missing target')
    expect(checkTarget(use, 'x', ['RES', 'office', null]).valid).toBe(2)
  })
})

describe('review findings', () => {
  test('a mapping edit keeps a partly failed fusion retryable', () => {
    const workbench = partway()
    const dataset = findDataset('dataset:assessor')
    if (!dataset) throw new Error('Missing dataset')
    workbench.execute({
      type: 'intake.applyDataset',
      input: { datasetId: dataset.id, mapping: suggestMapping(dataset) },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const failing = workbench.getState().tasks[taskId]?.items?.ids[2] ?? ''
    finishJobNow(workbench, taskId, { failures: { [failing]: 'Fault.' } })
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: ['name'], decision: 'accept' },
    })
    expect(retryBlocker(workbench.getState(), taskId)).toBeNull()
    workbench.execute({ type: 'job.retry', input: { taskId } })
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    const group =
      workbench.getState().runGroups[
        workbench.getState().tasks[taskId]?.groupId ?? ''
      ]
    expect(group?.status).toBe('published')
  })

  test('Properties credit mapped heights only after preprocessing reads the published mapping', () => {
    const workbench = partway()
    workbench.execute({
      type: 'schema.reviewSuggestions',
      input: { targets: ['heightM'], decision: 'accept' },
    })
    run(workbench, STAGE_IDS.schema)
    const pick = (state: WorkbenchState) => {
      const id =
        state.buildingIds.find((candidate) => {
          const building = state.buildings[candidate]
          return (
            building && /^\d+\.\d$/.test(footprintTags(building)?.height ?? '')
          )
        }) ?? ''
      const building = state.buildings[id]
      if (!building) throw new Error('Missing building')
      return attributeSources(state, building).find(
        (fact) => fact.label === 'Height',
      )?.value
    }
    expect(preprocessingUsedPublished(workbench.getState())).toBe(false)
    expect(pick(workbench.getState())).toMatch(
      /^Computed; Schema matching maps/,
    )
    run(workbench, STAGE_IDS.preprocessing)
    expect(preprocessingUsedPublished(workbench.getState())).toBe(true)
    expect(pick(workbench.getState())).toMatch(/^Schema matching from "height"/)
  })

  test('Accept all in Data intake keeps a field mapped by hand', () => {
    const workbench = partway()
    const view = createViewStore(workbench)
    view.execute({
      type: 'intake.chooseDataset',
      input: { datasetId: 'dataset:assessor' },
    })
    view.execute({
      type: 'intake.mapTarget',
      input: { target: 'name', field: 'osm_ref' },
    })
    const result = view.execute({
      type: 'intake.reviewSuggestions',
      input: { targets: [], decision: 'accept' },
    })
    expect(view.getState().intake.mapping.osm_ref).toBe('name')
    expect(result.outcome.status).toBe('applied')
    expect(
      result.outcome.status === 'applied' ? result.outcome.summary : '',
    ).toContain(
      'Dropped 1: Source ID (its suggested "osm_ref" already feeds Name)',
    )
  })

  test('loading a rule set checks custom names like adding one', () => {
    const check = checkRuleSet(partway().getState(), {
      mappings: [
        { target: 'custom:Use', source: 'roof:shape' },
        { target: 'custom:note', source: 'roof:shape' },
        { target: 'custom:Note', source: 'name' },
      ],
    })
    expect(check.customTargets).toEqual(['note'])
    expect(check.skipped).toEqual([
      'Custom target "Use": A target field named "Use" already exists.',
      'Custom target "Note": A target field named "Note" already exists.',
    ])
  })

  test('reloading the mapping already in place outdates nothing', () => {
    const workbench = partway()
    const revision =
      workbench.getState().workflow.stages[STAGE_IDS.schema]?.editRevision
    const result = workbench.execute({
      type: 'schema.loadRuleSet',
      input: { ruleSetId: 'ruleSet:builtin' },
    })
    expect(
      result.outcome.status === 'applied' ? result.outcome.summary : '',
    ).toContain('nothing is outdated')
    const state = workbench.getState()
    expect(state.workflow.stages[STAGE_IDS.schema]?.editRevision).toBe(revision)
    expect(
      deriveStageStates(state.workflow, state.tasks)[STAGE_IDS.schema],
    ).toBe('executed')
  })

  test('the server refuses mapping changes while a job is queued or running', async () => {
    const { client, manual } = createTestProject({ fixture: 'partway' })
    void client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.shading },
    })
    await manual.flush()
    const refused = client.execute({
      type: 'schema.mapTarget',
      input: { target: 'use', source: null },
    })
    await manual.settle(200)
    const result = await refused
    expect(result.outcome.status).toBe('rejected')
    if (result.outcome.status === 'rejected') {
      expect(result.outcome.issues[0]?.message).toMatch(/A run is in progress/)
    }
  })
})
