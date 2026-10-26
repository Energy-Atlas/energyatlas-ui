import { createInitialState } from '../domain/initialState.ts'
import { runStageNow } from '../domain/jobs/runNow.ts'
import type { WorkbenchState } from '../domain/types.ts'
import { createWorkbench, type Workbench } from '../domain/workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../domain/workflow.ts'

// Project fixtures for the Demo conditions picker (decision 0023). Each one is
// reached by running the real domain commands, so it is a state the workflow
// can actually produce.

export type FixtureId = 'new' | 'partway' | 'failed' | 'complete'

export const FIXTURES: Record<
  FixtureId,
  { label: string; description: string }
> = {
  new: {
    label: 'New project',
    description: 'No stage has run.',
  },
  partway: {
    label: 'Partway',
    description: 'The first four stages ran; Schema matching left a warning.',
  },
  failed: {
    label: 'Failed stage',
    description:
      'Every stage up to Grid modeling ran, with one envelope retrofit scenario, and Grid modeling failed.',
  },
  complete: {
    label: 'Complete',
    description:
      'Every stage ran, with one envelope retrofit scenario; Grid modeling succeeded on its second attempt.',
  },
}

export const FIXTURE_IDS = Object.keys(FIXTURES) as FixtureId[]

export function isFixtureId(value: unknown): value is FixtureId {
  return typeof value === 'string' && value in FIXTURES
}

/** Scenario definitions need a scenario; create one as a user would in Creator. */
function defineScenario(engine: Workbench) {
  if (Object.keys(engine.getState().scenarios).length > 0) return
  engine.execute(
    {
      type: 'measure.create',
      input: {
        name: 'Envelope retrofit',
        kind: 'envelope',
        savingsPercent: 20,
        appliesTo: 'all',
      },
    },
    'system',
  )
  const measureIds = Object.keys(engine.getState().measures)
  engine.execute(
    {
      type: 'scenario.create',
      input: { name: 'Envelope retrofit', measureIds, adoptionPercent: 40 },
    },
    'system',
  )
}

/** The next stage in workflow order that can run, or null. */
function nextRunnable(state: WorkbenchState): string | null {
  const states = deriveStageStates(state.workflow, state.tasks)
  return (
    state.workflow.stageIds.find(
      (id) => states[id] === 'ready' || states[id] === 'failed',
    ) ?? null
  )
}

export function buildFixture(id: FixtureId, now: () => Date): WorkbenchState {
  const engine = createWorkbench({
    initialState: createInitialState(),
    operationIdPrefix: `fixture-${id}-op`,
    now,
  })
  const stop: Record<FixtureId, (state: WorkbenchState) => boolean> = {
    new: () => true,
    partway: (state) =>
      state.workflow.stages[STAGE_IDS.preprocessing]?.lastRun?.outcome ===
      'succeeded',
    failed: (state) =>
      state.workflow.stages[STAGE_IDS.gridModeling]?.lastRun?.outcome ===
      'failed',
    complete: () => false,
  }
  // Every stage runs at most twice, which bounds the loop.
  for (let guard = 0; guard < 40; guard += 1) {
    const state = engine.getState()
    if (stop[id](state)) break
    const stageId = nextRunnable(state)
    if (!stageId) break
    if (stageId === STAGE_IDS.scenarioDefinitions) defineScenario(engine)
    runStageNow(engine, stageId, 'system')
  }
  const state = engine.getState()
  return { ...state, workflow: { ...state.workflow, currentStageId: null } }
}
