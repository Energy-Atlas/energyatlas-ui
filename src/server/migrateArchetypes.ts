import { defaultRuleDrafts } from '../domain/archetypes/assignment.ts'
import {
  ARCHETYPE_LIBRARY,
  PART_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../domain/archetypes/library.ts'
import { archetypeIntensity } from '../domain/archetypes/parts.ts'
import type { Archetype, ArchetypePart, PartKind } from '../domain/types.ts'
import { PART_KINDS } from '../domain/types.ts'
import { STAGE_IDS } from '../domain/workflow.ts'

// Saved projects from before archetype parts (decision 0032, stage 2) kept
// one archetype per building with a single energy use intensity. This turns
// such a save into the four-part model before the schema checks it, so the
// published assignment stays as it was:
//
// - a library archetype takes the library entry's parts; a project archetype
//   takes the parts of the library archetype of the same use whose intensity
//   is nearest its old one, and a space-loads copy when its schedule differs;
// - a building's archetype becomes its four parts, by the rule generated for
//   that archetype; a manual archetype becomes four manual parts (a manual
//   "none" is dropped, so the rules decide);
// - where Archetype modeling had run, the default rules are generated, so a
//   rerun can assign again; open assignment runs are invalidated.

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const LIBRARY_PARTS = Object.fromEntries(
  PART_LIBRARY.map((part) => [part.id, part]),
)
const LIBRARY_SCHEDULES = Object.fromEntries(
  SCHEDULE_LIBRARY.map((schedule) => [schedule.id, schedule]),
)

/** The id the migrated default rule for an archetype has. */
export function migratedRuleId(archetypeId: string): string {
  return `rule:migrated:${archetypeId}`
}

function nearestLibraryArchetype(
  use: unknown,
  eui: unknown,
): Archetype | undefined {
  const sameUse = ARCHETYPE_LIBRARY.filter((entry) => entry.use === use)
  const candidates = sameUse.length > 0 ? sameUse : [...ARCHETYPE_LIBRARY]
  const target = typeof eui === 'number' ? eui : 0
  const distance = (entry: Archetype) =>
    Math.abs(
      (archetypeIntensity(entry, LIBRARY_PARTS, LIBRARY_SCHEDULES)?.total ??
        0) - target,
    )
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0]
}

function migrateArchetype(id: string, saved: Raw, parts: Raw): Raw {
  const entry = ARCHETYPE_LIBRARY.find((candidate) => candidate.id === id)
  if (entry) {
    // Very old saves had neither ranges nor provenance; the library fills them.
    return {
      ...entry,
      name: typeof saved.name === 'string' ? saved.name : entry.name,
      use: saved.use ?? entry.use,
      yearFrom: 'yearFrom' in saved ? saved.yearFrom : entry.yearFrom,
      yearTo: 'yearTo' in saved ? saved.yearTo : entry.yearTo,
      parts: { ...entry.parts },
      source: saved.source ?? entry.source,
    }
  }
  const nearest = nearestLibraryArchetype(saved.use, saved.euiKwhPerM2)
  const bundle: Record<PartKind, string | null> = nearest
    ? { ...nearest.parts }
    : {
        construction: null,
        systems: null,
        spaceLoads: null,
        externalLoads: null,
      }
  const loads = bundle.spaceLoads ? LIBRARY_PARTS[bundle.spaceLoads] : undefined
  const scheduleId =
    typeof saved.scheduleId === 'string' ? saved.scheduleId : null
  if (loads?.kind === 'spaceLoads' && scheduleId !== loads.scheduleId) {
    const copyId = `part:migrated:${id}:loads`
    const name = typeof saved.name === 'string' ? saved.name : id
    parts[copyId] = {
      ...loads,
      id: copyId,
      name: `${name} space loads`,
      scheduleId,
      source: { kind: 'project', operationId: 'saved-before-parts' },
    }
    bundle.spaceLoads = copyId
  }
  return {
    id,
    name: saved.name,
    use: saved.use,
    yearFrom: saved.yearFrom ?? null,
    yearTo: saved.yearTo ?? null,
    parts: bundle,
    source: saved.source ?? {
      kind: 'project',
      operationId: 'saved-before-definitions',
    },
  }
}

/** Adds library parts a save refers to but lacks, with their library schedules. */
function addMissingLibraryParts(
  ids: unknown[],
  parts: Raw,
  schedules: Raw,
): void {
  for (const id of ids) {
    if (typeof id !== 'string' || id in parts) continue
    const entry: ArchetypePart | undefined = LIBRARY_PARTS[id]
    if (!entry) continue
    parts[id] = structuredClone(entry)
    if (
      entry.kind === 'spaceLoads' &&
      entry.scheduleId &&
      !(entry.scheduleId in schedules)
    ) {
      const schedule = LIBRARY_SCHEDULES[entry.scheduleId]
      if (schedule) schedules[schedule.id] = structuredClone(schedule)
    }
  }
}

/**
 * Migrates a save from before archetype parts; other values pass through
 * unchanged for the schema to check.
 */
export function migrateArchetypeParts(value: unknown): unknown {
  if (!isObject(value)) return value
  const archetypes = isObject(value.archetypes) ? value.archetypes : {}
  const buildings = isObject(value.buildings) ? value.buildings : {}
  const legacy =
    !('parts' in value) ||
    Object.values(archetypes).some(
      (archetype) => isObject(archetype) && !('parts' in archetype),
    ) ||
    Object.values(buildings).some(
      (building) => isObject(building) && !('parts' in building),
    )
  if (!legacy) return value

  const state: Raw = structuredClone(value)
  const savedBuildings: Raw = isObject(state.buildings) ? state.buildings : {}
  const parts: Raw = isObject(state.parts) ? state.parts : {}
  const schedules: Raw = isObject(state.schedules) ? state.schedules : {}
  const migrated: Record<string, Raw> = {}
  for (const [id, saved] of Object.entries(archetypes)) {
    if (!isObject(saved)) continue
    migrated[id] = 'parts' in saved ? saved : migrateArchetype(id, saved, parts)
  }
  for (const archetype of Object.values(migrated)) {
    const bundle = isObject(archetype.parts) ? archetype.parts : {}
    addMissingLibraryParts(Object.values(bundle), parts, schedules)
  }

  // Default rules where Archetype modeling had run, so a rerun can assign.
  const workflow = isObject(state.workflow) ? state.workflow : {}
  const stages = isObject(workflow.stages) ? workflow.stages : {}
  const stage = stages[STAGE_IDS.archetypes]
  const hasRun =
    isObject(stage) && stage.lastRun !== null && stage.lastRun !== undefined
  const rules: Raw = isObject(state.rules) ? state.rules : {}
  const ruleIds: string[] = Array.isArray(state.ruleIds)
    ? state.ruleIds.filter((id): id is string => typeof id === 'string')
    : []
  if (hasRun && ruleIds.length === 0) {
    const drafts = defaultRuleDrafts(
      migrated as unknown as Record<string, Archetype>,
    )
    for (const draft of drafts) {
      const id = migratedRuleId(draft.archetypeId ?? 'fallback')
      rules[id] = { id, ...draft.rule }
      ruleIds.push(id)
      addMissingLibraryParts(Object.values(draft.rule.parts), parts, schedules)
    }
  }

  for (const building of Object.values(savedBuildings)) {
    if (!isObject(building) || 'parts' in building) continue
    const archetypeId =
      typeof building.archetypeId === 'string' ? building.archetypeId : null
    const archetype = archetypeId ? migrated[archetypeId] : undefined
    const bundle = isObject(archetype?.parts) ? archetype.parts : {}
    const assigned: Record<string, unknown> = {}
    for (const kind of PART_KINDS) {
      const partId = bundle[kind]
      assigned[kind] =
        archetypeId && typeof partId === 'string'
          ? {
              partId,
              ruleId: migratedRuleId(archetypeId),
              ruleName:
                typeof archetype?.name === 'string'
                  ? archetype.name
                  : archetypeId,
            }
          : null
    }
    building.parts = assigned
    delete building.archetypeId
  }

  const overrides: Raw = isObject(state.overrides) ? state.overrides : {}
  for (const [key, override] of Object.entries(overrides)) {
    if (!isObject(override) || override.field !== 'archetypeId') continue
    delete overrides[key]
    const archetype =
      typeof override.value === 'string' ? migrated[override.value] : undefined
    const bundle = isObject(archetype?.parts) ? archetype.parts : {}
    for (const kind of PART_KINDS) {
      const partId = bundle[kind]
      if (typeof partId !== 'string') continue
      overrides[`${String(override.entityId)}:${kind}`] = {
        ...override,
        field: kind,
        value: partId,
      }
    }
  }
  const pending: Raw = isObject(state.pendingEdits) ? state.pendingEdits : {}
  for (const [key, edit] of Object.entries(pending)) {
    if (isObject(edit) && edit.field === 'archetypeId') delete pending[key]
  }

  const groups: Raw = isObject(state.runGroups) ? state.runGroups : {}
  for (const group of Object.values(groups)) {
    if (!isObject(group) || !isObject(group.held)) continue
    const legacyHeld = Object.values(group.held).some(
      (output) =>
        isObject(output) &&
        output.kind === 'assignment' &&
        !('parts' in output),
    )
    if (!legacyHeld) continue
    group.held = {}
    if (group.status === 'open') {
      group.status = 'invalidated'
      group.statusReason =
        'Saved before archetype parts; start a fresh run of Archetype modeling.'
    }
  }

  return {
    ...state,
    archetypes: migrated,
    parts,
    schedules,
    rules,
    ruleIds,
    buildings: savedBuildings,
    overrides,
    pendingEdits: pending,
    runGroups: groups,
  }
}
