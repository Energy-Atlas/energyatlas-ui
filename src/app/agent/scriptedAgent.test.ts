import { describe, expect, it } from 'vitest'
import { createTestProject } from '../../testing/testProject.ts'
import { DEFAULT_CONDITIONS } from '../../server/conditions.ts'
import { createLayoutController } from '../layout/layoutController.ts'
import { createViewStore } from '../view/viewStore.ts'
import { createScriptedAgent } from './scriptedAgent.ts'
import { matchSession } from './sessions.ts'
import { command, describeAgentTools, requiresApproval } from './tools.ts'
import type { TranscriptItem } from './types.ts'

function setup() {
  const { workbench, client, manual } = createTestProject()
  const layout = createLayoutController(workbench, null)
  const view = createViewStore(workbench)
  const agent = createScriptedAgent({
    workbench,
    client,
    layout,
    view,
    scheduler: manual.scheduler,
  })
  const transcript = () => agent.store.getState().transcript
  const lastApproval = () => {
    const item = [...transcript()]
      .reverse()
      .find(
        (entry): entry is Extract<TranscriptItem, { kind: 'approval' }> =>
          entry.kind === 'approval',
      )
    if (!item) throw new Error('No approval item in the transcript.')
    return item
  }
  const agentEntries = () =>
    workbench.store.getState().log.filter((entry) => entry.source === 'agent')
  return {
    workbench,
    client,
    manual,
    agent,
    transcript,
    lastApproval,
    agentEntries,
  }
}

describe('scripted agent', () => {
  it('clears queued delivery even in the idle gap when a project changes', async () => {
    const { agent, manual, transcript } = setup()
    agent.startPreset('restore')
    const prompt =
      agent.store
        .getState()
        .presets.find((preset) => preset.id === 'modelChange')?.prompt ?? ''
    agent.send(prompt, 'queue')
    for (let step = 0; step < 100; step += 1) {
      manual.runNext()
      await manual.flush()
      if (agent.store.getState().status === 'idle' && manual.pending() > 0)
        break
    }
    expect(manual.pending()).toBeGreaterThan(0)
    agent.resetForProject()
    await manual.settle()
    expect(agent.store.getState().status).toBe('idle')
    expect(agent.store.getState().ranSessionIds).toEqual([])
    expect(transcript()).toEqual([])
  })
  it('ignores a stopped session reply while a new session runs', async () => {
    const { client, manual, agent, agentEntries, transcript } = setup()
    client.setConditions({ ...DEFAULT_CONDITIONS, latency: 'none', hold: true })
    agent.setPermissionMode('bypass')
    agent.startPreset('modelChange')
    await manual.settle(50)
    expect(client.store.getState().pending[0]?.type).toBe('measure.create')
    agent.stop()
    agent.startPreset('restore')
    client.setConditions({
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      fault: 'everyRequest',
    })
    await manual.settle(100)
    expect(agentEntries().map((entry) => entry.type)).toContain('layout.reset')
    expect(
      transcript()
        .filter((item) => item.kind === 'tool')
        .some((item) => item.title === 'Create measure'),
    ).toBe(false)
    expect(agent.store.getState().status).toBe('idle')
  })

  it('answers free text without a matching script honestly', () => {
    const { agent, transcript, agentEntries } = setup()
    agent.send('What is the weather tomorrow?')
    expect(transcript().map((item) => item.kind)).toEqual(['user', 'agent'])
    expect(JSON.stringify(transcript()[1])).toContain(
      'I can only run the prepared sessions',
    )
    expect(agent.store.getState().status).toBe('idle')
    expect(agentEntries()).toEqual([])
  })

  it('matches free text to sessions by whole words', () => {
    expect(matchSession('Please reset the layout')?.id).toBe('restore')
    expect(matchSession('Show me a chart of demand')?.id).toBe('representation')
    expect(matchSession('Put the map beside the table')?.id).toBe('layout')
    expect(matchSession('Pick a preset')).toBeNull()
  })

  it('proposes missing stages, runs them after approval, and arranges the workbench', async () => {
    const { workbench, manual, agent, lastApproval, agentEntries, transcript } =
      setup()
    agent.startPreset('layout')
    await manual.settle(50)
    expect(agent.store.getState().status).toBe('awaitingApproval')
    const approval = lastApproval()
    expect(approval.title).toBe('Run 2 missing stages')
    expect(agentEntries()).toEqual([])

    agent.approve(approval.id)
    await manual.settle(5000)
    expect(agent.store.getState().status).toBe('idle')
    expect(
      agentEntries().map((entry) => `${entry.type}:${entry.status}`),
    ).toEqual([
      'workflow.runStage:applied',
      'workflow.runStage:applied',
      'layout.placePage:applied',
      'table.setView:applied',
      'selection.set:applied',
      'map.setMetric:applied',
      'map.focusSelection:applied',
    ])
    expect(workbench.getState().selection.ids).toHaveLength(5)
    const tools = transcript().filter((item) => item.kind === 'tool')
    expect(tools).toHaveLength(7)
    for (const item of tools) {
      if (item.kind !== 'tool') continue
      expect(item.result.status).toBe('applied')
      expect(item.result.operationIds.length).toBeGreaterThan(0)
    }
  })

  it('records a rejected proposal and changes nothing when the user rejects it', async () => {
    const { workbench, manual, agent, lastApproval, agentEntries } = setup()
    agent.startPreset('modelChange')
    await manual.settle(50)
    const approval = lastApproval()
    expect(approval.title).toBe('Create a measure and a scenario')

    agent.decline(approval.id)
    expect(agent.store.getState().status).toBe('idle')
    expect(lastApproval().status).toBe('declined')
    expect(workbench.getState().measures).toEqual({})
    expect(agentEntries()).toEqual([])
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      type: 'agent.proposal',
      status: 'rejected',
    })
  })

  it('applies an approved model change as the agent, then reruns stages with a second approval', async () => {
    const { workbench, manual, agent, lastApproval, agentEntries, transcript } =
      setup()
    agent.startPreset('modelChange')
    await manual.settle(50)
    agent.approve(lastApproval().id)
    await manual.settle(200)
    expect(
      agentEntries().map((entry) => `${entry.type}:${entry.status}`),
    ).toEqual(['measure.create:applied', 'scenario.create:applied'])
    expect(Object.values(workbench.getState().scenarios)).toHaveLength(1)

    const rerun = lastApproval()
    expect(rerun.title).toBe('Run 9 outdated or missing stages')
    agent.approve(rerun.id)
    await manual.settle(20000)
    expect(agent.store.getState().status).toBe('idle')
    const last = transcript().at(-2)
    expect(last?.kind).toBe('agent')
    expect(JSON.stringify(last)).toContain('reduces annual demand by')
  })

  it('fits the baseline as a job after approval, leaves it unadopted, and drills into results', async () => {
    const { workbench, manual, agent, lastApproval, agentEntries, transcript } =
      setup()
    agent.startPreset('calibration')
    await manual.settle(50)
    expect(lastApproval().title).toMatch(/^Run \d+ outdated or missing stages$/)
    agent.approve(lastApproval().id)
    await manual.settle(20000)
    expect(lastApproval().title).toBe('Fit the baseline to the 2025 meters')
    agent.approve(lastApproval().id)
    await manual.settle(2000)
    expect(agent.store.getState().status).toBe('idle')
    const state = workbench.getState()
    expect(state.calibration.variantIds).toHaveLength(1)
    expect(state.calibration.adoptedVariantId).toBeNull()
    expect(
      agentEntries()
        .map((entry) => entry.type)
        .filter((type) => type !== 'workflow.runStage'),
    ).toEqual([
      'calibration.fit',
      'layout.openPage',
      'results.select',
      'results.showBuilding',
      'results.setResolution',
    ])
    expect(JSON.stringify(transcript())).toContain('I did not adopt it')
  })

  it('stops a session and leaves applied changes in place', async () => {
    const { manual, agent, lastApproval, transcript } = setup()
    agent.startPreset('layout')
    await manual.settle(50)
    agent.stop()
    expect(agent.store.getState().status).toBe('idle')
    expect(lastApproval().status).toBe('declined')
    expect(JSON.stringify(transcript().at(-1))).toContain('Session stopped')
  })
})

// Permission modes act on the approval gate; send modes decide when a typed
// message reaches the agent (decision 0016).
describe('agent permission modes', () => {
  it('runs stages without asking in Automatic mode', async () => {
    const { manual, agent, lastApproval, agentEntries } = setup()
    agent.setPermissionMode('automatic')
    agent.startPreset('layout')
    await manual.settle(20000)
    expect(agent.store.getState().status).toBe('idle')
    expect(lastApproval()).toMatchObject({
      status: 'approved',
      decidedBy: 'automatic',
    })
    expect(agentEntries().map((entry) => entry.type)).toContain(
      'workflow.runStage',
    )
  })

  it('still asks for a project model change in Automatic mode', async () => {
    const { manual, agent, lastApproval } = setup()
    agent.setPermissionMode('automatic')
    agent.startPreset('modelChange')
    await manual.settle(50)
    expect(agent.store.getState().status).toBe('awaitingApproval')
    expect(lastApproval().decidedBy).toBeNull()
  })

  it('applies a model change without asking in Bypass approval mode', async () => {
    const { workbench, manual, agent, lastApproval } = setup()
    agent.setPermissionMode('bypass')
    agent.startPreset('modelChange')
    await manual.settle(200)
    expect(lastApproval().decidedBy).toBe('bypass')
    expect(Object.values(workbench.getState().scenarios)).toHaveLength(1)
  })

  it('lists what it would do and changes nothing in Plan mode', async () => {
    const { workbench, manual, agent, transcript } = setup()
    agent.setPermissionMode('plan')
    agent.startPreset('modelChange')
    await manual.settle(200)
    expect(agent.store.getState().status).toBe('idle')
    expect(workbench.getState().measures).toEqual({})
    expect(transcript().some((item) => item.kind === 'approval')).toBe(false)
    expect(JSON.stringify(transcript())).toContain('Plan only')
  })
})

describe('agent send modes', () => {
  it('queues a message while a session runs and answers it afterwards', async () => {
    const { manual, agent, lastApproval, transcript } = setup()
    agent.startPreset('layout')
    await manual.settle(50)
    expect(agent.sendBlocker('send', 'reset the layout')).toContain(
      'waiting for your approval',
    )

    agent.send('reset the layout', 'queue')
    expect(agent.store.getState().queued).toEqual(['reset the layout'])
    agent.approve(lastApproval().id)
    await manual.settle(20000)
    expect(agent.store.getState().queued).toEqual([])
    expect(agent.store.getState().ranSessionIds).toEqual(['layout', 'restore'])
    expect(JSON.stringify(transcript())).toContain('default layout is back')
  })

  it('refuses to stir when no session is running', () => {
    const { agent, transcript } = setup()
    expect(agent.sendBlocker('stir', 'hello')).toContain('running session')
    agent.send('hello', 'stir')
    expect(agent.store.getState().queued).toEqual([])
    expect(transcript()).toEqual([])
  })

  it('records a stirred message and says a scripted session cannot change course', async () => {
    const { manual, agent, lastApproval, transcript } = setup()
    agent.startPreset('layout')
    await manual.settle(50)
    agent.send('reset the layout', 'stir')
    expect(JSON.stringify(transcript())).toContain('cannot change course')
    agent.approve(lastApproval().id)
    await manual.settle(20000)
    expect(agent.store.getState().ranSessionIds).toEqual(['layout', 'restore'])
  })

  it('discards queued messages when the session is stopped', async () => {
    const { manual, agent, transcript } = setup()
    agent.startPreset('layout')
    await manual.settle(50)
    agent.send('reset the layout', 'queue')
    agent.stop()
    expect(agent.store.getState().queued).toEqual([])
    expect(JSON.stringify(transcript().at(-1))).toContain('discarded')
  })
})

describe('agent tools', () => {
  it('requires approval for stage runs and project model changes only', () => {
    expect(
      requiresApproval(
        command({ type: 'workflow.runStage', input: { stageId: 'stage' } }),
      ),
    ).toBe(true)
    expect(
      requiresApproval(
        command({
          type: 'scenario.setAdoption',
          input: { scenarioId: 'scenario', adoptionPercent: 10 },
        }),
      ),
    ).toBe(true)
    expect(
      requiresApproval(command({ type: 'selection.clear', input: {} })),
    ).toBe(false)
  })

  it('describes command, view, and layout tools without simulator internals', () => {
    const tools = describeAgentTools()
    expect(
      tools.find((item) => item.name === 'layout.placePage'),
    ).toMatchObject({ kind: 'layout', requiresApproval: false })
    expect(
      tools.find((item) => item.name === 'dashboard.addChart'),
    ).toMatchObject({ kind: 'view', requiresApproval: false })
    expect(tools.find((item) => item.name === 'measure.create')).toMatchObject({
      kind: 'command',
      requiresApproval: true,
    })
    // Runner internals stay private; job retry and cancel are shared operations.
    expect(
      tools
        .filter((item) => item.name.startsWith('task.'))
        .map((item) => item.name),
    ).toEqual(['task.cancel'])
    for (const name of ['job.retry', 'task.cancel', 'workflow.runStage']) {
      expect(tools.find((item) => item.name === name)).toMatchObject({
        kind: 'command',
        requiresApproval: true,
      })
    }
    expect(tools.find((item) => item.name === 'jobs.select')).toMatchObject({
      kind: 'view',
      requiresApproval: false,
    })
  })
})
