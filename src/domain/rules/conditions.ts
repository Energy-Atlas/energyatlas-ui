import type {
  Building,
  BuildingUse,
  ConditionField,
  ConditionOperator,
  RuleCondition,
  RuleLogic,
} from '../types.ts'

// Assignment rules shared by archetype rules (decision 0032, stage 2) and
// scenario rules (stage 3). The shape follows RC's rule DTO
// (TemplateAssignmentController.cs:2143-2169): a name, enabled, logic all /
// any / none, conditions of field, operator, and value, and one value per
// slot. Rules are tried in list order, top first; each slot takes the first
// enabled matching rule that sets it (TemplateAssignment.cs:151-192), so one
// building's slots can come from different rules.

export type FieldType = 'number' | 'enum' | 'text'

export type ConditionFieldDefinition = {
  id: ConditionField
  label: string
  type: FieldType
  /** Enumerated values with labels, for enum fields. */
  options?: { value: string; label: string }[]
  unit?: string
}

const USE_OPTIONS: { value: BuildingUse; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'school', label: 'School' },
  { value: 'mixed', label: 'Mixed use' },
]

export const CONDITION_FIELDS: readonly ConditionFieldDefinition[] = [
  { id: 'use', label: 'Use', type: 'enum', options: USE_OPTIONS },
  { id: 'yearBuilt', label: 'Year built', type: 'number' },
  { id: 'floors', label: 'Floors', type: 'number' },
  { id: 'floorAreaM2', label: 'Floor area', type: 'number', unit: 'm²' },
  { id: 'heightM', label: 'Height', type: 'number', unit: 'm' },
  {
    id: 'footprintAreaM2',
    label: 'Footprint area',
    type: 'number',
    unit: 'm²',
  },
  { id: 'name', label: 'Name', type: 'text' },
]

export const CONDITION_FIELD_IDS = CONDITION_FIELDS.map(
  (field) => field.id,
) as [ConditionField, ...ConditionField[]]

export function fieldDefinition(
  field: ConditionField,
): ConditionFieldDefinition {
  return (
    CONDITION_FIELDS.find((definition) => definition.id === field) ??
    CONDITION_FIELDS[0]!
  )
}

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  larger: 'is larger than',
  smaller: 'is smaller than',
  equals: 'equals',
  contains: 'contains',
  notContains: 'does not contain',
}

export const CONDITION_OPERATORS = Object.keys(OPERATOR_LABELS) as [
  ConditionOperator,
  ...ConditionOperator[],
]

/** The operators a field type offers; RC's five, typed by field. */
export const OPERATORS_BY_TYPE: Record<FieldType, ConditionOperator[]> = {
  number: ['larger', 'smaller', 'equals'],
  enum: ['equals', 'notContains'],
  text: ['contains', 'notContains', 'equals'],
}

export const LOGIC_LABELS: Record<RuleLogic, string> = {
  all: 'all conditions match',
  any: 'any condition matches',
  none: 'no condition matches',
}

/** The attributes conditions read; a missing value never matches. */
export type ConditionSubject = Record<ConditionField, string | number | null>

export function buildingSubject(building: Building): ConditionSubject {
  return {
    use: building.use,
    yearBuilt: building.yearBuilt,
    floors: building.floors,
    floorAreaM2: building.floorAreaM2,
    heightM: building.heightM,
    footprintAreaM2: building.footprintAreaM2,
    name: building.name,
  }
}

export function isBlank(condition: RuleCondition): boolean {
  return condition.field === null
}

/**
 * Why a condition with a field cannot be saved, or null. Blank conditions (no
 * field) are allowed and dropped when rules are evaluated, as in RC.
 */
export function conditionIssue(
  condition: RuleCondition,
): { path: 'operator' | 'value'; message: string } | null {
  if (condition.field === null) return null
  const definition = fieldDefinition(condition.field)
  if (!OPERATORS_BY_TYPE[definition.type].includes(condition.operator)) {
    return {
      path: 'operator',
      message: `${definition.label} cannot use "${OPERATOR_LABELS[condition.operator]}".`,
    }
  }
  const value = condition.value.trim()
  if (value === '') {
    return { path: 'value', message: 'Enter a value, or remove the field.' }
  }
  if (definition.type === 'number' && !Number.isFinite(Number(value))) {
    return { path: 'value', message: 'Enter a number.' }
  }
  if (
    definition.type === 'enum' &&
    !definition.options?.some((option) => option.value === value)
  ) {
    return {
      path: 'value',
      message: `Choose a ${definition.label.toLowerCase()}.`,
    }
  }
  return null
}

/**
 * Whether a building attribute meets one complete condition. As in RC
 * (GISSelection.cs), a missing value never matches, text compares without
 * case, and larger and smaller are strict.
 */
export function conditionMatches(
  condition: RuleCondition,
  subject: ConditionSubject,
): boolean {
  if (condition.field === null) return false
  const actual = subject[condition.field]
  if (actual === null) return false
  const definition = fieldDefinition(condition.field)
  const expected = condition.value.trim()
  if (definition.type === 'number') {
    const number = Number(expected)
    const value = Number(actual)
    if (!Number.isFinite(number) || !Number.isFinite(value)) return false
    switch (condition.operator) {
      case 'larger':
        return value > number
      case 'smaller':
        return value < number
      case 'equals':
        return value === number
      default:
        return false
    }
  }
  const text = String(actual).toUpperCase()
  const wanted = expected.toUpperCase()
  switch (condition.operator) {
    case 'equals':
      return text === wanted
    case 'contains':
      return text.includes(wanted)
    case 'notContains':
      return !text.includes(wanted)
    default:
      return false
  }
}

/** Whether complete conditions match under a logic; none at all matches everything. */
export function conditionsMatch(
  logic: RuleLogic,
  conditions: RuleCondition[],
  subject: ConditionSubject,
): boolean {
  if (conditions.length === 0) return true
  const results = conditions.map((condition) =>
    conditionMatches(condition, subject),
  )
  if (logic === 'any') return results.some(Boolean)
  if (logic === 'none') return !results.some(Boolean)
  return results.every(Boolean)
}

/** A condition in words, such as "Year built is smaller than 1980". */
export function describeCondition(condition: RuleCondition): string {
  if (condition.field === null) return 'Blank condition'
  const definition = fieldDefinition(condition.field)
  const value =
    definition.options?.find((option) => option.value === condition.value)
      ?.label ?? condition.value
  return `${definition.label} ${OPERATOR_LABELS[condition.operator]} ${value}${definition.unit ? ` ${definition.unit}` : ''}`
}

/** A rule's conditions in one line, for lists. */
export function describeConditions(
  logic: RuleLogic,
  conditions: RuleCondition[],
): string {
  const complete = conditions.filter((condition) => !isBlank(condition))
  if (complete.length === 0) {
    return conditions.length === 0 ? 'Every building' : 'Only blank conditions'
  }
  const joined = complete.map(describeCondition)
  if (complete.length === 1) {
    return logic === 'none' ? `Not: ${joined[0]}` : (joined[0] ?? '')
  }
  if (logic === 'none') return `None of: ${joined.join('; ')}`
  return joined.join(logic === 'any' ? ' or ' : ' and ')
}

/** RC's coded evaluation warnings (TemplateAssignmentController.cs:1654-1760). */
export type RuleWarningCode =
  | 'blank_conditions_skipped'
  | 'partial_conditions_dropped'
  | 'missing_target_skipped'
  | 'no_enabled_rules'

export type RuleWarning = {
  code: RuleWarningCode
  ruleId: string | null
  message: string
}

/** The fields of a rule that evaluation reads. */
export type RuleLike<Slot extends string> = {
  id: string
  name: string
  enabled: boolean
  logic: RuleLogic
  conditions: RuleCondition[]
  /** The value each slot gets from the rule; null leaves it to later rules. */
  slots: Record<Slot, string | null>
}

export type PreparedRule<Slot extends string> = {
  id: string
  name: string
  logic: RuleLogic
  conditions: RuleCondition[]
  slots: Partial<Record<Slot, string>>
}

/**
 * The enabled rules evaluation tries, in order, with RC's warnings: a rule
 * whose conditions are all blank is skipped (a half-filled rule is not a
 * catch-all), a rule with some blank conditions applies without them, and a
 * slot whose value no longer exists is left to later rules.
 */
export function prepareRules<Slot extends string>(
  rules: RuleLike<Slot>[],
  slots: readonly Slot[],
  exists: (slot: Slot, value: string) => boolean,
): { prepared: PreparedRule<Slot>[]; warnings: RuleWarning[] } {
  const warnings: RuleWarning[] = []
  const prepared: PreparedRule<Slot>[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const complete = rule.conditions.filter((condition) => !isBlank(condition))
    const dropped = rule.conditions.length - complete.length
    if (rule.conditions.length > 0 && complete.length === 0) {
      warnings.push({
        code: 'blank_conditions_skipped',
        ruleId: rule.id,
        message: `"${rule.name}" was skipped: all of its conditions are blank.`,
      })
      continue
    }
    if (dropped > 0) {
      warnings.push({
        code: 'partial_conditions_dropped',
        ruleId: rule.id,
        message: `"${rule.name}" applies without ${dropped} blank condition${dropped === 1 ? '' : 's'}; its other conditions still apply.`,
      })
    }
    const set: Partial<Record<Slot, string>> = {}
    for (const slot of slots) {
      const value = rule.slots[slot]
      if (value === null) continue
      if (!exists(slot, value)) {
        warnings.push({
          code: 'missing_target_skipped',
          ruleId: rule.id,
          message: `"${rule.name}" sets "${value}", which no longer exists; later rules decide that part.`,
        })
        continue
      }
      set[slot] = value
    }
    prepared.push({
      id: rule.id,
      name: rule.name,
      logic: rule.logic,
      conditions: complete,
      slots: set,
    })
  }
  if (prepared.length === 0) {
    warnings.push({
      code: 'no_enabled_rules',
      ruleId: null,
      message:
        rules.length === 0
          ? 'There are no rules, so nothing is assigned by rules.'
          : 'No rule is on, so nothing is assigned by rules.',
    })
  }
  return { prepared, warnings }
}

export type SlotWinner = { value: string; ruleId: string; ruleName: string }

/**
 * Per-slot first match: each slot takes the first rule, top first, that
 * matches and sets it. Also returns every rule that matched.
 */
export function firstMatches<Slot extends string>(
  prepared: PreparedRule<Slot>[],
  slots: readonly Slot[],
  subject: ConditionSubject,
): { winners: Record<Slot, SlotWinner | null>; matched: string[] } {
  const winners = Object.fromEntries(
    slots.map((slot) => [slot, null]),
  ) as Record<Slot, SlotWinner | null>
  const matched: string[] = []
  for (const rule of prepared) {
    if (!conditionsMatch(rule.logic, rule.conditions, subject)) continue
    matched.push(rule.id)
    for (const slot of slots) {
      const value = rule.slots[slot]
      if (value !== undefined && winners[slot] === null) {
        winners[slot] = { value, ruleId: rule.id, ruleName: rule.name }
      }
    }
  }
  return { winners, matched }
}
