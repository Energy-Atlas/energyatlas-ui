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
import { viewerLayoutsKey } from '../layouts/personalLayouts.ts'
import { createViewStore } from '../view/viewStore.ts'
import { createHandoverService } from '../handover/handoverService.ts'
import { readHandoverCatalog } from '../../server/handoverCatalog.ts'
import { createScriptedAgent } from './scriptedAgent.ts'
import { VIEW_ONLY_ANSWER } from './sessions.ts'
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
// its layout controller, and its personal layouts.

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
      'layouts.save',
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

  it('keeps personal layouts per package and resets to the handed-over views', () => {
    const storage = memoryStorage()
    const workbench = createWorkbench()
    const layout = createLayoutController(workbench, null, {
      shape: VIEWER_LAYOUT,
    })
    const view = createViewStore(workbench)
    const library = createLayoutLibrary({
      workbench,
      layout,
      view,
      storage,
      projectWritable: false,
      personalKey: viewerLayoutsKey('handover:a'),
    })
    library.resetForProject({ tables: {} }, 'a')
    expect(library.save({ name: 'Mine', scope: 'project' }).status).toBe(
      'rejected',
    )
    expect(library.save({ name: 'Mine', scope: 'personal' }).status).toBe(
      'applied',
    )
    expect(storage.getItem(viewerLayoutsKey('handover:a'))).toContain('Mine')
    expect(storage.getItem('eaui.layouts.v1')).toBeNull()

    library.setPersonalKey(viewerLayoutsKey('handover:b'))
    expect(library.store.getState().personal.layouts).toEqual([])
    library.setPersonalKey(viewerLayoutsKey('handover:a'))
    expect(
      library.store.getState().personal.layouts.map((each) => each.name),
    ).toEqual(['Mine'])

    view.execute({ type: 'table.setQuickFilter', input: { text: 'b-1' } })
    layout.openPage('results')
    const reset = library.resetToHandedOver()
    expect(reset.status).toBe('applied')
    expect(view.getState().table.quickFilter).toBe('')
    expect(layout.isPageOpen('results')).toBe(false)
    // Personal layouts are untouched by the reset.
    expect(library.store.getState().personal.layouts).toHaveLength(1)
  })
})
