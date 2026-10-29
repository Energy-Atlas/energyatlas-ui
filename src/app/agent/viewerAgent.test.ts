import { describe, expect, it, vi } from 'vitest'
import { createWorkbench } from '../../domain/workbench.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { VIEW_ONLY_MESSAGE } from '../../server/apiError.ts'
import { SERVER_COMMANDS } from '../../server/server.ts'
import { memoryStorage } from '../../testing/memoryStorage.ts'
import { createTestProject } from '../../testing/testProject.ts'
import {
  createLayoutController,
  prepareArrangement,
  VIEWER_LAYOUT,
  createDefaultLayout,
} from '../layout/layoutController.ts'
import { createLayoutLibrary } from '../layouts/layoutLibrary.ts'
import { createViewStore } from '../view/viewStore.ts'
import { createHandoverService } from '../handover/handoverService.ts'
import { readHandoverCatalog } from '../../server/handoverCatalog.ts'
import { createScriptedAgent } from './scriptedAgent.ts'
import {
  asksForModelChange,
  matchViewerSession,
  VIEW_ONLY_ANSWER,
  VIEWER_UNMATCHED_ANSWER,
} from './sessions.ts'
import {
  command,
  describeAgentTools,
  executeToolCall,
  isViewerToolCall,
  layoutCall,
  requiresApproval,
  viewCall,
} from './tools.ts'

// The viewer page (decision 0032, stage 5): its agent's tools, its sessions,
// its layout controller, and its read-only handed-over layouts.

function viewerSetup(fixture: 'new' | 'partway' = 'partway') {
  const project = createTestProject({ fixture })
  const layout = createLayoutController(project.workbench, null, {
    shape: VIEWER_LAYOUT,
  })
  const view = createViewStore(project.workbench)
  const agent = createScriptedAgent({
    workbench: project.workbench,
    client: project.client,
    layout,
    view,
    scheduler: project.manual.scheduler,
    viewOnly: true,
  })
  return { ...project, layout, view, agent }
}

describe("the viewer's agent tools", () => {
  it('leaves every server command, draft, lifecycle, and handover tool out', () => {
    const tools = describeAgentTools({ viewOnly: true })
    const names = new Set(tools.map((tool) => tool.name))
    for (const type of SERVER_COMMANDS) expect(names.has(type)).toBe(false)
    for (const name of [
      'edits.propose',
      'edits.discard',
      'project.save',
      'project.open',
      'project.handover',
      // Handed-over layouts are read-only (decision 0033).
      'layouts.save',
      'layouts.update',
      'layouts.rename',
      'layouts.duplicate',
      'layouts.delete',
      'layouts.setDefault',
      'intake.chooseDataset',
      'jobs.select',
      'archetypes.setPreviewPart',
    ])
      expect(names.has(name)).toBe(false)
    for (const name of [
      'selection.set',
      'map.setMetric',
      'table.setQuickFilter',
      'results.showBuilding',
      'layout.openPage',
      'layouts.list',
      'layouts.apply',
      'layouts.reset',
      'layouts.resetToHandover',
    ])
      expect(names.has(name)).toBe(true)
    expect(tools.every((tool) => tool.kind !== 'project')).toBe(true)
    // The page enum lists only the viewer's pages.
    const openPage = tools.find((tool) => tool.name === 'layout.openPage')
    expect(JSON.stringify(openPage?.inputSchema)).not.toContain('roadmap')
    // The modeller keeps Hand over, which waits for approval.
    const handover = describeAgentTools().find(
      (tool) => tool.name === 'project.handover',
    )
    expect(handover?.requiresApproval).toBe(true)
  })

  it('refuses a model change before it reaches the client', async () => {
    const { workbench, client, layout, view } = viewerSetup()
    const execute = vi.spyOn(client, 'execute')
    const call = command({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.baseline },
    })
    expect(isViewerToolCall(call)).toBe(false)
    const result = await executeToolCall(
      { workbench, client, layout, view, viewOnly: true },
      call,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      issues: [{ message: VIEW_ONLY_MESSAGE }],
    })
    expect(execute).not.toHaveBeenCalled()
    expect(
      isViewerToolCall(
        layoutCall({ type: 'layout.openPage', input: { page: 'roadmap' } }),
      ),
    ).toBe(false)
    expect(
      isViewerToolCall(
        viewCall({ type: 'map.setMetric', input: { metric: 'floors' } }),
      ),
    ).toBe(true)
  })

  it('answers a model change with view only and offers viewer sessions only', async () => {
    const { agent, manual } = viewerSetup()
    expect(agent.store.getState().presets.map((preset) => preset.id)).toEqual([
      'viewerResults',
      'layout',
      'viewerZones',
      'viewerRestore',
    ])
    agent.send('Please add a heat pump measure and rerun the scenarios')
    await manual.settle()
    const transcript = agent.store.getState().transcript
    expect(transcript.at(-1)).toMatchObject({
      kind: 'agent',
      markdown: VIEW_ONLY_ANSWER,
    })
    expect(agent.store.getState().status).toBe('idle')
  })

  it('tells view changes from model changes', async () => {
    for (const text of [
      'add a heat layer to the map',
      'set the season to winter',
      'remove that layer',
      'save my layout',
      'colour the buildings by floors',
    ])
      expect(asksForModelChange(text), text).toBe(false)
    for (const text of [
      'Rerun the baseline',
      'adopt the calibrated variant',
      'change the archetype of building 3',
      'delete the heat pump measure',
      'set adoption to 40%',
      'Reset the baseline results',
      'Remove the zones from building b-1',
    ])
      expect(asksForModelChange(text), text).toBe(true)
    const { agent, manual } = viewerSetup()
    agent.send('add a heat layer to the map')
    await manual.settle()
    expect(agent.store.getState().transcript.at(-1)).toMatchObject({
      kind: 'agent',
      markdown: VIEWER_UNMATCHED_ANSWER,
    })
  })

  it('refuses a model change that names a session subject instead of running the session', async () => {
    for (const text of [
      'Reset the baseline results',
      'Remove the zones from building b-1',
    ]) {
      const { agent, manual, workbench } = viewerSetup()
      const before = workbench.getState().selection
      agent.send(text)
      await manual.settle(200)
      const transcript = agent.store.getState().transcript
      expect(transcript.at(-1), text).toMatchObject({
        kind: 'agent',
        markdown: VIEW_ONLY_ANSWER,
      })
      expect(transcript.some((item) => item.kind === 'tool')).toBe(false)
      expect(workbench.getState().selection).toEqual(before)
    }
    // The handed-over reset still runs as a session.
    expect(matchViewerSession('Reset to the handed-over layout')?.id).toBe(
      'viewerRestore',
    )
  })

  it('says what a viewer can do with layouts now that they are kept with the project (decision 0033)', () => {
    for (const text of [VIEW_ONLY_ANSWER, VIEWER_UNMATCHED_ANSWER]) {
      expect(text).not.toMatch(/personal/i)
      expect(text).toContain('Layouts panel')
    }
  })

  it('shows floors and zones without approvals and refuses a zoning change (decision 0032, stage 6)', async () => {
    expect(asksForModelChange('set the zoning to perimeter and core')).toBe(
      true,
    )
    const { agent, manual, workbench } = viewerSetup()
    agent.startPreset('viewerZones')
    await manual.settle(200)
    const transcript = agent.store.getState().transcript
    expect(transcript.some((item) => item.kind === 'approval')).toBe(false)
    // A building zoned its own way shows more than one zone.
    expect(workbench.getState().selection).toEqual({
      entityType: 'building',
      ids: ['B0439'],
    })
    const text = JSON.stringify(transcript)
    expect(text).toContain(
      'zoned one zone per building when the project was handed over, except 3 buildings zoned their own way: B0426 (perimeter and core per floor), B0427 (each floor a zone), B0439 (drawn zones)',
    )
    expect(text).not.toMatch(/\b1 (zones|floors)\b/)
    const { agent: empty, manual: emptyManual } = viewerSetup('new')
    empty.startPreset('viewerZones')
    await emptyManual.settle(200)
    expect(JSON.stringify(empty.store.getState().transcript)).toContain(
      'This package has no zones to show',
    )
  })

  it('explains missing data instead of offering to run stages', async () => {
    const { agent, manual, workbench } = viewerSetup('new')
    const before = workbench.getState().taskIds.length
    agent.startPreset('layout')
    await manual.settle(200)
    const transcript = agent.store.getState().transcript
    expect(transcript.some((item) => item.kind === 'approval')).toBe(false)
    expect(transcript.at(-1)).toMatchObject({ kind: 'notice', tone: 'warning' })
    expect(JSON.stringify(transcript.at(-1))).toContain('cannot run stages')
    expect(workbench.getState().taskIds.length).toBe(before)
  })
})

describe('the modeller hand over tool', () => {
  it('hands over through the shared service after approval', async () => {
    const storage = memoryStorage()
    const { workbench, client, manual } = createTestProject({
      storage,
      fixture: 'complete',
    })
    const layout = createLayoutController(workbench, null)
    const view = createViewStore(workbench)
    const handover = createHandoverService({ client, workbench })
    // A handover packages the saved copy (decision 0032).
    const saved = client.save()
    await manual.settle()
    await saved
    const call = {
      kind: 'handover' as const,
      operation: { type: 'project.handover' as const, input: {} },
    }
    expect(requiresApproval(call)).toBe(true)
    expect(isViewerToolCall(call)).toBe(false)
    const running = executeToolCall(
      { workbench, client, layout, view, handover },
      call,
    )
    await manual.settle()
    const result = await running
    expect(result.status).toBe('applied')
    const { packageId } = result.data as { packageId: string }
    expect(
      readHandoverCatalog(storage).catalog.packages.map((pkg) => pkg.id),
    ).toEqual([packageId])
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'project.handover',
      source: 'agent',
    })
  })
})

describe("the viewer's layout", () => {
  it('shows only its pages and drops modeller tabs without a note', () => {
    const workbench = createWorkbench()
    const layout = createLayoutController(workbench, null, {
      shape: VIEWER_LAYOUT,
    })
    expect(layout.hasPage('roadmap')).toBe(false)
    expect(layout.hasPanel('workflow')).toBe(false)
    layout.openPage('roadmap')
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      status: 'rejected',
      type: 'layout.openPage',
    })
    const prepared = prepareArrangement(
      createDefaultLayout(),
      false,
      VIEWER_LAYOUT,
    )
    expect(prepared.ok && prepared.dropped).toEqual([])
    expect(JSON.stringify(prepared.ok && prepared.json)).not.toContain(
      'page.roadmap',
    )
    expect(
      prepareArrangement(
        {
          layout: {
            type: 'row',
            children: [
              {
                type: 'tabset',
                children: [
                  { type: 'tab', component: 'page.map', name: 'Map' },
                  { type: 'tab', component: 'page.future', name: 'Future' },
                ],
              },
            ],
          },
        },
        false,
        VIEWER_LAYOUT,
      ),
    ).toMatchObject({ ok: true, dropped: ['"Future"'] })
  })

  it('keeps handed-over layouts read-only, applies them, and resets to the handed-over views', () => {
    const workbench = createWorkbench()
    const layout = createLayoutController(workbench, null, {
      shape: VIEWER_LAYOUT,
    })
    const view = createViewStore(workbench)
    // The modeller saves a layout with the project before handing it over.
    const modeller = createLayoutLibrary({ workbench, layout, view })
    view.execute({ type: 'table.setQuickFilter', input: { text: 'office' } })
    const handed = modeller.save({ name: 'Handed over' })
    if (handed.status !== 'applied' || !handed.id) throw new Error('not saved')
    const packageView = { tables: {}, layouts: modeller.forSave().layouts }
    view.execute({ type: 'table.setQuickFilter', input: { text: '' } })

    const library = createLayoutLibrary({
      workbench,
      layout,
      view,
      writable: false,
    })
    library.resetForProject(packageView, 'a')
    expect(library.save({ name: 'Mine' })).toMatchObject({
      status: 'rejected',
      issues: [
        {
          message:
            'Handed-over layouts are read-only here; apply one to use it.',
        },
      ],
    })
    expect(
      library.store.getState().project.layouts.map((each) => each.name),
    ).toEqual(['Handed over'])

    expect(library.apply(handed.id)).toMatchObject({
      status: 'applied',
      summary: 'Applied the layout "Handed over".',
    })
    expect(view.getState().table.quickFilter).toBe('office')

    view.execute({ type: 'table.setQuickFilter', input: { text: 'b-1' } })
    layout.openPage('results')
    const reset = library.resetToHandedOver()
    expect(reset.status).toBe('applied')
    expect(view.getState().table.quickFilter).toBe('')
    expect(layout.isPageOpen('results')).toBe(false)
    expect(library.store.getState().applied).toBeNull()
    // The reset leaves the handed-over layouts as they were.
    expect(library.store.getState().project.layouts).toHaveLength(1)
  })
})
