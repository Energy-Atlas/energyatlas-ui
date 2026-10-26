import type { StoreApi } from 'zustand/vanilla'
import type { PageId } from '../layout/layoutController.ts'
import type { ToolCall, ToolResult } from './tools.ts'

// The agent adapter is the seam between the Reasoning panel and whatever
// produces agent behavior. The first slice uses a scripted player (decision
// 0006); a real model provider can implement the same adapter later.

export type ReferenceTarget =
  | { type: 'page'; page: PageId }
  | { type: 'stage'; stageId: string }
  | { type: 'inspection' }

export type TranscriptItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'agent'; markdown: string }
  | { id: string; kind: 'reasoning'; text: string }
  | { id: string; kind: 'reference'; label: string; target: ReferenceTarget }
  | {
      id: string
      kind: 'tool'
      title: string
      call: ToolCall
      result: ToolResult
    }
  | {
      id: string
      kind: 'approval'
      title: string
      description: string
      callTitles: string[]
      status: 'pending' | 'approved' | 'declined'
      /** Set when a permission mode answered the approval instead of the user. */
      decidedBy: PermissionMode | null
    }
  | {
      id: string
      kind: 'notice'
      tone: 'info' | 'warning' | 'error'
      text: string
    }

export type AgentStatus = 'idle' | 'running' | 'awaitingApproval'

/** How a typed message reaches the agent (decision 0016). */
export type SendMode = 'send' | 'queue' | 'stir'

/**
 * How much the agent may do without asking (decision 0016). The modes act on
 * the approval gate that already guards stage runs and model changes.
 */
export type PermissionMode = 'ask' | 'automatic' | 'bypass' | 'plan'

export type AgentPreset = {
  id: string
  label: string
  prompt: string
  description: string
}

export type AgentSnapshot = {
  status: AgentStatus
  transcript: TranscriptItem[]
  activeSessionId: string | null
  presets: AgentPreset[]
  permissionMode: PermissionMode
  /** Messages waiting for the agent to become idle, oldest first. */
  queued: string[]
  /** Sessions started in this conversation, oldest first. */
  ranSessionIds: string[]
}

export type AgentAdapter = {
  label: string
  store: StoreApi<AgentSnapshot>
  /**
   * Sends a free-text message. "send" needs an idle agent, "queue" waits for
   * one, and "stir" reaches a running session.
   */
  send: (text: string, mode?: SendMode) => void
  /** Why this send mode cannot be used right now, or null. */
  sendBlocker: (mode: SendMode, text: string) => string | null
  startPreset: (presetId: string) => void
  setPermissionMode: (mode: PermissionMode) => void
  /** Drops a queued message that has not been delivered yet. */
  dropQueued: (index: number) => void
  approve: (itemId: string) => void
  decline: (itemId: string) => void
  /** Stops the active session; applied changes stay in the project. */
  stop: () => void
  /** Clears transcript, queued delivery, and callbacks for a replaced project. */
  resetForProject: () => void
}
