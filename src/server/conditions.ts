import type { JobBehaviour } from '../domain/simulator.ts'
import { FIXTURES, isFixtureId, type FixtureId } from './fixtures.ts'

// Demo conditions (decision 0023): causes the mock server and its transport
// act on, never displayed states. They last for the browser session.

export type Latency = 'none' | 'normal' | 'slow'

export type Fault =
  | 'none'
  | 'nextRequest'
  | 'everyRequest'
  | 'offline'
  | 'rejectInput'
  | 'editLock'

export type DemoConditions = {
  latency: Latency
  fault: Fault
  jobs: JobBehaviour
  /** Requests wait unanswered until this is turned off. */
  hold: boolean
}

export const DEFAULT_CONDITIONS: DemoConditions = {
  latency: 'normal',
  fault: 'none',
  jobs: 'normal',
  hold: false,
}

type Option<Value extends string> = {
  value: Value
  label: string
  description: string
}

export const LATENCY_OPTIONS: Option<Latency>[] = [
  {
    value: 'none',
    label: 'None',
    description: 'Replies arrive at once.',
  },
  {
    value: 'normal',
    label: 'Normal',
    description: 'About 250 to 450 ms, like a nearby server.',
  },
  {
    value: 'slow',
    label: 'Slow',
    description: 'About 2.5 to 3.5 s, like a busy or distant server.',
  },
]

export const FAULT_OPTIONS: Option<Fault>[] = [
  { value: 'none', label: 'None', description: 'The server answers normally.' },
  {
    value: 'nextRequest',
    label: 'Next request fails',
    description: 'The next request gets a server error, then this resets.',
  },
  {
    value: 'everyRequest',
    label: 'Every request fails',
    description: 'Every request gets a server error.',
  },
  {
    value: 'offline',
    label: 'Offline',
    description:
      'Nothing reaches the server, and no updates arrive until it is back.',
  },
  {
    value: 'rejectInput',
    label: 'Input rejected',
    description:
      'Every change to the project is refused as invalid input, with a field error.',
  },
  {
    value: 'editLock',
    label: 'Edit lock held',
    description:
      'Another run holds the project, so changes are refused until it ends.',
  },
]

export const JOB_OPTIONS: Option<JobBehaviour>[] = [
  { value: 'normal', label: 'Normal', description: 'Runs finish normally.' },
  {
    value: 'failPartway',
    label: 'Fail partway',
    description: 'Runs fail with a server error halfway through.',
  },
  {
    value: 'stall',
    label: 'Stall',
    description: 'Runs stop making progress until cancelled.',
  },
]

function labelOf<Value extends string>(
  options: Option<Value>[],
  value: Value,
): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/** Short labels of every condition that differs from the default. */
export function describeConditions(conditions: DemoConditions): string[] {
  const labels: string[] = []
  if (conditions.latency !== DEFAULT_CONDITIONS.latency) {
    labels.push(conditions.latency === 'none' ? 'No delay' : 'Slow replies')
  }
  if (conditions.fault !== 'none') {
    labels.push(labelOf(FAULT_OPTIONS, conditions.fault))
  }
  if (conditions.jobs !== 'normal') {
    labels.push(`Jobs: ${labelOf(JOB_OPTIONS, conditions.jobs)}`)
  }
  if (conditions.hold) labels.push('Requests held')
  return labels
}

function oneOf<Value extends string>(
  options: Option<Value>[],
  value: string | null,
): Value | undefined {
  return options.find((option) => option.value === value)?.value
}

/** Reads a stored or URL-supplied set of conditions, ignoring unknown values. */
export function parseConditions(
  values: Record<string, unknown>,
  base: DemoConditions,
): DemoConditions {
  const text = (key: string) =>
    typeof values[key] === 'string' ? values[key] : null
  const hold = values.hold
  return {
    latency: oneOf(LATENCY_OPTIONS, text('latency')) ?? base.latency,
    fault: oneOf(FAULT_OPTIONS, text('fault')) ?? base.fault,
    jobs: oneOf(JOB_OPTIONS, text('jobs')) ?? base.jobs,
    hold:
      hold === true || hold === '1' || hold === 'true'
        ? true
        : hold === false || hold === '0' || hold === 'false'
          ? false
          : base.hold,
  }
}

const SESSION_KEY = 'eaui.demoConditions'

/**
 * The conditions to start with: the session's stored choice, then URL
 * parameters (`latency`, `fault`, `jobs`, `hold`), which win. Also returns a
 * `fixture` parameter, which loads that project fixture on start.
 */
export function initialConditions(
  session: Storage | null,
  search: string,
): { conditions: DemoConditions; fixture: FixtureId | null } {
  let stored: Record<string, unknown> = {}
  try {
    const raw = session?.getItem(SESSION_KEY)
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Unreadable or blocked: start from the defaults.
  }
  const params = new URLSearchParams(search)
  const fromUrl = Object.fromEntries(params.entries())
  const conditions = parseConditions(
    fromUrl,
    parseConditions(stored, DEFAULT_CONDITIONS),
  )
  const fixture = params.get('fixture')
  return { conditions, fixture: isFixtureId(fixture) ? fixture : null }
}

export function storeConditions(
  session: Storage | null,
  conditions: DemoConditions,
): void {
  try {
    session?.setItem(SESSION_KEY, JSON.stringify(conditions))
  } catch {
    // Blocked: the conditions apply until the page is reloaded.
  }
}

export { FIXTURES }
