import type { TargetSpec } from '../mapping/mapping.ts'
import type { SchemaMatchingState } from '../types.ts'

// The model fields Schema matching maps source attributes to, in RC's tiers
// (SchemaMatchingController.cs:30-81 at 7464c140). RC's compulsory targets
// are SelectForSim, YearBuilt, and BldgHeight; the demo simulates every
// building and derives height from floors, so it requires Use (which the
// archetype rules need), Year built, and Floors, and offers height and floor
// area as computed values a mapping overrides.

export const USE_VALUES = [
  'residential',
  'office',
  'retail',
  'school',
  'mixed',
] as const

/** RC-like use codes, recognised without a value map. */
export const USE_ALIASES: Readonly<Record<string, string>> = {
  res: 'residential',
  off: 'office',
  ret: 'retail',
  sch: 'school',
  mix: 'mixed',
}

export const SCHEMA_TARGETS: readonly TargetSpec[] = [
  {
    id: 'use',
    label: 'Use',
    tier: 'compulsory',
    type: 'enum',
    required: true,
    allowed: USE_VALUES,
    aliases: USE_ALIASES,
    fallback:
      'A building without a recognised value keeps its use from Geospatial data enriching.',
    description:
      'Building use for the archetype rules: residential, office, retail, school, or mixed (or RES, OFF, RET, SCH, MIX). Map other values to these.',
    synonyms: ['building', 'building_use', 'use', 'use_code', 'landuse'],
  },
  {
    id: 'yearBuilt',
    label: 'Year built',
    tier: 'compulsory',
    type: 'year',
    required: true,
    range: { min: 1600, max: 2030 },
    fallback:
      'A building without a valid year keeps its year from Geospatial data enriching.',
    description: 'Whole year of construction, from 1600 to 2030.',
    synonyms: [
      'start_date',
      'year_built',
      'yr_built',
      'construction_year',
      'year',
    ],
  },
  {
    id: 'floors',
    label: 'Floors',
    tier: 'compulsory',
    type: 'integer',
    required: true,
    range: { min: 1, max: 60 },
    fallback:
      'A building without a valid count keeps its floors from Geospatial data enriching.',
    description:
      'Number of storeys above ground, from 1 to 60. Preprocessing derives height and floor area from it.',
    synonyms: ['building:levels', 'levels', 'floors', 'stories', 'storeys'],
  },
  {
    id: 'heightM',
    label: 'Height',
    tier: 'computed',
    type: 'number',
    unit: 'm',
    required: false,
    range: { min: 1, max: 400 },
    fallback: 'Geospatial preprocessing computes 3.2 m per floor.',
    description:
      'Building height in metres; a mapped value replaces the computed one. Values are read as metres and never converted.',
    synonyms: ['height', 'building:height', 'bldg_height', 'height_m'],
  },
  {
    id: 'floorAreaM2',
    label: 'Floor area',
    tier: 'computed',
    type: 'number',
    unit: 'm²',
    required: false,
    range: { min: 1, max: 1_000_000 },
    fallback:
      'Geospatial preprocessing computes the footprint area times the floors.',
    description:
      'Gross floor area in square metres; a mapped value replaces the computed one.',
    synonyms: ['floor_area', 'gross_floor_area', 'gfa', 'floor_area_m2'],
  },
  {
    id: 'name',
    label: 'Name',
    tier: 'optional',
    group: 'Identity',
    type: 'text',
    required: false,
    maxLength: 80,
    fallback: 'A building without a name keeps "Building" and its number.',
    description: 'Building name, up to 80 characters.',
    synonyms: ['name', 'building_name'],
  },
]

/** A plain copy of value maps; works on Immer drafts, which structuredClone cannot copy. */
export function copyValueMaps(
  maps: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(maps).map(([target, map]) => [target, { ...map }]),
  )
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Whether two mappings apply the same targets, custom targets, and value maps. */
export function sameMappingConfig(
  a: Pick<SchemaMatchingState, 'mapping' | 'customTargets' | 'valueMaps'>,
  b: Pick<SchemaMatchingState, 'mapping' | 'customTargets' | 'valueMaps'>,
): boolean {
  return (
    canonical(a.mapping) === canonical(b.mapping) &&
    canonical(a.customTargets) === canonical(b.customTargets) &&
    canonical(a.valueMaps) === canonical(b.valueMaps)
  )
}

export const CUSTOM_PREFIX = 'custom:'

export function customTargetId(name: string): string {
  return `${CUSTOM_PREFIX}${name}`
}

/** A user-named target that copies a source attribute as text, as RC's Custom tab does. */
export function customTarget(name: string): TargetSpec {
  return {
    id: customTargetId(name),
    label: name,
    tier: 'custom',
    type: 'text',
    required: false,
    maxLength: 200,
    fallback: 'Buildings without a value have none.',
    description:
      'Copied as text and kept with the building; no model calculation reads it.',
    synonyms: [],
  }
}

/** The registry plus the project's custom targets. */
export function schemaTargets(
  matching: Pick<SchemaMatchingState, 'customTargets'>,
): TargetSpec[] {
  return [...SCHEMA_TARGETS, ...matching.customTargets.map(customTarget)]
}

export function findSchemaTarget(
  matching: Pick<SchemaMatchingState, 'customTargets'>,
  id: string,
): TargetSpec | null {
  return schemaTargets(matching).find((target) => target.id === id) ?? null
}

/** Custom names: a letter first, then letters, digits, and _ : . -, up to 40. */
export const CUSTOM_NAME = /^[A-Za-z][A-Za-z0-9_:.-]{0,39}$/

/**
 * Why a custom target cannot have this name, or null: the pattern, and no
 * clash, ignoring case, with a model field or another custom target. Adding
 * a target and loading a rule set share it.
 */
export function customNameIssue(
  customTargets: readonly string[],
  name: string,
): string | null {
  if (!CUSTOM_NAME.test(name)) {
    return 'Start with a letter; use letters, digits, and _ : . - up to 40 characters.'
  }
  const lower = name.toLowerCase()
  const taken =
    customTargets.some((item) => item.toLowerCase() === lower) ||
    SCHEMA_TARGETS.some(
      (target) =>
        target.id.toLowerCase() === lower ||
        target.label.toLowerCase() === lower,
    )
  return taken ? `A target field named "${name}" already exists.` : null
}

/** The name of the built-in rule set every project starts from. */
export const BUILT_IN_RULE_SET = 'OSM building tags (built in)'

/**
 * A new project's mapping: the built-in rule set maps the compulsory targets
 * and recognises common OpenStreetMap building values, as RC loads its saved
 * rule set; the other likely matches wait for review.
 */
export function createSchemaMatching(): SchemaMatchingState {
  return {
    mapping: {
      use: 'building',
      yearBuilt: 'start_date',
      floors: 'building:levels',
    },
    suggestions: {
      name: { source: 'name', score: 1, reason: 'a known name for this field' },
      heightM: {
        source: 'height',
        score: 1,
        reason: 'a known name for this field',
      },
    },
    customTargets: [],
    valueMaps: {
      use: {
        apartments: 'residential',
        house: 'residential',
        commercial: 'office',
        university: 'school',
      },
    },
    ruleSets: {},
    ruleSetIds: [],
    loadedFrom: BUILT_IN_RULE_SET,
    published: null,
  }
}
