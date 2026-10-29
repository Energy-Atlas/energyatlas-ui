import { describe, expect, it } from 'vitest'
import { createWorkbench, type Workbench } from '../../domain/workbench.ts'
import { deriveStageStates } from '../../domain/workflow.ts'
import { buildFixture } from '../../server/fixtures.ts'
import { projectStateSchema } from '../../server/projectSchema.ts'
import { legacyScenarioSave } from '../../testing/legacyScenarioSave.ts'
import { SESSIONS, type ScriptContext, type Step } from './sessions.ts'
import { createInitialViewState } from '../view/viewOperations.ts'

// The scenario change session's adoption branch, step by step, against a
// project whose scenario results were saved before scenario rules.

function contextOf(workbench: Workbench): ScriptContext {
  return {
    state: () => workbench.getState(),
    view: () => createInitialViewState(),
    stageStates: () => {
      const state = workbench.getState()
      return deriveStageStates(state.workflow, state.tasks)
    },
    memory: {},
  }
}

function run(step: unknown, context: ScriptContext): Step[] {
  if (typeof step !== 'function') return [step as Step]
  const out = (step as (context: ScriptContext) => Step | Step[] | null)(
    context,
  )
  return out === null ? [] : Array.isArray(out) ? out : [out]
}

function text(steps: Step[]): string {
  return JSON.stringify(steps)
}

describe('propose a scenario change', () => {
  const session = SESSIONS.find((item) => item.id === 'modelChange')!

  it('does not claim nothing became outdated for a result saved before versions', () => {
    const legacy = projectStateSchema.parse(
      legacyScenarioSave(buildFixture('complete', () => new Date())),
    )
    const workbench = createWorkbench({ initialState: legacy })
    const context = contextOf(workbench)
    const proposal = run(session.steps[1], context)
    expect(text(proposal)).toContain('saved before scenario rules')
    const scenario = Object.values(workbench.getState().scenarios)[0]!
    workbench.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId: scenario.id, adoptionPercent: 60 },
    })
    const report = text(run(session.steps[2], context))
    expect(report).not.toContain('No stage became outdated')
    expect(report).toContain('outdated')
  })

  it('says nothing became outdated when versions are re-aggregated', () => {
    const workbench = createWorkbench({
      initialState: buildFixture('complete', () => new Date()),
    })
    const context = contextOf(workbench)
    expect(text(run(session.steps[1], context))).toContain('re-aggregated')
    const scenario = Object.values(workbench.getState().scenarios)[0]!
    workbench.execute({
      type: 'scenario.setAdoption',
      input: { scenarioId: scenario.id, adoptionPercent: 60 },
    })
    expect(text(run(session.steps[2], context))).toContain(
      'No stage became outdated',
    )
  })
})
