import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createWorkbench } from '../../domain/workbench.ts'
import { OFFLINE_MESSAGE } from '../../server/transport.ts'
import type { AgentSnapshot, TranscriptItem } from '../agent/types.ts'
import {
  TOAST_LIMIT,
  createMessageCenter,
  inScope,
  worstTone,
  type Message,
} from './messageCenter.ts'

function latest(messages: Message[]): Message | undefined {
  return messages.at(-1)
}

function agentStore() {
  return createStore<AgentSnapshot>()(() => ({
    status: 'idle',
    transcript: [],
    activeSessionId: null,
    presets: [],
    permissionMode: 'ask',
    queued: [],
    ranSessionIds: [],
  }))
}

const approval = (
  status: 'pending' | 'approved' | 'declined',
): TranscriptItem => ({
  id: 'agent-item-7',
  kind: 'approval',
  title: 'Run Shading',
  description: 'Runs the shading stage.',
  callTitles: ['Run stage'],
  status,
  decidedBy: null,
})

describe('the message center (decision 0027)', () => {
  it('reports operations: applied ones quietly, failures as toasts', () => {
    const workbench = createWorkbench()
    const center = createMessageCenter({ workbench })
    const messages = () => center.store.getState().messages
    const projectId = workbench.getState().project.id

    workbench.record({
      type: 'project.save',
      title: 'Save project',
      summary: 'Saved the project.',
    })
    expect(latest(messages())).toMatchObject({
      tone: 'info',
      source: 'project',
      projectId,
      text: 'Saved the project.',
      toast: false,
      read: true,
    })

    // A failure with no field to show it beside is an event.
    workbench.record({
      type: 'project.save',
      title: 'Save project',
      status: 'rejected',
      summary: '',
      issues: [{ path: '', message: 'Disk full.' }],
    })
    expect(latest(messages())).toMatchObject({
      tone: 'danger',
      text: 'Disk full.',
      toast: true,
      read: false,
    })

    // Field errors on a person's own form stay beside the fields.
    workbench.record({
      type: 'measure.create',
      title: 'Create measure',
      status: 'rejected',
      summary: '',
      issues: [{ path: 'name', message: 'Enter a name.' }],
    })
    expect(latest(messages())).toMatchObject({ tone: 'warning', toast: false })

    // The agent has no form, so its rejected input pops up.
    workbench.record({
      type: 'measure.create',
      title: 'Create measure',
      source: 'agent',
      status: 'rejected',
      summary: '',
      issues: [{ path: 'name', message: 'Enter a name.' }],
    })
    expect(latest(messages())).toMatchObject({ actor: 'agent', toast: true })

    // Faults and reconnects belong to the server, outside any project.
    workbench.record({
      type: 'workflow.runStage',
      title: 'Run stage',
      status: 'rejected',
      summary: '',
      issues: [{ path: '', message: OFFLINE_MESSAGE }],
    })
    expect(latest(messages())).toMatchObject({
      source: 'server',
      projectId: null,
      toast: true,
    })
    workbench.record({
      type: 'service.resync',
      title: 'Catch up with the server',
      source: 'system',
      summary: 'Back online.',
    })
    expect(latest(messages())).toMatchObject({
      tone: 'success',
      source: 'server',
      toast: true,
    })

    // Layout and view changes are workspace messages; progress ticks are quiet.
    workbench.record({
      type: 'layout.openPage',
      title: 'Open page',
      summary: 'Opened the Map page.',
    })
    expect(latest(messages())?.source).toBe('workspace')
    const count = messages().length
    workbench.record({
      type: 'task.reportProgress',
      title: 'Report progress',
      summary: '40 %',
    })
    expect(messages()).toHaveLength(count)

    // At most three toasts, newest first; the rest stay in the history.
    expect(center.store.getState().toasts).toHaveLength(TOAST_LIMIT)
    expect(center.store.getState().toasts[0]).toBe(
      messages().findLast((message) => message.toast)?.id,
    )
    center.dispose()
  })

  it('reports what was logged before it started', () => {
    const workbench = createWorkbench()
    workbench.record({
      type: 'project.replace',
      title: 'Load fixture',
      source: 'system',
      summary: 'Loaded the "complete" fixture.',
    })
    const center = createMessageCenter({ workbench })
    expect(latest(center.store.getState().messages)?.text).toBe(
      'Loaded the "complete" fixture.',
    )
    center.dispose()
  })

  it('pops up an agent approval and settles it once answered', () => {
    const workbench = createWorkbench()
    const agent = agentStore()
    const center = createMessageCenter({ workbench, agent })
    agent.setState({ transcript: [approval('pending')] })
    const posted = latest(center.store.getState().messages)
    expect(posted).toMatchObject({
      tone: 'warning',
      source: 'agent',
      text: 'The agent is waiting for your approval: Run Shading.',
      actions: [
        { kind: 'openPanel', label: 'Open Reasoning', panel: 'reasoning' },
      ],
      toast: true,
    })
    expect(center.store.getState().toasts).toContain(posted?.id)

    agent.setState({ transcript: [approval('approved')] })
    expect(center.store.getState().toasts).not.toContain(posted?.id)
    expect(latest(center.store.getState().messages)).toMatchObject({
      id: posted?.id,
      resolved: true,
      read: true,
    })
    // Answering does not post it again.
    expect(center.store.getState().messages).toHaveLength(1)

    agent.setState({
      transcript: [
        approval('approved'),
        { id: 'agent-item-8', kind: 'notice', tone: 'error', text: 'Stopped.' },
      ],
    })
    expect(latest(center.store.getState().messages)).toMatchObject({
      tone: 'danger',
      text: 'Stopped.',
      toast: true,
    })
    center.dispose()
  })

  it('marks read, clears, and scopes messages to a project and the server', () => {
    const workbench = createWorkbench()
    const center = createMessageCenter({ workbench })
    const projectId = workbench.getState().project.id
    const own = center.post({
      tone: 'danger',
      source: 'project',
      projectId,
      text: 'Failed here.',
      toast: true,
    })
    const other = center.post({
      tone: 'warning',
      source: 'job',
      projectId: 'project:other',
      text: 'Elsewhere.',
      toast: true,
    })
    const server = center.post({
      tone: 'success',
      source: 'server',
      projectId: null,
      text: 'Back online.',
      toast: true,
    })
    expect(inScope(own, projectId)).toBe(true)
    expect(inScope(server, projectId)).toBe(true)
    expect(inScope(other, projectId)).toBe(false)
    expect(worstTone([own, other, server])).toBe('danger')
    expect(worstTone([])).toBeNull()

    center.markRead({ projectId })
    const byId = (id: string) =>
      center.store.getState().messages.find((message) => message.id === id)
    expect(byId(own.id)?.read).toBe(true)
    expect(byId(server.id)?.read).toBe(true)
    expect(byId(other.id)?.read).toBe(false)

    center.dismissToast(other.id, { read: false })
    expect(center.store.getState().toasts).not.toContain(other.id)
    expect(byId(other.id)?.read).toBe(false)

    center.clear(projectId)
    expect(
      center.store.getState().messages.map((message) => message.id),
    ).toEqual([other.id])
    center.dispose()
  })
})
