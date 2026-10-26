import type { ValidationIssue } from '../domain/commands.ts'

// RC's error body (EnergyAtlasWeb/Runtime/ApiErrors.cs, decision 0023): every
// refusal is {success: false, message, code}; model-binding failures add the
// validation problem's title, status, per-field errors, and trace id, and a
// refusal during a run names the run's job id and kind.

export type ApiErrorBody = {
  success: false
  message: string
  code: string
  error?: string
  title?: string
  status?: number
  errors?: Record<string, string[]>
  traceId?: string
  jobId?: string | null
  kind?: string | null
}

export type ApiFailure = { status: number; body: ApiErrorBody }

let traceCounter = 0

function nextTraceId(): string {
  traceCounter += 1
  return `mock-trace-${traceCounter}`
}

/** A 400 like RC's `ApiErrors.InvalidModelState`. */
export function invalidRequest(issues: ValidationIssue[]): ApiFailure {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path || '$'
    errors[key] = [...(errors[key] ?? []), issue.message]
  }
  const first = issues[0]
  const message = !first
    ? 'The request is invalid.'
    : first.path
      ? `${first.path}: ${first.message}`
      : first.message
  return {
    status: 400,
    body: {
      success: false,
      message,
      code: 'invalid_request',
      error: message,
      title: 'One or more validation errors occurred.',
      status: 400,
      errors,
      traceId: nextTraceId(),
    },
  }
}

/** A 409 like RC's `ProjectEditGate` while a run holds the project. */
export function runInProgress(
  jobId: string | null,
  kind: string | null,
): ApiFailure {
  return {
    status: 409,
    body: {
      success: false,
      message:
        'A run is in progress, so the project cannot be changed until it finishes.',
      code: 'run_in_progress',
      jobId,
      kind,
    },
  }
}

export function serverError(message: string, status = 500): ApiFailure {
  return {
    status,
    body: { success: false, message, code: 'server_error', error: message },
  }
}

/** Field issues from an error body, so forms can show them per field. */
export function issuesFromError(body: ApiErrorBody): ValidationIssue[] {
  const fieldIssues = Object.entries(body.errors ?? {}).flatMap(
    ([key, messages]) =>
      messages.map((message) => ({
        path: key === '$' ? '' : key,
        message,
      })),
  )
  return fieldIssues.length > 0
    ? fieldIssues
    : [{ path: '', message: body.message }]
}
