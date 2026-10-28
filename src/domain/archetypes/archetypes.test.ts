import { describe, expect, test } from 'vitest'
import { buildFixture } from '../../server/fixtures.ts'
import { finishJobNow, runStageNow } from '../jobs/runNow.ts'
import { retryBlocker } from '../jobs/runGroups.ts'
import type { AssignmentRule, RuleCondition } from '../types.ts'
import { createWorkbench, type Workbench } from '../workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../workflow.ts'
import {
  FALLBACK_RULE_NAME,
  defaultRuleDrafts,
  orderedRules,
  previewAssignment,
  scheduleStats,
  weekdayHours,
} from './assignment.ts'
import {
  ARCHETYPE_LIBRARY,
  PART_LIBRARY,
  SCHEDULE_LIBRARY,
  weekdayWeekend,
} from './library.ts'
import {
  archetypeIntensity,
  archetypeLabel,
  buildingIntensity,
  effectiveParts,
  partsIntensity,
  resolveParts,
} from './parts.ts'

const S = STAGE_IDS

/** The Partway fixture with shading skipped, so Archetype modeling is ready. */
function partway(): Workbench {
  const workbench = createWorkbench({
    initialState: buildFixture('partway', () => new Date()),
  })
  workbench.execute({
    type: 'workflow.setStageSkipped',
    input: { stageId: STAGE_IDS.shading, skipped: true },
  })
  return workbench
}

/** Partway after a first Archetype modeling run, with default rules and a heat pump part. */
function assigned(): Workbench {
  const workbench = partway()
  runStageNow(workbench, S.archetypes)
  workbench.execute({
    type: 'part.save',
    input: {
      name: 'Heat pump',
      kind: 'systems',
      fuel: 'electric',
      heatingEfficiency: 2.8,
      coolingCop: 3.4,
      hotWaterKwhPerM2: 20,
    },
  })
  return workbench
}

/** The id of the heat pump part `assigned` creates. */
function heatPump(workbench: Workbench): string {
  return (
    Object.values(workbench.getState().parts).find(
      (part) => part.name === 'Heat pump',
    )?.id ?? ''
  )
}

function states(workbench: Workbench) {
  const state = workbench.getState()
  return deriveStageStates(state.workflow, state.tasks)
}

const flat = (value: number) => Array.from({ length: 24 }, () => value)

const LIBRARY_PARTS = Object.fromEntries(
  PART_LIBRARY.map((part) => [part.id, part]),
)
const LIBRARY_SCHEDULES = Object.fromEntries(
  SCHEDULE_LIBRARY.map((schedule) => [schedule.id, schedule]),
)

const noParts = {
  construction: null,
  systems: null,
  spaceLoads: null,
  externalLoads: null,
}

function ruleInput(
  name: string,
  conditions: RuleCondition[],
  parts: Partial<AssignmentRule['parts']>,
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    logic: 'all' as const,
    conditions,
    parts: { ...noParts, ...parts },
    ...extra,
  }
}

describe('archetype parts', () => {
  test('library archetypes keep plausible intensities from their four parts', () => {
    const totals = Object.fromEntries(
      ARCHETYPE_LIBRARY.map((entry) => [
        entry.id,
        archetypeIntensity(entry, LIBRARY_PARTS, LIBRARY_SCHEDULES)?.total,
      ]),
    )
    for (const total of Object.values(totals)) {
      expect(total).toBeGreaterThan(100)
      expect(total).toBeLessThan(300)
    }
    // Older and leakier stock uses more than newer stock of the same use.
    expect(totals['archetype:residential-pre-1980']).toBeGreaterThan(
      totals['archetype:residential-1980-on'] ?? 0,
    )
    expect(totals['archetype:office-pre-1950']).toBeGreaterThan(
      totals['archetype:office'] ?? 0,
    )
  })

  test('each part moves the result the way its fields should', () => {
    const office = ARCHETYPE_LIBRARY.find(
      (entry) => entry.id === 'archetype:office',
    )!
    const set = resolveParts(office.parts, LIBRARY_PARTS)!
    const base = partsIntensity(set, LIBRARY_SCHEDULES)
    const leaky = partsIntensity(
      { ...set, construction: { ...set.construction, wallU: 2 } },
      LIBRARY_SCHEDULES,
    )
    expect(leaky.heating).toBeGreaterThan(base.heating)
    const heatPump = partsIntensity(
      { ...set, systems: { ...set.systems, heatingEfficiency: 3 } },
      LIBRARY_SCHEDULES,
    )
    expect(heatPump.heating).toBeLessThan(base.heating)
    const unscheduled = partsIntensity(
      { ...set, spaceLoads: { ...set.spaceLoads, scheduleId: null } },
      LIBRARY_SCHEDULES,
    )
    expect(unscheduled.lighting).toBe(
      Math.round(set.spaceLoads.lightingWPerM2 * 4380) / 1000,
    )
    expect(
      partsIntensity(
        { ...set, externalLoads: { ...set.externalLoads, processKwhPerM2: 0 } },
        LIBRARY_SCHEDULES,
      ).total,
    ).toBeCloseTo(base.total - set.externalLoads.processKwhPerM2, 0)
  })

  test('validates part fields and keeps a part kind', () => {
    const workbench = partway()
    expect(
      workbench.execute({
        type: 'part.save',
        input: {
          name: 'Glass box',
          kind: 'construction',
          wallU: 0.5,
          roofU: 0.3,
          windowU: 1.4,
          windowRatio: 1.2,
          infiltrationAch: 0.3,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'windowRatio' }] })
    expect(
      workbench.execute({
        type: 'part.save',
        input: {
          name: 'Night loads',
          kind: 'spaceLoads',
          lightingWPerM2: 4,
          equipmentWPerM2: 4,
          m2PerPerson: 30,
          scheduleId: 'schedule:missing',
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'scheduleId' }] })
    const created = workbench.execute({
      type: 'part.save',
      input: {
        name: 'Heat pump retrofit',
        kind: 'systems',
        fuel: 'electric',
        heatingEfficiency: 3.1,
        coolingCop: 3.8,
        hotWaterKwhPerM2: 18,
      },
    })
    expect(created.outcome.status).toBe('applied')
    const id = Object.keys(workbench.getState().parts)[0] ?? ''
    expect(
      workbench.execute({
        type: 'part.save',
        input: {
          id,
          name: 'Heat pump retrofit',
          kind: 'externalLoads',
          exteriorLightingKwhPerM2: 1,
          processKwhPerM2: 1,
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'kind' }] })
    workbench.undo()
    expect(workbench.getState().parts).toEqual({})
  })

  test('an archetype bundles existing parts of the right kinds', () => {
    const workbench = assigned()
    const input = {
      name: 'Office 1990s',
      use: 'office' as const,
      yearFrom: 1990,
      yearTo: 1999,
      parts: {
        construction: 'construction:curtain-wall',
        systems: 'loads:office',
        spaceLoads: 'loads:office',
        externalLoads: null,
      },
    }
    expect(
      workbench.execute({ type: 'archetype.save', input }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'parts.systems' }] })
    expect(
      workbench.execute({
        type: 'archetype.save',
        input: {
          ...input,
          yearFrom: 2000,
          parts: { ...input.parts, systems: null },
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'yearTo' }] })
    const saved = workbench.execute({
      type: 'archetype.save',
      input: {
        ...input,
        parts: { ...input.parts, systems: 'systems:office-vav' },
      },
    })
    expect(saved.outcome.status).toBe('applied')
    // Archetypes feed the default rules; saving one does not outdate assignment.
    expect(states(workbench)[S.archetypes]).toBe('executed')
  })
})

describe('assignment rules', () => {
  test('a first run adds the default archetypes and generates default rules with a fallback', () => {
    const workbench = assigned()
    const state = workbench.getState()
    expect(Object.keys(state.archetypes)).toHaveLength(5)
    const rules = orderedRules(state)
    expect(rules.map((rule) => rule.name)).toEqual([
      'Office',
      'Residential, built 1980 or later',
      'Residential, built before 1980',
      'Retail',
      'School',
      FALLBACK_RULE_NAME,
    ])
    expect(rules.at(-1)?.conditions).toEqual([])
    expect(rules[1]?.conditions).toEqual([
      { field: 'use', operator: 'equals', value: 'residential' },
      { field: 'yearBuilt', operator: 'larger', value: '1979' },
    ])
    expect(states(workbench)[S.archetypes]).toBe('executed')
    // Every building gets all four parts; mixed use takes the fallback.
    const preview = previewAssignment(state)
    expect(preview.complete).toBe(state.buildingIds.length)
    const mixed = state.buildingIds.find(
      (id) => state.buildings[id]?.use === 'mixed',
    )!
    expect(state.buildings[mixed]?.parts.construction).toMatchObject({
      ruleName: FALLBACK_RULE_NAME,
      partId: 'construction:uninsulated-pre-1980',
    })
    expect(archetypeLabel(state, state.buildings[mixed]!)).toBe('Mixed parts')
    const office = state.buildingIds.find(
      (id) => state.buildings[id]?.use === 'office',
    )!
    expect(archetypeLabel(state, state.buildings[office]!)).toBe('Office')
  })

  test('default rules order narrow vintages before open ones', () => {
    const library = Object.fromEntries(
      ARCHETYPE_LIBRARY.map((entry) => [entry.id, entry]),
    )
    const names = defaultRuleDrafts(library).map((draft) => draft.rule.name)
    expect(names.indexOf('Office, built before 1950')).toBeLessThan(
      names.indexOf('Office'),
    )
    expect(names.at(-1)).toBe(FALLBACK_RULE_NAME)
  })

  test('parts of one building can come from different rules', () => {
    const workbench = assigned()
    const saved = workbench.execute({
      type: 'rule.save',
      input: ruleInput(
        'Tall buildings: heat pumps',
        [{ field: 'floors', operator: 'larger', value: '6' }],
        { systems: heatPump(workbench) },
      ),
    })
    expect(saved.outcome.status).toBe('applied')
    expect(states(workbench)[S.archetypes]).toBe('stale')
    const state = workbench.getState()
    expect(state.ruleIds[0]).toBe(
      Object.values(state.rules).find(
        (rule) => rule.name === 'Tall buildings: heat pumps',
      )?.id,
    )
    const preview = previewAssignment(state)
    const tall = state.buildingIds.filter(
      (id) => (state.buildings[id]?.floors ?? 0) > 6,
    )
    expect(preview.rules[0]?.matched).toBe(tall.length)
    expect(preview.rules[0]?.takes).toEqual({
      construction: 0,
      systems: tall.length,
      spaceLoads: 0,
      externalLoads: 0,
    })
    const one = preview.byBuilding[tall[0]!]!
    expect(one.systems?.ruleName).toBe('Tall buildings: heat pumps')
    expect(one.construction?.ruleName).not.toBe('Tall buildings: heat pumps')
    expect(preview.changes).toBe(tall.length)

    runStageNow(workbench, S.archetypes)
    const after = workbench.getState()
    expect(after.buildings[tall[0]!]?.parts.systems?.partId).toBe(
      heatPump(workbench),
    )
    expect(archetypeLabel(after, after.buildings[tall[0]!]!)).toBe(
      'Mixed parts',
    )
  })

  test('validates rules per field', () => {
    const workbench = assigned()
    const outcome = workbench.execute({
      type: 'rule.save',
      input: ruleInput(
        'Office',
        [
          { field: 'floors', operator: 'larger', value: 'six' },
          { field: 'yearBuilt', operator: 'contains', value: '19' },
        ],
        { construction: 'systems:gas-boiler' },
      ),
    }).outcome
    expect(outcome.status).toBe('rejected')
    // The name clash is reported first and alone.
    expect(outcome).toMatchObject({ issues: [{ path: 'name' }] })
    const fields = workbench.execute({
      type: 'rule.save',
      input: ruleInput(
        'Broken',
        [
          { field: 'floors', operator: 'larger', value: 'six' },
          { field: 'yearBuilt', operator: 'contains', value: '19' },
        ],
        { construction: 'systems:gas-boiler' },
      ),
    }).outcome
    expect(
      fields.status === 'rejected' && fields.issues.map((issue) => issue.path),
    ).toEqual([
      'conditions.0.value',
      'conditions.1.operator',
      'parts.construction',
    ])
    expect(
      workbench.execute({
        type: 'rule.save',
        input: ruleInput('Nothing set', [], {}),
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'parts' }] })
    // A blank condition is allowed and warned about when evaluated.
    workbench.execute({
      type: 'rule.save',
      input: ruleInput(
        'Half done',
        [{ field: null, operator: 'equals', value: '' }],
        { systems: heatPump(workbench) },
      ),
    })
    expect(
      previewAssignment(workbench.getState()).warnings.map((each) => each.code),
    ).toEqual(['blank_conditions_skipped'])
  })

  test('rules move, switch, duplicate, and are removed, each undoable', () => {
    const workbench = assigned()
    const order = () =>
      orderedRules(workbench.getState()).map((rule) => rule.name)
    const first = workbench.getState().ruleIds[0]!
    expect(
      workbench.execute({
        type: 'rule.move',
        input: { ruleId: first, position: 2 },
      }).outcome.status,
    ).toBe('applied')
    expect(order().slice(0, 3)).toEqual([
      'Residential, built 1980 or later',
      'Residential, built before 1980',
      'Office',
    ])
    expect(
      workbench.execute({
        type: 'rule.move',
        input: { ruleId: first, position: 99 },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'position' }] })
    workbench.undo()
    expect(order()[0]).toBe('Office')

    workbench.execute({
      type: 'rule.setEnabled',
      input: { ruleId: first, enabled: false },
    })
    const preview = previewAssignment(workbench.getState())
    expect(preview.rules[0]?.matched).toBe(0)
    // Offices fall through to the fallback.
    const state = workbench.getState()
    const office = state.buildingIds.find(
      (id) => state.buildings[id]?.use === 'office',
    )!
    expect(preview.byBuilding[office]?.construction?.ruleName).toBe(
      FALLBACK_RULE_NAME,
    )

    workbench.execute({ type: 'rule.duplicate', input: { ruleId: first } })
    expect(order().slice(0, 2)).toEqual(['Office', 'Office (copy)'])
    workbench.execute({ type: 'rule.remove', input: { ruleId: first } })
    expect(order()[0]).toBe('Office (copy)')
    workbench.undo()
    expect(order()[0]).toBe('Office')
  })

  test('a project without rules or with every rule off cannot run assignment', () => {
    const workbench = assigned()
    for (const ruleId of workbench.getState().ruleIds) {
      workbench.execute({
        type: 'rule.setEnabled',
        input: { ruleId, enabled: false },
      })
    }
    expect(
      workbench.execute({
        type: 'workflow.runStage',
        input: { stageId: S.archetypes },
      }).outcome,
    ).toMatchObject({
      status: 'rejected',
      issues: [
        { message: 'Every assignment rule is off. Switch one on first.' },
      ],
    })
    for (const ruleId of [...workbench.getState().ruleIds]) {
      workbench.execute({ type: 'rule.remove', input: { ruleId } })
    }
    expect(
      workbench.execute({
        type: 'workflow.runStage',
        input: { stageId: S.archetypes },
      }).outcome,
    ).toMatchObject({ status: 'rejected' })
    workbench.execute({ type: 'rule.generateDefaults', input: {} })
    expect(workbench.getState().ruleIds).toHaveLength(6)
  })

  test('generating defaults again keeps the project rules on top', () => {
    const workbench = assigned()
    workbench.execute({
      type: 'rule.save',
      input: ruleInput('Mine', [], { systems: heatPump(workbench) }),
    })
    workbench.execute({
      type: 'archetype.addFromLibrary',
      input: { libraryId: 'archetype:office-pre-1950' },
    })
    workbench.execute({ type: 'rule.generateDefaults', input: {} })
    const names = orderedRules(workbench.getState()).map((rule) => rule.name)
    expect(names[0]).toBe('Mine')
    expect(names).toContain('Office, built before 1950')
    expect(names).toHaveLength(8)
  })
})

describe('manual parts and assignment jobs', () => {
  test('a manual part wins over the rules and can follow them again', () => {
    const workbench = assigned()
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'systems', value: 'loads:office' },
    })
    expect(
      workbench.execute({
        type: 'edits.propose',
        input: { entityId: 'B0001', field: 'systems', value: 'loads:office' },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'value' }] })
    workbench.execute({
      type: 'edits.propose',
      input: {
        entityId: 'B0001',
        field: 'systems',
        value: heatPump(workbench),
      },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    let state = workbench.getState()
    expect(effectiveParts(state, state.buildings.B0001!).systems).toMatchObject(
      { partId: heatPump(workbench), via: 'manual' },
    )
    expect(states(workbench)[S.baseline]).toBe('ready')
    expect(previewAssignment(state).manual.systems).toBe(1)

    // A rerun keeps the manual part.
    runStageNow(workbench, S.archetypes)
    state = workbench.getState()
    expect(effectiveParts(state, state.buildings.B0001!).systems?.via).toBe(
      'manual',
    )
    const before = buildingIntensity(state, state.buildings.B0001!)

    // Null follows the rules again.
    workbench.execute({
      type: 'edits.propose',
      input: { entityId: 'B0001', field: 'systems', value: null },
    })
    workbench.execute({ type: 'edits.apply', input: {} })
    state = workbench.getState()
    expect(effectiveParts(state, state.buildings.B0001!).systems?.via).toBe(
      'rule',
    )
    expect(buildingIntensity(state, state.buildings.B0001!)?.total).not.toBe(
      before?.total,
    )
  })

  test('holds assignments until every building succeeds, then publishes them', () => {
    const workbench = assigned()
    const officeRule = workbench.getState().ruleIds[0]!
    const office = workbench.getState().rules[officeRule]!
    workbench.execute({
      type: 'rule.save',
      input: {
        ...ruleInput(office.name, office.conditions, {
          ...office.parts,
          systems: heatPump(workbench),
        }),
        id: officeRule,
      },
    })
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.archetypes },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const officeId = workbench
      .getState()
      .buildingIds.find(
        (id) => workbench.getState().buildings[id]?.use === 'office',
      )!
    finishJobNow(workbench, taskId, { failures: { B0002: 'Fault.' } })
    // Nothing is published while one building failed.
    expect(
      workbench.getState().buildings[officeId]?.parts.systems?.partId,
    ).toBe('systems:office-vav')
    expect(retryBlocker(workbench.getState(), taskId)).toBeNull()
    workbench.execute({ type: 'job.retry', input: { taskId } })
    finishJobNow(workbench, workbench.getState().taskIds.at(-1) ?? '')
    expect(
      workbench.getState().buildings[officeId]?.parts.systems?.partId,
    ).toBe(heatPump(workbench))
    expect(states(workbench)[S.archetypes]).toBe('executed')
  })

  test('changing a rule or a used part refuses retries of the old run', () => {
    const workbench = assigned()
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: S.archetypes },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    finishJobNow(workbench, taskId, { failures: { B0002: 'Fault.' } })
    const part = workbench.getState().parts['systems:office-vav']
    if (part?.kind !== 'systems') throw new Error('Missing office systems')
    workbench.execute({
      type: 'part.save',
      input: { ...part, heatingEfficiency: 0.9 },
    })
    expect(retryBlocker(workbench.getState(), taskId)).toMatch(
      /inputs owned by "Archetype modeling" changed/,
    )
  })

  test('the baseline uses each building’s four parts', () => {
    const workbench = assigned()
    runStageNow(workbench, S.baseline)
    const state = workbench.getState()
    const baseline = state.results.baseline!
    const building = state.buildings.B0001!
    expect(baseline.byBuildingKwh.B0001).toBe(
      Math.round(
        (building.floorAreaM2 ?? 0) *
          (buildingIntensity(state, building)?.total ?? 0),
      ),
    )
    expect(Object.keys(baseline.byBuildingKwh)).toHaveLength(
      state.buildingIds.length,
    )
  })
})

describe('schedules', () => {
  test('schedule statistics sum each day of the week by its day type', () => {
    expect(scheduleStats(weekdayWeekend(flat(1), flat(0)))).toEqual({
      weeklyHours: 120,
      annualHours: 120 * 52 + 24,
      annualAverage: Math.round(((120 * 52 + 24) / 8760) * 1000) / 1000,
      min: 0,
      max: 1,
    })
    const threeTypes = {
      days: [
        { id: 'weekday', name: 'Weekday', hours: flat(0.5) },
        { id: 'saturday', name: 'Saturday', hours: flat(0.25) },
        { id: 'sunday', name: 'Sunday', hours: flat(0) },
      ],
      week: [
        'weekday',
        'weekday',
        'weekday',
        'weekday',
        'weekday',
        'saturday',
        'sunday',
      ],
    }
    expect(scheduleStats(threeTypes).weeklyHours).toBe(5 * 12 + 6)
    expect(weekdayHours(threeTypes)).toEqual(flat(0.5))
    for (const schedule of SCHEDULE_LIBRARY) {
      expect(schedule.week).toHaveLength(7)
      for (const day of schedule.days) expect(day.hours).toHaveLength(24)
    }
  })

  test('a schedule in use outdates assignment; an unused one does not', () => {
    const workbench = assigned()
    workbench.execute({
      type: 'schedule.save',
      input: { name: 'Night shift', ...weekdayWeekend(flat(0.5), flat(0)) },
    })
    const night = Object.values(workbench.getState().schedules).find(
      (schedule) => schedule.name === 'Night shift',
    )!
    workbench.execute({
      type: 'schedule.save',
      input: {
        id: night.id,
        name: 'Night shift',
        ...weekdayWeekend(flat(0.6), flat(0)),
      },
    })
    expect(states(workbench)[S.archetypes]).toBe('executed')
    const office = workbench.getState().schedules['schedule:office']!
    workbench.execute({
      type: 'schedule.save',
      input: {
        id: office.id,
        name: office.name,
        days: office.days,
        week: office.week,
      },
    })
    expect(states(workbench)[S.archetypes]).toBe('stale')
  })

  test('rejects a schedule without 24 values in range or with no hours', () => {
    const workbench = partway()
    const short = workbench.execute({
      type: 'schedule.save',
      input: { name: 'Short', ...weekdayWeekend([0.5], flat(0)) },
    })
    expect(short.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'days.0.hours' }],
    })
    const empty = workbench.execute({
      type: 'schedule.save',
      input: { name: 'Empty', ...weekdayWeekend(flat(0), flat(0)) },
    })
    expect(empty.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ message: 'A schedule needs at least one hour above 0.' }],
    })
  })

  test('rejects day types the week does not use or that share a name', () => {
    const workbench = partway()
    const { days } = weekdayWeekend(flat(0.5), flat(0.2))
    const unused = workbench.execute({
      type: 'schedule.save',
      input: {
        name: 'Unused',
        days,
        week: Array.from({ length: 7 }, () => 'weekday'),
      },
    })
    expect(unused.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'week' }],
    })
    const twins = workbench.execute({
      type: 'schedule.save',
      input: {
        name: 'Twins',
        days: days.map((day) => ({ ...day, name: 'Day' })),
        week: weekdayWeekend(flat(0), flat(0)).week,
      },
    })
    expect(twins.outcome).toMatchObject({
      status: 'rejected',
      issues: [{ path: 'days' }],
    })
  })

  test('library copies keep unique names', () => {
    const workbench = partway()
    workbench.execute({
      type: 'schedule.save',
      input: {
        name: 'Office occupancy',
        ...weekdayWeekend(flat(0.5), flat(0)),
      },
    })
    workbench.execute({
      type: 'archetype.addFromLibrary',
      input: { libraryId: 'archetype:office' },
    })
    const names = Object.values(workbench.getState().schedules).map(
      (schedule) => schedule.name,
    )
    expect(names.sort()).toEqual([
      'Office occupancy',
      'Office occupancy (library)',
    ])
    expect(Object.keys(workbench.getState().parts)).toHaveLength(4)
  })
})
