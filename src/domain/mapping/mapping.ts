import type { ValidationIssue } from '../commands.ts'
import type { LngLat } from '../types.ts'

// Attribute mapping shared by Schema matching and Data intake (decision 0032,
// stage 4). Target fields come in RC's tiers; each target takes at most one
// source attribute; suggestions wait for review; values are read by the
// target's type, enumerated values are checked against the allowed names, and
// units are reported but never converted, as in RC
// (SchemaMatchingController.cs:30-81, 666-812 at 7464c140). Pure, no React.

export type MappingTier = 'compulsory' | 'computed' | 'optional' | 'custom'

export const MAPPING_TIERS: readonly MappingTier[] = [
  'compulsory',
  'computed',
  'optional',
  'custom',
]

export const TIER_LABELS: Record<MappingTier, string> = {
  compulsory: 'Compulsory',
  computed: 'Computed (overrides)',
  optional: 'Optional',
  custom: 'Custom',
}

export type TargetType =
  'identifier' | 'text' | 'enum' | 'year' | 'integer' | 'number' | 'geometry'

/** One field of the model a source attribute can be mapped to. */
export type TargetSpec = {
  id: string
  label: string
  tier: MappingTier
  /** Optional targets are grouped, as RC groups them. */
  group?: string
  type: TargetType
  /** Reported with the target; values are never converted. */
  unit?: string
  /** Compulsory targets block the run until they are mapped. */
  required: boolean
  /** What a building gets when the target is unmapped or a value is missing. */
  fallback: string
  description: string
  /** Allowed names of an enumerated target. */
  allowed?: readonly string[]
  /** Other spellings recognised without a value map, such as codes. */
  aliases?: Readonly<Record<string, string>>
  /** Inclusive range of a numeric target. */
  range?: { min: number; max: number }
  /** Longest text, for text targets. */
  maxLength?: number
  /** Source names that suggest this target. */
  synonyms: readonly string[]
}

export type SourceValue = string | number | null | LngLat[]

export type SourceType =
  'identifier' | 'integer' | 'number' | 'category' | 'text' | 'geometry'

/** One attribute of the source collection, profiled from its values. */
export type SourceAttribute = {
  name: string
  type: SourceType
  /** The first value present, as text. */
  example: string | null
  present: number
  missing: number
  distinct: number
}

/** One bar of a value distribution. */
export type Bucket = { label: string; count: number }

/** Target id to source attribute name; absent or null is unmapped. */
export type TargetMapping = Record<string, string | null | undefined>

export type Suggestion = {
  source: string
  /** 0 to 1; 1 is a known name. */
  score: number
  reason: string
}

export type Suggestions = Record<string, Suggestion>

/** A recognised value of an enumerated target mapped from a source value. */
export type ValueMap = Record<string, string>

export function isPresent(value: SourceValue | undefined): boolean {
  return value !== null && value !== undefined && value !== ''
}

/** How a value reads in examples and distributions. */
export function valueText(value: SourceValue | undefined): string {
  if (!isPresent(value)) return ''
  if (Array.isArray(value)) return `ring of ${value.length} points`
  return String(value).trim()
}

const INTEGER = /^-?\d+$/
const NUMBER = /^-?\d+(\.\d+)?$/

function numberOf(value: SourceValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && NUMBER.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}

/** Infers a source attribute's type, example, and counts from its values. */
export function profileSource(
  name: string,
  values: readonly (SourceValue | undefined)[],
): SourceAttribute {
  const present = values.filter(isPresent)
  const texts = present.map(valueText)
  const distinct = new Set(texts).size
  let type: SourceType = 'text'
  if (present.length > 0 && present.every((value) => Array.isArray(value))) {
    type = 'geometry'
  } else if (
    present.length > 0 &&
    present.every((value) =>
      typeof value === 'number'
        ? Number.isInteger(value)
        : typeof value === 'string' && INTEGER.test(value.trim()),
    )
  ) {
    type = 'integer'
  } else if (present.length > 0 && present.every((v) => numberOf(v) !== null)) {
    type = 'number'
  } else if (present.length > 12 && distinct >= present.length * 0.9) {
    type = 'identifier'
  } else if (distinct <= 12) {
    type = 'category'
  }
  return {
    name,
    type,
    example: texts[0] ?? null,
    present: present.length,
    missing: values.length - present.length,
    distinct,
  }
}

const TOP_VALUES = 8
const BINS = 8

/**
 * A source attribute's value distribution: counts per value for categories
 * and text (the most common first, the rest as "Other"), a histogram for
 * numbers, and the missing count last.
 */
export function distribution(
  attribute: SourceAttribute,
  values: readonly (SourceValue | undefined)[],
): Bucket[] {
  const missing: Bucket[] =
    attribute.missing > 0
      ? [{ label: 'Missing', count: attribute.missing }]
      : []
  if (attribute.type === 'geometry' || attribute.type === 'identifier') {
    return [
      {
        label: `${attribute.present} distinct values`,
        count: attribute.present,
      },
      ...missing,
    ]
  }
  if (attribute.type === 'integer' || attribute.type === 'number') {
    const numbers = values.flatMap((value) => {
      const number = numberOf(value)
      return number === null ? [] : [number]
    })
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    if (attribute.type === 'integer' && max - min < BINS) {
      const buckets: Bucket[] = []
      for (let value = min; value <= max; value += 1) {
        buckets.push({
          label: String(value),
          count: numbers.filter((number) => number === value).length,
        })
      }
      return [...buckets, ...missing]
    }
    const width = (max - min) / BINS || 1
    const digits = attribute.type === 'integer' || width >= 10 ? 0 : 1
    const buckets = Array.from({ length: BINS }, (_, index) => {
      const from = min + index * width
      return {
        label: `${from.toFixed(digits)} to ${(from + width).toFixed(digits)}`,
        count: 0,
      }
    })
    for (const number of numbers) {
      const index = Math.min(BINS - 1, Math.floor((number - min) / width))
      const bucket = buckets[index]
      if (bucket) bucket.count += 1
    }
    return [...buckets, ...missing]
  }
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!isPresent(value)) continue
    const text = valueText(value)
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  const top = sorted.slice(0, TOP_VALUES).map(([label, count]) => ({
    label,
    count,
  }))
  const rest = sorted
    .slice(TOP_VALUES)
    .reduce((sum, [, count]) => sum + count, 0)
  return [
    ...top,
    ...(rest > 0
      ? [
          {
            label: `Other (${sorted.length - TOP_VALUES} value${sorted.length - TOP_VALUES === 1 ? '' : 's'})`,
            count: rest,
          },
        ]
      : []),
    ...missing,
  ]
}

/** Lower case with separators removed: "Year_Built" and "year built" agree. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return row[b.length] ?? 0
}

/** How likely a source name is meant for a target, with the reason; null below the threshold. */
export function matchScore(
  target: TargetSpec,
  source: string,
): Suggestion | null {
  const name = source.trim().toLowerCase()
  if (target.synonyms.includes(name)) {
    return { source, score: 1, reason: 'a known name for this field' }
  }
  const normalized = normalizeName(source)
  const candidates = [target.id, target.label, ...target.synonyms].map(
    normalizeName,
  )
  if (candidates.includes(normalized)) {
    return { source, score: 0.95, reason: 'the same name' }
  }
  let best = 0
  for (const candidate of candidates) {
    if (candidate.length < 3 || normalized.length < 3) continue
    const length = Math.max(candidate.length, normalized.length)
    best = Math.max(best, 1 - editDistance(candidate, normalized) / length)
  }
  return best >= 0.75
    ? {
        source,
        score: Math.round(best * 100) / 100,
        reason: `a similar name (${Math.round(best * 100)}% alike)`,
      }
    : null
}

/**
 * RC's "Fuzzy Match All": a source for each unmapped target that has a likely
 * one, best matches first, each source suggested once. Suggestions wait for
 * review; nothing is mapped until they are accepted.
 */
export function suggestMatches(
  targets: readonly TargetSpec[],
  sources: readonly string[],
  mapping: TargetMapping,
): Suggestions {
  const used = new Set(
    Object.values(mapping).filter(
      (source): source is string => typeof source === 'string',
    ),
  )
  const candidates: { target: string; suggestion: Suggestion }[] = []
  for (const target of targets) {
    if (target.tier === 'custom' || mapping[target.id]) continue
    for (const source of sources) {
      if (used.has(source)) continue
      const suggestion = matchScore(target, source)
      if (suggestion) candidates.push({ target: target.id, suggestion })
    }
  }
  candidates.sort((a, b) => b.suggestion.score - a.suggestion.score)
  const suggestions: Suggestions = {}
  const taken = new Set<string>()
  for (const { target, suggestion } of candidates) {
    if (suggestions[target] || taken.has(suggestion.source)) continue
    suggestions[target] = suggestion
    taken.add(suggestion.source)
  }
  return suggestions
}

export type ReadResult =
  | { status: 'value'; value: string | number }
  | { status: 'missing' }
  | { status: 'invalid'; text: string }
  | { status: 'unrecognised'; text: string }

/** The allowed name an enumerated value means, through aliases and the value map. */
export function recognise(
  target: TargetSpec,
  text: string,
  valueMap: ValueMap = {},
): string | null {
  const key = text.trim().toLowerCase()
  const allowed = target.allowed ?? []
  if (allowed.includes(key)) return key
  const alias = target.aliases?.[key]
  if (alias) return alias
  const mapped = valueMap[text.trim()]
  return mapped && allowed.includes(mapped) ? mapped : null
}

/** Reads one source value as the target's type; RC copies values and supports no transforms. */
export function readValue(
  target: TargetSpec,
  value: SourceValue | undefined,
  valueMap?: ValueMap,
): ReadResult {
  if (!isPresent(value)) return { status: 'missing' }
  const text = valueText(value)
  switch (target.type) {
    case 'enum': {
      const recognised = recognise(target, text, valueMap)
      return recognised
        ? { status: 'value', value: recognised }
        : { status: 'unrecognised', text }
    }
    case 'year':
    case 'integer': {
      const number = numberOf(value)
      const range = target.range
      return number !== null &&
        Number.isInteger(number) &&
        (!range || (number >= range.min && number <= range.max))
        ? { status: 'value', value: number }
        : { status: 'invalid', text }
    }
    case 'number': {
      const number = numberOf(value)
      const range = target.range
      return number !== null &&
        (!range || (number >= range.min && number <= range.max))
        ? { status: 'value', value: number }
        : { status: 'invalid', text }
    }
    case 'geometry':
      return Array.isArray(value)
        ? { status: 'value', value: text }
        : { status: 'invalid', text }
    case 'identifier':
    case 'text':
      if (Array.isArray(value)) return { status: 'invalid', text }
      return target.maxLength && text.length > target.maxLength
        ? { status: 'invalid', text: `${text.slice(0, 24)}…` }
        : { status: 'value', value: text }
  }
}

/** What reading a mapped source gives a target, over every record. */
export type TargetCheck = {
  target: string
  source: string
  records: number
  valid: number
  missing: number
  invalid: number
  invalidExamples: string[]
  /** Enumerated values that are not allowed names, most common first. */
  unrecognised: { value: string; count: number }[]
  /**
   * Every value of an enumerated target that is not an allowed name, with
   * how it is read: through an alias, a value map, or not at all.
   */
  enumValues: EnumValue[]
}

export type EnumValue = {
  value: string
  count: number
  readAs: string | null
  via: 'alias' | 'map' | null
}

const EXAMPLES = 3

export function checkTarget(
  target: TargetSpec,
  source: string,
  values: readonly (SourceValue | undefined)[],
  valueMap?: ValueMap,
): TargetCheck {
  const check: TargetCheck = {
    target: target.id,
    source,
    records: values.length,
    valid: 0,
    missing: 0,
    invalid: 0,
    invalidExamples: [],
    unrecognised: [],
    enumValues: [],
  }
  const unrecognised = new Map<string, number>()
  const others = new Map<string, number>()
  for (const value of values) {
    const result = readValue(target, value, valueMap)
    if (target.type === 'enum' && isPresent(value)) {
      const text = valueText(value)
      if (!(target.allowed ?? []).includes(text.toLowerCase())) {
        others.set(text, (others.get(text) ?? 0) + 1)
      }
    }
    if (result.status === 'value') check.valid += 1
    else if (result.status === 'missing') check.missing += 1
    else if (result.status === 'invalid') {
      check.invalid += 1
      if (
        check.invalidExamples.length < EXAMPLES &&
        !check.invalidExamples.includes(result.text)
      )
        check.invalidExamples.push(result.text)
    } else {
      unrecognised.set(result.text, (unrecognised.get(result.text) ?? 0) + 1)
    }
  }
  check.unrecognised = [...unrecognised.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }))
  check.enumValues = [...others.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => {
      const alias = target.aliases?.[value.toLowerCase()]
      const mapped = valueMap?.[value]
      return alias
        ? { value, count, readAs: alias, via: 'alias' as const }
        : mapped && (target.allowed ?? []).includes(mapped)
          ? { value, count, readAs: mapped, via: 'map' as const }
          : { value, count, readAs: null, via: null }
    })
  return check
}

/** Every unrecognised record of a check. */
export function unrecognisedCount(check: TargetCheck): number {
  return check.unrecognised.reduce((sum, entry) => sum + entry.count, 0)
}

/**
 * Blocking problems on the target they concern (`targets.<id>`): a mapped
 * source the collection does not have, and compulsory targets that are
 * unmapped or only suggested.
 */
export function targetIssues(
  targets: readonly TargetSpec[],
  sources: readonly string[],
  mapping: TargetMapping,
  suggestions: Suggestions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const known = new Set(sources)
  for (const target of targets) {
    const source = mapping[target.id]
    if (source && !known.has(source)) {
      issues.push({
        path: `targets.${target.id}`,
        message: `"${source}" is not an attribute of this source. Choose another attribute.`,
      })
    } else if (!source && target.required) {
      const suggestion = suggestions[target.id]
      issues.push({
        path: `targets.${target.id}`,
        message: suggestion
          ? `${target.label} is compulsory: accept or replace the suggested "${suggestion.source}".`
          : `${target.label} is compulsory: choose the attribute that holds it.`,
      })
    }
  }
  return issues
}

/** RC's Next blocker: "n compulsory rule(s) invalid or missing", or null. */
export function compulsoryBlocker(
  targets: readonly TargetSpec[],
  sources: readonly string[],
  mapping: TargetMapping,
  suggestions: Suggestions = {},
): string | null {
  const known = new Set(sources)
  const failing = targets.filter((target) => {
    if (!target.required) return false
    const source = mapping[target.id]
    return !source || !known.has(source)
  })
  if (failing.length === 0) return null
  const pending = failing.filter((target) => suggestions[target.id]).length
  return `${failing.length} compulsory field${failing.length === 1 ? ' is' : 's are'} missing or invalid: ${failing.map((target) => target.label).join(', ')}.${pending > 0 ? ` Review ${pending === 1 ? 'its suggestion' : 'their suggestions'} first.` : ''}`
}

/** The kind of value a target takes, for labels: "Year (1600 to 2030)". */
export function describeTargetType(target: TargetSpec): string {
  const number = (value: number) =>
    target.type === 'year' ? String(value) : value.toLocaleString('en-US')
  const range = target.range
    ? ` (${number(target.range.min)} to ${number(target.range.max)}${target.unit ? ` ${target.unit}` : ''})`
    : target.unit
      ? ` (${target.unit})`
      : ''
  switch (target.type) {
    case 'enum':
      return `One of ${(target.allowed ?? []).join(', ')}`
    case 'year':
      return `Year${range}`
    case 'integer':
      return `Whole number${range}`
    case 'number':
      return `Number${range}`
    case 'identifier':
      return 'Identifier'
    case 'geometry':
      return 'Footprint ring'
    case 'text':
      return target.maxLength
        ? `Text, up to ${target.maxLength} characters`
        : 'Text'
  }
}
