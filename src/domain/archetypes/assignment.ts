import { STAGE_IDS } from '../workflow.ts'
import {
  buildingSubject,
  firstMatches,
  prepareRules,
  type PreparedRule,
  type RuleWarning,
} from '../rules/conditions.ts'
import {
  ARCHETYPE_LIBRARY,
  DEFAULT_ARCHETYPE_IDS,
  FALLBACK_ARCHETYPE_ID,
} from './library.ts'
import { effectivePartIds, emptyParts, overrideKey } from './parts.ts'
import type {
  Archetype,
  AssignmentRule,
  Building,
  BuildingParts,
  PartKind,
  RuleCondition,
  WorkbenchState,
} from '../types.ts'
import { PART_KINDS } from '../types.ts'

export {
  dayHours,
  scheduleStats,
  weekdayHours,
  type ScheduleStats,
} from './schedules.ts'

// Archetype assignment by rules (decision 0032): RC's four parts assigned
// separately. Rules are tried top first; each part takes the first enabled
// rule that matches the building and sets that part. Manual overrides win.

export function rangeWidth(archetype: Archetype): number {
  const from = archetype.yearFrom ?? 1600
  const to = archetype.yearTo ?? 2030
  return to - from
}

/** The conditions a default rule for an archetype uses: its use and year range. */
export function archetypeConditions(archetype: Archetype): RuleCondition[] {
  const conditions: RuleCondition[] = [
    { field: 'use', operator: 'equals', value: archetype.use },
  ]
  // RC turns "at least" into larger than one less (TemplateAssignmentController.cs).
  if (archetype.yearFrom !== null) {
    conditions.push({
      field: 'yearBuilt',
      operator: 'larger',
      value: String(archetype.yearFrom - 1),
    })
  }
  if (archetype.yearTo !== null) {
    conditions.push({
      field: 'yearBuilt',
      operator: 'smaller',
      value: String(archetype.yearTo + 1),
    })
  }
  return conditions
}

export const FALLBACK_RULE_NAME = 'Fallback: any building'

/** A generated rule and the archetype it comes from; null for the fallback. */
export type DefaultRuleDraft = {
  archetypeId: string | null
  rule: Omit<AssignmentRule, 'id'>
}

/**
 * The default rules RC generates per building type and vintage, with a
 * fallback without conditions last (TemplateAssignmentController.cs:1444-1538).
 * In the demo they come from the project's archetypes: by use, the narrowest
 * year range first, then id, so specific vintages win over open ones. The
 * fallback takes the Mixed use archetype's parts when the project has them.
 */
export function defaultRuleDrafts(
  archetypes: Record<string, Archetype>,
): DefaultRuleDraft[] {
  const ordered = Object.values(archetypes).sort(
    (a, b) =>
      a.use.localeCompare(b.use) ||
      rangeWidth(a) - rangeWidth(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const drafts: DefaultRuleDraft[] = ordered.map((archetype) => ({
    archetypeId: archetype.id,
    rule: {
      name: archetype.name,
      enabled: true,
      logic: 'all',
      conditions: archetypeConditions(archetype),
      parts: { ...archetype.parts },
      origin: 'default',
    },
  }))
  const fallback =
    archetypes[FALLBACK_ARCHETYPE_ID] ??
    ARCHETYPE_LIBRARY.find((entry) => entry.id === FALLBACK_ARCHETYPE_ID)
  if (fallback) {
    drafts.push({
      archetypeId: null,
      rule: {
        name: FALLBACK_RULE_NAME,
        enabled: true,
        logic: 'all',
        conditions: [],
        parts: { ...fallback.parts },
        origin: 'default',
      },
    })
  }
  return drafts
}

/** The rules in order, as evaluation reads them. */
export function orderedRules(
  state: Pick<WorkbenchState, 'rules' | 'ruleIds'>,
): AssignmentRule[] {
  return state.ruleIds.flatMap((id) => {
    const rule = state.rules[id]
    return rule ? [rule] : []
  })
}

/** The enabled rules ready to evaluate, with RC's coded warnings. */
export function prepareAssignmentRules(
  state: Pick<WorkbenchState, 'rules' | 'ruleIds' | 'parts'>,
): { prepared: PreparedRule<PartKind>[]; warnings: RuleWarning[] } {
  return prepareRules(
    orderedRules(state).map((rule) => ({ ...rule, slots: rule.parts })),
    PART_KINDS,
    (kind, partId) => state.parts[partId]?.kind === kind,
  )
}

/** The parts the rules give one building, by the rule that set each. */
export function assignBuilding(
  prepared: PreparedRule<PartKind>[],
  building: Building,
): { parts: BuildingParts; matched: string[] } {
  const { winners, matched } = firstMatches(
    prepared,
    PART_KINDS,
    buildingSubject(building),
  )
  const parts = emptyParts()
  for (const kind of PART_KINDS) {
    const winner = winners[kind]
    parts[kind] = winner
      ? {
          partId: winner.value,
          ruleId: winner.ruleId,
          ruleName: winner.ruleName,
        }
      : null
  }
  return { parts, matched }
}

export type RulePreview = {
  ruleId: string
  /** Buildings whose attributes the rule matches. */
  matched: number
  /** Buildings whose part of each kind this rule sets, after manual overrides. */
  takes: Record<PartKind, number>
  /** Buildings the rule matches, in building order. */
  buildingIds: string[]
}

export type AssignmentPreview = {
  /** Per rule in list order; disabled and skipped rules match nothing. */
  rules: RulePreview[]
  /** Buildings left without each part after rules and overrides. */
  unassigned: Record<PartKind, number>
  /** Manual overrides of each kind, which win over the rules. */
  manual: Record<PartKind, number>
  /** Buildings with all four parts. */
  complete: number
  buildings: number
  /** Buildings whose effective parts would change from the published ones. */
  changes: number
  warnings: RuleWarning[]
  /** Rule results by building, before manual overrides. */
  byBuilding: Record<string, BuildingParts>
}

const zeroCounts = (): Record<PartKind, number> => ({
  construction: 0,
  systems: 0,
  spaceLoads: 0,
  externalLoads: 0,
})

/**
 * What the current rules would assign, before running: per rule, how many
 * buildings it matches and how many parts it takes; unassigned and manual
 * parts per kind; coded warnings. Pure; shared by the page, the agent, and
 * the job, so a preview and a run never disagree.
 */
export function previewAssignment(
  state: Pick<
    WorkbenchState,
    'rules' | 'ruleIds' | 'parts' | 'buildings' | 'buildingIds' | 'overrides'
  >,
): AssignmentPreview {
  const { prepared, warnings } = prepareAssignmentRules(state)
  const previews = new Map<string, RulePreview>(
    state.ruleIds.map((id) => [
      id,
      { ruleId: id, matched: 0, takes: zeroCounts(), buildingIds: [] },
    ]),
  )
  const unassigned = zeroCounts()
  const manual = zeroCounts()
  const byBuilding: Record<string, BuildingParts> = {}
  let complete = 0
  let changes = 0
  for (const id of state.buildingIds) {
    const building = state.buildings[id]
    if (!building) continue
    const { parts, matched } = assignBuilding(prepared, building)
    byBuilding[id] = parts
    for (const ruleId of matched) {
      const preview = previews.get(ruleId)
      if (!preview) continue
      preview.matched += 1
      preview.buildingIds.push(id)
    }
    const current = effectivePartIds(state, building)
    let full = true
    let changed = false
    for (const kind of PART_KINDS) {
      const override = state.overrides[overrideKey(id, kind)]
      const next =
        override && typeof override.value === 'string'
          ? override.value
          : (parts[kind]?.partId ?? null)
      if (override) manual[kind] += 1
      else if (parts[kind]) {
        const preview = previews.get(parts[kind].ruleId)
        if (preview) preview.takes[kind] += 1
      }
      if (next === null) {
        unassigned[kind] += 1
        full = false
      }
      if (next !== current[kind]) changed = true
    }
    if (full) complete += 1
    if (changed) changes += 1
  }
  return {
    rules: [...previews.values()],
    unassigned,
    manual,
    complete,
    buildings: state.buildingIds.length,
    changes,
    warnings,
    byBuilding,
  }
}

/**
 * Library defaults a first run adds before assigning: while Archetype
 * modeling has never run, every default archetype the project lacks,
 * skipping names in use.
 */
export function missingDefaults(state: WorkbenchState): Archetype[] {
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  if (!stage || stage.lastRun !== null) return []
  const names = new Set(
    Object.values(state.archetypes).map((item) =>
      item.name.trim().toLowerCase(),
    ),
  )
  return ARCHETYPE_LIBRARY.filter(
    (entry) =>
      DEFAULT_ARCHETYPE_IDS.includes(entry.id) &&
      !state.archetypes[entry.id] &&
      !names.has(entry.name.trim().toLowerCase()),
  )
}

/** Whether a first run would also generate the default rules: it has never run and has none. */
export function generatesDefaultRules(state: WorkbenchState): boolean {
  const stage = state.workflow.stages[STAGE_IDS.archetypes]
  return Boolean(stage && stage.lastRun === null && state.ruleIds.length === 0)
}
