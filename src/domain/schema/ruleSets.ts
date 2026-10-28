import { z } from 'zod'
import { recognise, type TargetSpec } from '../mapping/mapping.ts'
import type {
  RuleSetMapping,
  SchemaMatchingState,
  SchemaRuleSet,
  WorkbenchState,
} from '../types.ts'
import { sourceCollection } from './matching.ts'
import {
  CUSTOM_PREFIX,
  SCHEMA_TARGETS,
  customNameIssue,
  customTarget,
} from './registry.ts'

// Schema matching rule sets in RC's shape, `{version, mappings[{target,
// source, tier, transform}]}` (SchemaMatchingController.cs at 7464c140),
// plus the value maps of enumerated targets. RC keeps one rule set file per
// user; the demo keeps named rule sets with the project and moves one
// between projects as a file. Loading checks every entry against the
// registry and the source collection and skips, with a reason, what does not
// exist.

const tierSchema = z.enum(['compulsory', 'computed', 'optional', 'custom'])

export const ruleSetFileSchema = z.object({
  version: z.literal(1, 'Only rule sets of version 1 can be loaded.'),
  name: z.string().trim().min(1).max(80).optional(),
  mappings: z
    .array(
      z.object({
        target: z.string().min(1, 'Every mapping names a target.'),
        source: z.string().min(1, 'Every mapping names a source.'),
        tier: tierSchema.optional(),
        transform: z.string().nullable().optional(),
      }),
    )
    .max(200, 'A rule set has at most 200 mappings.'),
  valueMaps: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

export type RuleSetFile = z.output<typeof ruleSetFileSchema>

/** The current mapping as a rule set entry list, in registry order. */
export function currentMappings(
  matching: Pick<SchemaMatchingState, 'mapping' | 'customTargets'>,
): RuleSetMapping[] {
  const targets: TargetSpec[] = [
    ...SCHEMA_TARGETS,
    ...matching.customTargets.map(customTarget),
  ]
  return targets.flatMap((target) => {
    const source = matching.mapping[target.id]
    return source
      ? [{ target: target.id, source, tier: target.tier, transform: null }]
      : []
  })
}

/** A rule set as the file RC's shape describes. */
export function ruleSetFile(ruleSet: SchemaRuleSet): string {
  const file: RuleSetFile = {
    version: 1,
    name: ruleSet.name,
    mappings: ruleSet.mappings,
    valueMaps: ruleSet.valueMaps,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Reads a rule set file; the reason is written for the person who chose it. */
export function parseRuleSetFile(
  text: string,
): { ok: true; file: RuleSetFile } | { ok: false; message: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'The file is not JSON.' }
  }
  const parsed = ruleSetFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      message: `The file is not a rule set: ${issue?.message ?? 'its shape is not recognised'}.`,
    }
  }
  return { ok: true, file: parsed.data }
}

export type RuleSetCheck = {
  /** Entries that load, one per target. */
  applicable: RuleSetMapping[]
  customTargets: string[]
  valueMaps: Record<string, Record<string, string>>
  /** Why other entries are skipped, one line each. */
  skipped: string[]
}

/**
 * Which entries of a rule set this project can load: targets the registry
 * has (or custom names), sources the collection has, no transform, and one
 * source per target. Value maps keep only allowed names.
 */
export function checkRuleSet(
  state: WorkbenchState,
  file: Pick<RuleSetFile, 'mappings' | 'valueMaps'>,
): RuleSetCheck {
  const sources = new Set(sourceCollection(state).names)
  const check: RuleSetCheck = {
    applicable: [],
    customTargets: [],
    valueMaps: {},
    skipped: [],
  }
  const seen = new Set<string>()
  for (const entry of file.mappings) {
    let target: TargetSpec | undefined = SCHEMA_TARGETS.find(
      (candidate) => candidate.id === entry.target,
    )
    if (!target && entry.target.startsWith(CUSTOM_PREFIX)) {
      const name = entry.target.slice(CUSTOM_PREFIX.length)
      const issue = customNameIssue(check.customTargets, name)
      if (issue) {
        check.skipped.push(`Custom target "${name}": ${issue}`)
        continue
      }
      target = customTarget(name)
    }
    if (!target) {
      check.skipped.push(
        `"${entry.target}" is not a target field of this model.`,
      )
      continue
    }
    if (seen.has(target.id)) {
      check.skipped.push(
        `${target.label} is mapped twice; only the first mapping loads.`,
      )
      continue
    }
    if (entry.transform) {
      check.skipped.push(
        `${target.label}: transforms are not supported (transform_not_supported), so "${entry.transform}" is skipped.`,
      )
      continue
    }
    if (!sources.has(entry.source)) {
      check.skipped.push(
        `${target.label}: "${entry.source}" is not an attribute of the captured footprints.`,
      )
      continue
    }
    seen.add(target.id)
    check.applicable.push({
      target: target.id,
      source: entry.source,
      tier: target.tier,
      transform: null,
    })
    if (target.tier === 'custom') check.customTargets.push(target.label)
  }
  for (const [targetId, map] of Object.entries(file.valueMaps ?? {})) {
    const target = SCHEMA_TARGETS.find((candidate) => candidate.id === targetId)
    if (!target || target.type !== 'enum') {
      check.skipped.push(
        `Value map for "${targetId}" skipped: it is not an enumerated target.`,
      )
      continue
    }
    const kept: Record<string, string> = {}
    for (const [value, to] of Object.entries(map)) {
      const allowed = recognise(target, to)
      if (allowed) kept[value] = allowed
      else
        check.skipped.push(
          `${target.label}: "${value}" maps to "${to}", which is not an allowed value.`,
        )
    }
    if (Object.keys(kept).length > 0) check.valueMaps[targetId] = kept
  }
  return check
}
