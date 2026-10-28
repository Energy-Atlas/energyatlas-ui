import { describe, expect, test } from 'vitest'
import { STAGE_IDS } from '../domain/workflow.ts'
import type { WorkbenchState } from '../domain/types.ts'
import { memoryStorage } from '../testing/memoryStorage.ts'
import { createTestProject } from '../testing/testProject.ts'
import { VIEW_ONLY_MESSAGE } from './apiError.ts'
import { buildFixture } from './fixtures.ts'
import {
  buildHandoverPackage,
  handoverBlocker,
  HANDOVER_VERSION,
  NOT_SAVED_FOR_HANDOVER,
  packageFileName,
  packageWarnings,
  readHandoverPackage,
  readHandoverText,
  type HandoverPackage,
} from './handover.ts'
import {
  HANDOVER_CATALOG_KEY,
  readHandoverCatalog,
  viewerLayoutsKey,
} from './handoverCatalog.ts'
import { CATALOG_KEY } from './projectCatalog.ts'
import { createMockServer, SERVER_COMMANDS } from './server.ts'

const NOW = new Date('2026-10-28T12:00:00Z')

/** A complete project with working data a handover must leave out. */
function workingState(): WorkbenchState {
  const state = structuredClone(buildFixture('complete', () => NOW))
  const groupId = state.runGroupIds[0]
  const group = groupId ? state.runGroups[groupId] : undefined
  if (!group) throw new Error('The fixture has no run group.')
  group.held = {
    'building-1': {
      kind: 'preprocessing',
      heightM: 10,
      floorAreaM2: 100,
      zoneCount: 1,
    },
  } as WorkbenchState['runGroups'][string]['held']
  const buildingId = state.buildingIds[0] ?? ''
  state.pendingEdits = {
    [`${buildingId}:floors`]: {
      entityId: buildingId,
      field: 'floors',
      from: 3,
      to: 4,
    },
  } as unknown as WorkbenchState['pendingEdits']
  state.selection = { entityType: 'building', ids: [buildingId] }
  return state
}

function packageOf(state: WorkbenchState = workingState()): HandoverPackage {
  return buildHandoverPackage({
    state,
    view: { tables: {}, layouts: [], defaultLayoutId: null },
    savedAt: null,
    unsavedChanges: true,
    drafts: 2,
    source: 'manual',
    now: NOW,
    id: 'handover:test',
  })
}

describe('handover package', () => {
  test('keeps the published model and results and leaves out working data', () => {
    const state = workingState()
    const logLines = Object.values(state.tasks).reduce(
      (sum, task) => sum + task.log.length,
      0,
    )
    expect(logLines).toBeGreaterThan(0)
    const pkg = packageOf(state)
    expect(pkg.model.pendingEdits).toEqual({})
    expect(pkg.model.selection).toEqual({ entityType: null, ids: [] })
    expect(pkg.model.workflow.currentStageId).toBeNull()
    expect(
      Object.values(pkg.model.runGroups).every(
        (group) => Object.keys(group.held).length === 0,
      ),
    ).toBe(true)
    expect(
      Object.values(pkg.model.tasks).every((task) => task.log.length === 0),
    ).toBe(true)
    expect(pkg.provenance.excluded).toEqual({
      heldOutputs: 1,
      jobLogLines: logLines,
      drafts: 2,
    })
    // Published results, definitions, and jobs (without logs) stay.
    expect(pkg.model.results).toEqual(state.results)
    expect(pkg.model.buildings).toEqual(state.buildings)
    expect(pkg.model.taskIds).toEqual(state.taskIds)
    expect(pkg.provenance.results.map((result) => result.id)).toContain(
      'baseline',
    )
    expect(pkg.provenance.unsavedChanges).toBe(true)
    expect(pkg.provenance.stages.map((stage) => stage.id)).toEqual(
      state.workflow.stageIds,
    )
    // The source state is untouched.
    expect(Object.keys(state.pendingEdits)).toHaveLength(1)
    expect(packageFileName(pkg)).toBe(
      'synthetic-district-demo-2026-10-28.handover.json',
    )
  })

  test('opens a package made before zoning with the default setting (decision 0032, stage 6)', () => {
    const pkg = JSON.parse(JSON.stringify(packageOf())) as {
      model: Record<string, unknown>
    }
    delete pkg.model.zoning
    const read = readHandoverText(JSON.stringify(pkg))
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.package.model.zoning).toEqual({
        mode: 'single',
        perimeterDepthM: 4.5,
        published: null,
      })
    }
  })

  test('round-trips through a file and is read like a saved project', () => {
    const pkg = packageOf()
    const read = readHandoverText(JSON.stringify(pkg))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.package.model.results).toEqual(pkg.model.results)
  })

  test('refuses corrupt, foreign, newer, damaged, and unfrozen packages', () => {
    expect(readHandoverText('{"format": "energyatlas')).toMatchObject({
      ok: false,
      code: 'corrupt',
    })
    expect(readHandoverPackage({ hello: 'world' })).toMatchObject({
      ok: false,
      code: 'foreign',
    })
    const pkg = packageOf()
    const newer = readHandoverPackage({
      ...pkg,
      version: HANDOVER_VERSION + 1,
    })
    expect(newer).toMatchObject({ ok: false, code: 'newer' })
    if (!newer.ok) expect(newer.message).toContain('newer version')
    expect(readHandoverPackage({ ...pkg, version: 0 })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    const damaged = readHandoverPackage({ ...pkg, model: { project: {} } })
    expect(damaged).toMatchObject({ ok: false, code: 'invalid' })
    if (!damaged.ok) expect(damaged.message).toContain('(model')
    const unfrozen = structuredClone(pkg)
    unfrozen.model.tasks[unfrozen.model.taskIds[0] ?? '']!.log = [
      { at: NOW.toISOString(), message: 'kept by mistake' },
    ]
    const working = readHandoverPackage(unfrozen)
    expect(working).toMatchObject({ ok: false, code: 'invalid' })
    if (!working.ok) expect(working.message).toContain('working data')
  })

  test('warns about missing and outdated results', () => {
    const empty = buildFixture('partway', () => NOW)
    expect(packageWarnings(packageOf(empty))[0]).toContain(
      'no published results',
    )
    const complete = packageOf(buildFixture('complete', () => NOW))
    expect(packageWarnings(complete)).toEqual([])
    const outdated = structuredClone(complete)
    const baseline = outdated.model.workflow.stages[STAGE_IDS.baseline]!
    baseline.editRevision += 1
    expect(packageWarnings(outdated).join(' ')).toContain('outdated')
  })

  test('cannot freeze a project with running jobs or no buildings', () => {
    const state = structuredClone(buildFixture('complete', () => NOW))
    expect(handoverBlocker(state)).toBeNull()
    const taskId = state.taskIds[0] ?? ''
    state.tasks[taskId]!.status = 'running'
    expect(handoverBlocker(state)).toContain('still running')
    expect(handoverBlocker(buildFixture('new', () => NOW))).toContain(
      'no buildings',
    )
  })
})

/** Saves a complete fixture and hands it over into `storage` from a modeller session. */
async function handOver(storage: Storage) {
  const modeller = createTestProject({ storage, fixture: 'complete' })
  const saved = modeller.client.save()
  await modeller.manual.settle()
  expect((await saved).outcome.status).toBe('applied')
  const handed = modeller.client.handOver()
  await modeller.manual.settle()
  return { modeller, handed: await handed }
}

describe('forged packages', () => {
  /** A package whose latest baseline job is queued again in an open run. */
  function forged(): HandoverPackage {
    const pkg = packageOf(structuredClone(buildFixture('complete', () => NOW)))
    const task = [...pkg.model.taskIds]
      .reverse()
      .map((id) => pkg.model.tasks[id]!)
      .find((each) => each.stageId === STAGE_IDS.baseline)!
    task.status = 'queued'
    task.progress = 0
    if (task.groupId) pkg.model.runGroups[task.groupId]!.status = 'open'
    return pkg
  }

  test('a package with queued jobs or open runs is refused', () => {
    const read = readHandoverPackage(forged())
    expect(read).toMatchObject({ ok: false, code: 'invalid' })
    if (!read.ok) expect(read.message).toContain('queued or running jobs')
    const server = createMockServer({
      storage: null,
      scheduler: { schedule: () => () => undefined },
      startClosed: true,
      mode: 'viewer',
    })
    const reply = server.handle({
      type: 'handover.open',
      source: 'manual',
      file: { name: 'forged.json', text: JSON.stringify(forged()) },
    })
    expect(reply.ok).toBe(false)
    expect(server.current().state).toBeNull()
  })

  test('freezing closes runs left open, so the modeller never writes one', () => {
    const state = structuredClone(buildFixture('complete', () => NOW))
    const groupId = state.runGroupIds[0] ?? ''
    state.runGroups[groupId]!.status = 'open'
    const pkg = packageOf(state)
    expect(pkg.model.runGroups[groupId]?.status).toBe('cancelled')
    expect(readHandoverPackage(pkg).ok).toBe(true)
  })

  test('a viewer session never starts the job runner', () => {
    let scheduled = 0
    const server = createMockServer({
      storage: null,
      scheduler: {
        schedule: () => {
          scheduled += 1
          return () => undefined
        },
      },
      startClosed: true,
      mode: 'viewer',
    })
    const reply = server.handle({
      type: 'handover.open',
      source: 'manual',
      file: { name: 'complete.json', text: JSON.stringify(packageOf()) },
    })
    expect(reply.ok).toBe(true)
    expect(scheduled).toBe(0)
    expect(server.current().meta.dirty).toBe(false)
  })

  test('results and stage states are read from the model, not the file', () => {
    const pkg = packageOf()
    pkg.provenance.results = [
      { id: 'scenario:invented', label: 'Invented', runId: 'run-x' },
    ]
    pkg.provenance.stages = []
    const read = readHandoverPackage(JSON.parse(JSON.stringify(pkg)))
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.package.provenance.results.map((each) => each.id)).toEqual(
        packageOf().provenance.results.map((each) => each.id),
      )
      expect(read.package.provenance.stages).toHaveLength(
        pkg.model.workflow.stageIds.length,
      )
    }
  })
})

describe('handover through the mock server', () => {
  test('a project never saved cannot be handed over', async () => {
    const storage = memoryStorage()
    const modeller = createTestProject({ storage, fixture: 'complete' })
    const handed = modeller.client.handOver()
    await modeller.manual.settle()
    const { result, package: pkg } = await handed
    expect(pkg).toBeNull()
    expect(result.outcome.status).toBe('rejected')
    if (result.outcome.status === 'rejected')
      expect(result.outcome.issues[0]?.message).toBe(NOT_SAVED_FOR_HANDOVER)
    expect(readHandoverCatalog(storage).catalog.packages).toEqual([])
  })

  test('the package holds the saved copy, not changes made since', async () => {
    const storage = memoryStorage()
    const modeller = createTestProject({ storage, fixture: 'complete' })
    const saved = modeller.client.save()
    await modeller.manual.settle()
    await saved
    const savedAt = modeller.client.store.getState().meta.savedAt
    const savedMode = modeller.workbench.getState().zoning.mode
    const changed = modeller.client.execute({
      type: 'zoning.set',
      input: { mode: savedMode === 'floors' ? 'single' : 'floors' },
    })
    await modeller.manual.settle()
    expect((await changed).outcome.status).toBe('applied')
    expect(modeller.client.store.getState().meta.dirty).toBe(true)

    const handed = modeller.client.handOver()
    await modeller.manual.settle()
    const { package: pkg } = await handed
    expect(pkg?.model.zoning.mode).toBe(savedMode)
    expect(pkg?.provenance).toMatchObject({ savedAt, unsavedChanges: true })
    // Handing over neither saves nor discards the modeller's changes.
    expect(modeller.client.store.getState().meta.dirty).toBe(true)
    expect(modeller.workbench.getState().zoning.mode).not.toBe(savedMode)
  })

  test('a copy saved while jobs ran is refused, whatever runs now', () => {
    const state = workingState()
    const taskId = state.taskIds.at(-1) ?? ''
    state.tasks[taskId]!.status = 'running'
    expect(handoverBlocker(state, 'saved')).toContain(
      'The saved copy was saved while a job ran',
    )
    expect(
      handoverBlocker(
        buildFixture('new', () => NOW),
        'saved',
      ),
    ).toContain('The saved copy has no buildings')
  })

  test('the modeller hands over into the browser catalog', async () => {
    const storage = memoryStorage()
    const { handed, modeller } = await handOver(storage)
    expect(handed.result.outcome.status).toBe('applied')
    expect(handed.storeError).toBeNull()
    expect(handed.package?.name).toBe('Synthetic district (demo)')
    const { catalog, error } = readHandoverCatalog(storage)
    expect(error).toBeNull()
    expect(catalog.packages.map((pkg) => pkg.id)).toEqual([handed.package?.id])
    // A handover is not a model change.
    expect(modeller.workbench.store.getState().log.at(-1)?.type).toBe(
      'project.handover',
    )
    // The modeller cannot open packages; that is the viewer page's job.
    const open = modeller.client.openPackage({
      packageId: handed.package?.id ?? '',
    })
    await modeller.manual.settle()
    expect((await open).outcome.status).toBe('rejected')
    // It lists and removes them to free storage, with the viewer's layouts.
    storage.setItem(viewerLayoutsKey(handed.package?.id ?? ''), '{}')
    const listed = modeller.client.listPackages()
    await modeller.manual.settle()
    expect((await listed).outcome.status).toBe('applied')
    expect(modeller.client.store.getState().meta.packages[0]?.bytes).toBe(
      JSON.stringify(handed.package).length,
    )
    const removed = modeller.client.removePackage(handed.package?.id ?? '')
    await modeller.manual.settle()
    expect((await removed).outcome.status).toBe('applied')
    expect(modeller.client.store.getState().meta.packages).toEqual([])
    expect(storage.getItem(viewerLayoutsKey(handed.package?.id ?? ''))).toBe(
      null,
    )
  })

  test('a full storage names handover packages when a save fails', async () => {
    const storage = memoryStorage()
    await handOver(storage)
    const setItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === CATALOG_KEY)
        throw new DOMException('full', 'QuotaExceededError')
      setItem(key, value)
    }
    const project = createTestProject({ storage, fixture: 'partway' })
    const saved = project.client.save()
    await project.manual.settle()
    const result = await saved
    expect(result.outcome.status).toBe('rejected')
    if (result.outcome.status === 'rejected')
      expect(result.outcome.issues[0]?.message).toContain(
        'Handover packages in this browser take about',
      )
  })

  test('a full browser storage keeps the package for download', async () => {
    const storage = memoryStorage()
    const setItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === HANDOVER_CATALOG_KEY)
        throw new DOMException('full', 'QuotaExceededError')
      setItem(key, value)
    }
    const { handed } = await handOver(storage)
    expect(handed.result.outcome.status).toBe('applied')
    expect(handed.package).not.toBeNull()
    expect(handed.storeError).toContain('storage is full')
  })

  test('a viewer session opens a package and refuses every model change on the server', async () => {
    const storage = memoryStorage()
    const { handed } = await handOver(storage)
    const viewer = createTestProject({
      storage,
      mode: 'viewer',
      startClosed: true,
    })
    const listed = viewer.client.listPackages()
    await viewer.manual.settle()
    expect((await listed).outcome.status).toBe('applied')
    const { meta } = viewer.client.store.getState()
    expect(meta.viewOnly).toBe(true)
    expect(meta.packages.map((pkg) => pkg.id)).toEqual([handed.package?.id])

    const opened = viewer.client.openPackage({
      packageId: handed.package?.id ?? '',
    })
    await viewer.manual.settle()
    expect((await opened).outcome.status).toBe('applied')
    const after = viewer.client.store.getState().meta
    expect(after.handover?.name).toBe('Synthetic district (demo)')
    expect(after.currentProject?.name).toBe('Synthetic district (demo)')
    const before = JSON.stringify(viewer.server.current().state)

    // Every server command, sent straight to the server as a buggy UI might.
    for (const type of SERVER_COMMANDS) {
      const reply = viewer.server.handle({
        type: 'command',
        command: { type, input: {} } as never,
        source: 'manual',
      })
      expect(reply).toMatchObject({
        ok: false,
        status: 403,
        body: { code: 'view_only' },
      })
    }
    // And through the client, with valid input.
    const state = viewer.workbench.getState()
    const scenarioId = Object.keys(state.scenarios)[0] ?? ''
    const adopt = viewer.client.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId, adoptionPercent: 10 },
    })
    const run = viewer.client.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.baseline },
    })
    await viewer.manual.settle()
    for (const result of [await adopt, await run]) {
      expect(result.outcome).toMatchObject({
        status: 'rejected',
        issues: [{ message: VIEW_ONLY_MESSAGE }],
      })
    }
    expect(JSON.stringify(viewer.server.current().state)).toBe(before)
    expect(viewer.client.store.getState().meta.dirty).toBe(false)

    // Saving, creating, and handing over are refused too.
    for (const request of [
      viewer.client.save(),
      viewer.client.createProject('Other'),
      viewer.client.handOver().then((handedOver) => handedOver.result),
    ]) {
      await viewer.manual.settle()
      expect((await request).outcome.status).toBe('rejected')
    }

    // Local commands still work.
    const buildingId = state.buildingIds[0] ?? ''
    const selected = viewer.client.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: [buildingId] },
    })
    expect((await selected).outcome.status).toBe('applied')

    // Closing returns to the catalog.
    const closed = viewer.client.closeProject()
    await viewer.manual.settle()
    expect((await closed).outcome.status).toBe('applied')
    expect(viewer.client.store.getState().meta.handover).toBeNull()
    expect(viewer.client.store.getState().meta.currentProject).toBeNull()
  })

  test('the viewer opens files, refuses invalid ones on their field, and removes packages', async () => {
    const storage = memoryStorage()
    const { handed } = await handOver(storage)
    const viewer = createTestProject({
      storage,
      mode: 'viewer',
      startClosed: true,
    })
    const bad = viewer.client.openPackage({
      file: { name: 'notes.json', text: '{"format":"other"}' },
    })
    await viewer.manual.settle()
    expect((await bad).outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'file' }],
    })
    const good = viewer.client.openPackage({
      file: { name: 'complete.json', text: JSON.stringify(handed.package) },
    })
    await viewer.manual.settle()
    expect((await good).outcome.status).toBe('applied')
    expect(viewer.client.store.getState().meta.handover).toMatchObject({
      from: 'file',
      fileName: 'complete.json',
    })
    const close = viewer.client.closeProject()
    await viewer.manual.settle()
    await close
    const removed = viewer.client.removePackage(handed.package?.id ?? '')
    await viewer.manual.settle()
    expect((await removed).outcome.status).toBe('applied')
    expect(viewer.client.store.getState().meta.packages).toEqual([])
    expect(readHandoverCatalog(storage).catalog.packages).toEqual([])
  })

  test('an unreadable catalog is reported and left unchanged', async () => {
    const storage = memoryStorage()
    storage.setItem(HANDOVER_CATALOG_KEY, 'not json')
    const viewer = createTestProject({
      storage,
      mode: 'viewer',
      startClosed: true,
    })
    const listed = viewer.client.listPackages()
    await viewer.manual.settle()
    expect((await listed).outcome.status).toBe('rejected')
    expect(viewer.client.store.getState().meta.packagesError).toContain(
      'could not be read',
    )
    expect(storage.getItem(HANDOVER_CATALOG_KEY)).toBe('not json')
  })
})
