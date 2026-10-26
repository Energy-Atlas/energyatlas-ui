import { useClientSnapshot } from '../WorkbenchContext.tsx'
import type { PendingRequest } from './projectClient.ts'

/**
 * Why a control must wait for its own earlier request, or null: a request of
 * this type is still in flight, and `matches` (when given) accepts its input.
 */
export function waitingReason(
  pending: PendingRequest[],
  type: string,
  what: string,
  matches?: (input: unknown) => boolean,
): string | null {
  return pending.some(
    (request) => request.type === type && (!matches || matches(request.input)),
  )
    ? `Waiting for the server to answer: ${what}.`
    : null
}

export function usePendingReason(
  type: string,
  what: string,
  matches?: (input: unknown) => boolean,
): string | null {
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  return waitingReason(pending, type, what, matches)
}

/** Matches a request whose input names this stage. */
export function forStage(stageId: string) {
  return (input: unknown) =>
    typeof input === 'object' &&
    input !== null &&
    (input as { stageId?: unknown }).stageId === stageId
}
