import { z } from 'zod'
import {
  commandDefinitions,
  describeCommands,
  type Command,
  type ValidationIssue,
} from '../../domain/commands.ts'
import type { Workbench } from '../../domain/workbench.ts'
import {
  PAGES,
  type DockSide,
  type LayoutController,
  type PageId,
} from '../layout/layoutController.ts'
import {
  describeViewOperations,
  type ViewOperation,
} from '../view/viewOperations.ts'
import type { ProjectClient } from '../service/projectClient.ts'
import type {
  ProjectIntent,
  ProjectLifecycle,
} from '../service/projectLifecycle.ts'
import type { ViewStore } from '../view/viewStore.ts'
import type { LayoutLibrary } from '../layouts/layoutLibrary.ts'
import { SCOPE_LABELS, type LayoutScope } from '../layouts/savedLayout.ts'

// Agent tool calls go through the same paths as manual controls: project
// commands through the project client (the server, decision 0023), view
// operations through the view store, and layout operations through the layout
// controller, always with source "agent".

export type LayoutToolOperation =
  | {
      type: 'layout.placePage'
      input: { page: PageId; beside: PageId; side: DockSide }
    }
  | { type: 'layout.openPage'; input: { page: PageId } }
  | { type: 'layout.reset'; input: Record<string, never> }

/** Saved layouts (decision 0032), through the same service as the menus. */
export type LayoutsToolOperation =
  | { type: 'layouts.list'; input: Record<string, never> }
  | { type: 'layouts.save'; input: { name: string; scope: LayoutScope } }
  | { type: 'layouts.apply'; input: { scope: LayoutScope; layoutId: string } }
  | {
      type: 'layouts.update'
      input: { scope: LayoutScope; layoutId: string }
    }
  | {
      type: 'layouts.rename'
      input: { scope: LayoutScope; layoutId: string; name: string }
    }
  | {
      type: 'layouts.duplicate'
      input: { scope: LayoutScope; layoutId: string; toScope?: LayoutScope }
    }
  | {
      type: 'layouts.delete'
      input: { scope: LayoutScope; layoutId: string }
    }
  | { type: 'layouts.setDefault'; input: { layoutId: string | null } }
  | { type: 'layouts.reset'; input: Record<string, never> }

export type ToolCall =
  | { kind: 'project'; intent: ProjectIntent }
  | { kind: 'command'; command: Command }
  | { kind: 'view'; operation: ViewOperation }
  | { kind: 'layout'; operation: LayoutToolOperation }
  | { kind: 'layouts'; operation: LayoutsToolOperation }

export type ToolResult = {
  status: 'applied' | 'rejected'
  summary: string | null
  issues: ValidationIssue[]
  /** Operation log entries the call recorded, for linking from the transcript. */
  operationIds: string[]
  data?: unknown
}

export type ToolDeps = {
  workbench: Workbench
  client: ProjectClient
  lifecycle?: ProjectLifecycle
  view: ViewStore
  layout: LayoutController
  /** Saved layouts; absent in tests that do not use them. */
  layouts?: LayoutLibrary
}

export function command(value: Command): ToolCall {
  return { kind: 'command', command: value }
}

export function viewCall(operation: ViewOperation): ToolCall {
  return { kind: 'view', operation }
}

export function layoutCall(operation: LayoutToolOperation): ToolCall {
  return { kind: 'layout', operation }
}

export function layoutsCall(operation: LayoutsToolOperation): ToolCall {
  return { kind: 'layouts', operation }
}

export function toolTypeOf(call: ToolCall): string {
  if (call.kind === 'project') return `project.${call.intent.type}`
  return call.kind === 'command' ? call.command.type : call.operation.type
}

export function toolInputOf(call: ToolCall): unknown {
  if (call.kind === 'project') return call.intent
  return call.kind === 'command' ? call.command.input : call.operation.input
}

/**
 * Commands that start or stop jobs, or change the working baseline without
 * being undoable; they wait for approval like model changes.
 */
const JOB_COMMANDS: ReadonlySet<string> = new Set([
  'workflow.runStage',
  'job.retry',
  'task.cancel',
  'intake.applyDataset',
  'calibration.fit',
  'calibration.adopt',
  'calibration.revert',
])

/** Task commands the job runner owns; the agent cannot call them. */
function isRunnerCommand(type: string): boolean {
  return type.startsWith('task.') && type !== 'task.cancel'
}

/** Tool calls that run, retry, or cancel jobs or change the project model wait for approval. */
export function requiresApproval(call: ToolCall): boolean {
  if (call.kind === 'project') return call.intent.type !== 'list'
  // Deleting a saved layout cannot be undone.
  if (call.kind === 'layouts') return call.operation.type === 'layouts.delete'
  if (call.kind !== 'command') return false
  return (
    JOB_COMMANDS.has(call.command.type) ||
    commandDefinitions[call.command.type].undoable
  )
}

/** Runs a tool call; project commands wait for the server's reply. */
export async function executeToolCall(
  deps: ToolDeps,
  call: ToolCall,
): Promise<ToolResult> {
  const log = () => deps.workbench.store.getState().log
  const before = log().length

  if (call.kind === 'project' || call.kind === 'command') {
    if (call.kind === 'project' && !deps.lifecycle)
      return {
        status: 'rejected',
        summary: null,
        issues: [
          {
            path: '',
            message: 'Project lifecycle tools are unavailable in this session.',
          },
        ],
        operationIds: [],
      }
    const result =
      call.kind === 'command'
        ? await deps.client.execute(call.command, 'agent')
        : await deps.lifecycle!.request(call.intent, 'agent')
    return {
      status: result.outcome.status,
      summary:
        result.outcome.status === 'applied' ? result.outcome.summary : null,
      issues: result.outcome.status === 'rejected' ? result.outcome.issues : [],
      operationIds: result.operationId ? [result.operationId] : [],
      ...(call.kind === 'project' && call.intent.type === 'list'
        ? { data: { projects: deps.client.store.getState().meta.projects } }
        : {}),
    }
  }

  if (call.kind === 'layouts') return runLayoutsTool(deps, call.operation)

  switch (call.kind) {
    case 'view':
      deps.view.execute(call.operation, 'agent')
      break
    case 'layout': {
      const { operation } = call
      switch (operation.type) {
        case 'layout.placePage':
          deps.layout.placePage(
            operation.input.page,
            operation.input.beside,
            operation.input.side,
            'agent',
          )
          break
        case 'layout.openPage':
          deps.layout.openPage(operation.input.page, 'agent')
          break
        case 'layout.reset':
          deps.layout.reset('agent')
          break
      }
      break
    }
  }

  const entries = log()
    .slice(before)
    .filter((entry) => entry.source === 'agent')
  const last = entries.at(-1)
  if (!last) {
    return {
      status: 'rejected',
      summary: null,
      issues: [{ path: '', message: 'The tool call recorded no operation.' }],
      operationIds: [],
    }
  }
  return {
    status: last.status,
    summary: last.summary,
    issues: last.issues,
    operationIds: entries.map((entry) => entry.id),
  }
}

/** Runs a saved-layout tool through the layouts service, with source "agent". */
function runLayoutsTool(
  deps: ToolDeps,
  operation: LayoutsToolOperation,
): ToolResult {
  const library = deps.layouts
  if (!library) {
    return {
      status: 'rejected',
      summary: null,
      issues: [
        { path: '', message: 'Saved layouts are unavailable in this session.' },
      ],
      operationIds: [],
    }
  }
  if (operation.type === 'layouts.list') {
    const { project, personal, defaultId, applied } = library.store.getState()
    const describe = (scope: LayoutScope) =>
      (scope === 'project' ? project : personal).layouts.map((layout) => ({
        layoutId: layout.id,
        name: layout.name,
        scope,
        updatedAt: layout.updatedAt,
        isDefault: scope === 'project' && layout.id === defaultId,
        isApplied: applied?.ref.scope === scope && applied.ref.id === layout.id,
      }))
    const layouts = [...describe('project'), ...describe('personal')]
    return {
      status: 'applied',
      summary: `Found ${project.layouts.length} ${SCOPE_LABELS.project.toLowerCase()} and ${personal.layouts.length} ${SCOPE_LABELS.personal.toLowerCase()} layout(s).`,
      issues: [],
      operationIds: [],
      data: { layouts },
    }
  }
  const outcome = (() => {
    switch (operation.type) {
      case 'layouts.save':
        return library.save(operation.input, 'agent')
      case 'layouts.apply':
        return library.apply(refOf(operation.input), 'agent')
      case 'layouts.update':
        return library.update(refOf(operation.input), 'agent')
      case 'layouts.rename':
        return library.rename(
          refOf(operation.input),
          operation.input.name,
          'agent',
        )
      case 'layouts.duplicate':
        return library.duplicate(
          refOf(operation.input),
          'agent',
          operation.input.toScope,
        )
      case 'layouts.delete':
        return library.remove(refOf(operation.input), 'agent')
      case 'layouts.setDefault':
        return library.setDefault(operation.input.layoutId, 'agent')
      case 'layouts.reset':
        return library.resetToApplied('agent')
    }
  })()
  return {
    status: outcome.status,
    summary: outcome.status === 'applied' ? outcome.summary : null,
    issues: outcome.status === 'rejected' ? outcome.issues : [],
    operationIds: [outcome.operationId],
  }
}

function refOf(input: { scope: LayoutScope; layoutId: string }) {
  return { scope: input.scope, id: input.layoutId }
}

const PAGE_IDS = Object.keys(PAGES) as [PageId, ...PageId[]]

const LAYOUT_TOOLS = [
  {
    name: 'layout.placePage',
    title: 'Place page beside another',
    description:
      'Put a page in a new tab group beside another page; both stay visible.',
    input: z.object({
      page: z.enum(PAGE_IDS),
      beside: z.enum(PAGE_IDS),
      side: z.enum(['left', 'right', 'top', 'bottom']),
    }),
  },
  {
    name: 'layout.openPage',
    title: 'Open page',
    description: 'Open or select a page.',
    input: z.object({ page: z.enum(PAGE_IDS) }),
  },
  {
    name: 'layout.reset',
    title: 'Reset layout',
    description: 'Restore the default workbench layout.',
    input: z.object({}),
  },
]

const scope = z.enum(['project', 'personal'])
const layoutRef = { scope, layoutId: z.string().min(1) }

const LAYOUTS_TOOLS = [
  {
    name: 'layouts.list',
    title: 'List saved layouts',
    description:
      'List the project layouts (saved with the project) and personal layouts (kept in this browser for every project), with which one the project opens with and which was applied last.',
    input: z.object({}),
  },
  {
    name: 'layouts.save',
    title: 'Save layout',
    description:
      'Save the current panel arrangement and view settings (table arrangements, map layers and 3D, terrain, and lighting settings, the Table, Jobs, Dashboard, and Results choices) as a new named layout. Scope "project" saves it with the project once the project is saved; "personal" keeps it in this browser.',
    input: z.object({ name: z.string().min(1).max(60), scope }),
  },
  {
    name: 'layouts.apply',
    title: 'Apply layout',
    description:
      'Apply a saved layout: its panel arrangement and its view settings. Tabs or results this project lacks are left out and reported.',
    input: z.object(layoutRef),
  },
  {
    name: 'layouts.update',
    title: 'Update layout',
    description:
      'Replace a saved layout with the current panel arrangement and view settings.',
    input: z.object(layoutRef),
  },
  {
    name: 'layouts.rename',
    title: 'Rename layout',
    description: 'Rename a saved layout; names are unique within a scope.',
    input: z.object({ ...layoutRef, name: z.string().min(1).max(60) }),
  },
  {
    name: 'layouts.duplicate',
    title: 'Duplicate layout',
    description:
      'Copy a saved layout, in the same scope or into the other one (toScope), for example a project layout into the personal layouts.',
    input: z.object({ ...layoutRef, toScope: scope.optional() }),
  },
  {
    name: 'layouts.delete',
    title: 'Delete layout',
    description: 'Delete a saved layout. This cannot be undone.',
    input: z.object(layoutRef),
  },
  {
    name: 'layouts.setDefault',
    title: 'Set default layout',
    description:
      'Choose the project layout the project opens with, or null for none. Saved with the project.',
    input: z.object({ layoutId: z.string().min(1).nullable() }),
  },
  {
    name: 'layouts.reset',
    title: 'Reset to layout',
    description:
      'Return the panels and view settings to the layout applied last, as it is saved now.',
    input: z.object({}),
  },
]

export type AgentToolDescription = {
  name: string
  kind: ToolCall['kind']
  title: string
  description: string
  requiresApproval: boolean
  inputSchema: unknown
}

/**
 * Tool catalog with JSON Schema inputs for a future model provider. Task
 * commands are internal to the job runner and are not offered as tools,
 * except Cancel job, which people use too.
 */
export function describeAgentTools(): AgentToolDescription[] {
  return [
    ...[
      { type: 'list', title: 'List saved projects', input: z.object({}) },
      {
        type: 'create',
        title: 'Create project',
        input: z.object({ name: z.string().min(1).max(100) }),
      },
      {
        type: 'open',
        title: 'Open saved project',
        input: z.object({ projectId: z.string().min(1) }),
      },
      { type: 'save', title: 'Save project', input: z.object({}) },
      { type: 'close', title: 'Close project', input: z.object({}) },
    ].map((tool) => ({
      name: `project.${tool.type}`,
      kind: 'project' as const,
      title: tool.title,
      description: `${tool.title} through the shared lifecycle operations and unsaved-work/job guard. Storage is mocked in this browser.`,
      requiresApproval: tool.type !== 'list',
      inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    })),
    ...describeCommands()
      .filter((description) => !isRunnerCommand(description.type))
      .map((description) => ({
        name: description.type,
        kind: 'command' as const,
        title: description.title,
        description: description.description,
        requiresApproval:
          JOB_COMMANDS.has(description.type) || description.undoable,
        inputSchema: description.inputSchema,
      })),
    ...describeViewOperations().map((description) => ({
      name: description.type,
      kind: 'view' as const,
      title: description.title,
      description: description.description,
      requiresApproval: false,
      inputSchema: description.inputSchema,
    })),
    ...LAYOUT_TOOLS.map((tool) => ({
      name: tool.name,
      kind: 'layout' as const,
      title: tool.title,
      description: tool.description,
      requiresApproval: false,
      inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    })),
    ...LAYOUTS_TOOLS.map((tool) => ({
      name: tool.name,
      kind: 'layouts' as const,
      title: tool.title,
      description: tool.description,
      requiresApproval: tool.name === 'layouts.delete',
      inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    })),
  ]
}
