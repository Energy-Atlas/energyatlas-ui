import type {
  Building,
  BuildingUse,
  ConditionField,
  ConditionOperator,
  RuleLogic,
} from '../types.ts'

// Assignment rules shared by archetype rules (decision 0032, stage 2) and
// scenario rules (stage 3). The shape follows RC's rule DTO
// (TemplateAssignmentController.cs:2143-2169): a name, enabled, logic all /
// any / none, conditions of field, operator, and value, and one value per
// slot. Rules are tried in list order, top first; each slot takes the first
// enabled matching rule that sets it (TemplateAssignment.cs:151-192), so one
// subject's slots can come from different rules.
//
// Nothing here is tied to buildings or archetype parts: callers pass the
// field registry the conditions use and the noun for a slot ("part",
// "measure"). The building fields are one such registry.

export type FieldType = 'number' | 'enum' | 'text'

export type ConditionFieldDefinition<Field extends string = string> = {
  id: Field
  label: string
  type: FieldType
  /** Enumerated values with labels, for enum fields. */
  options?: { value: string; label: string }[]
  unit?: string
}

/** The fields a set of conditions may test, in the order a builder offers them. */
export type FieldRegistry<Field extends string = string> =
  readonly ConditionFieldDefinition<Field>[]

/** One condition; a blank one (no field) is dropped when rules are evaluated. */
export type Condition<Field extends string = string> = {
  field: Field | null
  operator: ConditionOperator
  value: string
}

/** The attributes conditions read; a missing value never matches. */
export type ConditionSubject<Field extends string = string> = Record<
  Field,
  string | number | null
>

const USE_OPTIONS: { value: BuildingUse; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'school', label: 'School' },
  { value: 'mixed', label: 'Mixed use' },
]

/** Building attributes, the registry archetype (and scenario) rules use. */
export const CONDITION_FIELDS: FieldRegistry<ConditionField> = [
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

/** A field's definition in a registry, or undefined when it has none. */
export function fieldDefinition<Field extends string>(
  fields: FieldRegistry<Field>,
  field: Field,
): ConditionFieldDefinition<Field> | undefined {
  return fields.find((definition) => definition.id === field)
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

export function buildingSubject(
  building: Building,
): ConditionSubject<ConditionField> {
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

export function isBlank(condition: Condition): boolean {
  return condition.field === null
}

/** Whether two condition lists are the same, values compared trimmed as rules save them. */
export function sameConditions<Field extends string>(
  a: readonly Condition<Field>[],
  b: readonly Condition<Field>[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (condition, index) =>
        condition.field === b[index]?.field &&
        condition.operator === b[index]?.operator &&
        condition.value.trim() === b[index]?.value.trim(),
    )
  )
}

/** Whether a rule matches every subject: it has no conditions with a field. */
export function isCatchAll(conditions: readonly Condition[]): boolean {
  return conditions.every(isBlank)
}

/**
 * Why a condition with a field cannot be saved, or null. Blank conditions (no
 * field) are allowed and dropped when rules are evaluated, as in RC.
 */
export function conditionIssue<Field extends string>(
  fields: FieldRegistry<Field>,
  condition: Condition<Field>,
): { path: 'field' | 'operator' | 'value'; message: string } | null {
  if (condition.field === null) return null
  const definition = fieldDefinition(fields, condition.field)
  if (!definition) {
    return { path: 'field', message: 'Choose a field from the list.' }
  }
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
 * Whether a subject's attribute meets one complete condition. As in RC
 * (GISSelection.cs), a missing value never matches, text compares without
 * case, and larger and smaller are strict.
 */
export function conditionMatches<Field extends string>(
  fields: FieldRegistry<Field>,
  condition: Condition<Field>,
  subject: ConditionSubject<Field>,
): boolean {
  if (condition.field === null) return false
  const actual = subject[condition.field]
  const definition = fieldDefinition(fields, condition.field)
  if (actual === null || actual === undefined || !definition) return false
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
export function conditionsMatch<Field extends string>(
  fields: FieldRegistry<Field>,
  logic: RuleLogic,
  conditions: Condition<Field>[],
  subject: ConditionSubject<Field>,
): boolean {
  if (conditions.length === 0) return true
  const results = conditions.map((condition) =>
    conditionMatches(fields, condition, subject),
  )
  if (logic === 'any') return results.some(Boolean)
  if (logic === 'none') return !results.some(Boolean)
  return results.every(Boolean)
}

/** A condition in words, such as "Year built is smaller than 1980". */
export function describeCondition<Field extends string>(
  fields: FieldRegistry<Field>,
  condition: Condition<Field>,
): string {
  if (condition.field === null) return 'Blank condition'
  const definition = fieldDefinition(fields, condition.field)
  const value =
    definition?.options?.find((option) => option.value === condition.value)
      ?.label ?? condition.value
  return `${definition?.label ?? condition.field} ${OPERATOR_LABELS[condition.operator]} ${value}${definition?.unit ? ` ${definition.unit}` : ''}`
}

/** A rule's conditions in one line, for lists; `everything` names a rule without conditions. */
export function describeConditions<Field extends string>(
  fields: FieldRegistry<Field>,
  logic: RuleLogic,
  conditions: Condition<Field>[],
  everything = 'Every building',
): string {
  const complete = conditions.filter((condition) => !isBlank(condition))
  if (complete.length === 0) {
    return conditions.length === 0 ? everything : 'Only blank conditions'
  }
  const joined = complete.map((condition) =>
    describeCondition(fields, condition),
  )
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
export type RuleLike<Slot extends string, Field extends string = string> = {
  id: string
  name: string
  enabled: boolean
  logic: RuleLogic
  conditions: Condition<Field>[]
  /** The value each slot gets from the rule; null leaves it to later rules. */
  slots: Record<Slot, string | null>
}

export type PreparedRule<Slot extends string, Field extends string = string> = {
  id: string
  name: string
  logic: RuleLogic
  conditions: Condition<Field>[]
  slots: Partial<Record<Slot, string>>
}

/**
 * The enabled rules evaluation tries, in order, with RC's warnings: a rule
 * whose conditions are all blank is skipped (a half-filled rule is not a
 * catch-all), a rule with some blank conditions applies without them, and a
 * slot whose value no longer exists is left to later rules. `noun` names a
 * slot in the warnings, such as "part" or "measure".
 */
export function prepareRules<Slot extends string, Field extends string>(
  rules: RuleLike<Slot, Field>[],
  slots: readonly Slot[],
  exists: (slot: Slot, value: string) => boolean,
  noun: string,
): { prepared: PreparedRule<Slot, Field>[]; warnings: RuleWarning[] } {
  const warnings: RuleWarning[] = []
  const prepared: PreparedRule<Slot, Field>[] = []
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
          message: `"${rule.name}" sets "${value}", which no longer exists; later rules decide that ${noun}.`,
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
export function firstMatches<Slot extends string, Field extends string>(
  fields: FieldRegistry<Field>,
  prepared: PreparedRule<Slot, Field>[],
  slots: readonly Slot[],
  subject: ConditionSubject<Field>,
): { winners: Record<Slot, SlotWinner | null>; matched: string[] } {
  const winners = Object.fromEntries(
    slots.map((slot) => [slot, null]),
  ) as Record<Slot, SlotWinner | null>
  const matched: string[] = []
  for (const rule of prepared) {
    if (!conditionsMatch(fields, rule.logic, rule.conditions, subject)) continue
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
