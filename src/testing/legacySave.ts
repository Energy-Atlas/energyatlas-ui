import { ARCHETYPE_LIBRARY } from '../domain/archetypes/library.ts'
import type { BuildingParts, WorkbenchState } from '../domain/types.ts'

// Test helper: a save as it was before archetype parts (decision 0032).

const OLD_EUI: Record<string, number> = {
  'archetype:residential-pre-1980': 165,
  'archetype:residential-1980-on': 115,
  'archetype:office': 210,
  'archetype:retail': 240,
  'archetype:school': 140,
}

export type LegacySave = Record<string, unknown> & {
  archetypes: Record<string, Record<string, unknown>>
  runGroups: Record<string, Record<string, unknown>>
}

/**
 * Archetypes with one intensity and a schedule, one archetype per building,
 * manual archetype overrides (one of them "none"), and no parts or rules.
 * Retail is an edited library copy: the old schema merged the saved values
 * over the library entry, so it kept the library id with its own schedule.
 */
export function legacySave(state: WorkbenchState): LegacySave {
  const archetypeOf = (parts: BuildingParts): string | null => {
    const match = ARCHETYPE_LIBRARY.find(
      (entry) =>
        entry.parts.construction === parts.construction?.partId &&
        entry.parts.systems === parts.systems?.partId,
    )
    return match && match.id in state.archetypes ? match.id : null
  }
  const buildings = Object.fromEntries(
    Object.entries(state.buildings).map(([id, building]) => {
      const { parts, ...rest } = building
      return [id, { ...rest, archetypeId: archetypeOf(parts) }]
    }),
  )
  const archetypes: Record<string, Record<string, unknown>> = {}
  for (const [id, archetype] of Object.entries(state.archetypes)) {
    const loads = state.parts[archetype.parts.spaceLoads ?? '']
    archetypes[id] = {
      id,
      name: archetype.name,
      use: archetype.use,
      yearFrom: archetype.yearFrom,
      yearTo: archetype.yearTo,
      euiKwhPerM2: OLD_EUI[id] ?? 150,
      scheduleId: loads?.kind === 'spaceLoads' ? loads.scheduleId : null,
      source: archetype.source,
    }
  }
  const retail = archetypes['archetype:retail']
  if (retail) {
    archetypes['archetype:retail'] = {
      ...retail,
      euiKwhPerM2: 225,
      scheduleId: 'schedule:office',
      source: {
        kind: 'project',
        operationId: 'op-89',
        libraryId: 'archetype:retail',
      },
    }
  }
  archetypes['archetype-90'] = {
    id: 'archetype-90',
    name: 'Night office',
    use: 'office',
    yearFrom: null,
    yearTo: null,
    euiKwhPerM2: 200,
    scheduleId: 'schedule:residential',
    source: { kind: 'project', operationId: 'op-90' },
  }
  const overrides = {
    'B0001:archetypeId': {
      entityId: 'B0001',
      field: 'archetypeId',
      value: 'archetype:school',
      operationId: 'op-91',
      source: 'manual',
    },
    'B0002:archetypeId': {
      entityId: 'B0002',
      field: 'archetypeId',
      value: null,
      operationId: 'op-92',
      source: 'manual',
    },
  }
  const copy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
  delete copy.parts
  delete copy.rules
  delete copy.ruleIds
  return {
    ...copy,
    buildings,
    archetypes,
    overrides,
    runGroups: JSON.parse(JSON.stringify(state.runGroups)) as Record<
      string,
      Record<string, unknown>
    >,
  }
}
