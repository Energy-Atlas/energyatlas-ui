import { describe, expect, test } from 'vitest'
import type { ConditionField, RuleCondition } from '../types.ts'
import {
  CONDITION_FIELDS,
  conditionIssue,
  conditionMatches,
  conditionsMatch,
  describeConditions,
  firstMatches,
  prepareRules,
  type ConditionSubject,
  type RuleLike,
} from './conditions.ts'

const subject: ConditionSubject<ConditionField> = {
  use: 'office',
  yearBuilt: 1975,
  floors: 8,
  floorAreaM2: 4200,
  heightM: 25.6,
  footprintAreaM2: 525,
  name: 'Building 12',
}

const when = (
  field: RuleCondition['field'],
  operator: RuleCondition['operator'],
  value: string,
): RuleCondition => ({ field, operator, value })

type Slot = 'a' | 'b'
const SLOTS: readonly Slot[] = ['a', 'b']

function rule(
  id: string,
  conditions: RuleCondition[],
  slots: Partial<Record<Slot, string>>,
  options: Partial<RuleLike<Slot, ConditionField>> = {},
): RuleLike<Slot, ConditionField> {
  return {
    id,
    name: id,
    enabled: true,
    logic: 'all',
    conditions,
    slots: { a: slots.a ?? null, b: slots.b ?? null },
    ...options,
  }
}

describe('conditions', () => {
  test('operators follow RC: strict numbers, case-free text, missing never matches', () => {
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('yearBuilt', 'smaller', '1980'),
        subject,
      ),
    ).toBe(true)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('yearBuilt', 'smaller', '1975'),
        subject,
      ),
    ).toBe(false)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('floors', 'larger', '7'),
        subject,
      ),
    ).toBe(true)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('floors', 'equals', '8'),
        subject,
      ),
    ).toBe(true)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('use', 'equals', 'OFFICE'),
        subject,
      ),
    ).toBe(true)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('name', 'contains', 'ing 1'),
        subject,
      ),
    ).toBe(true)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('use', 'notContains', 'residential'),
        subject,
      ),
    ).toBe(true)
    // A missing value fails every operator, does not contain included.
    const unknown = { ...subject, yearBuilt: null, use: null }
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('yearBuilt', 'smaller', '3000'),
        unknown,
      ),
    ).toBe(false)
    expect(
      conditionMatches(
        CONDITION_FIELDS,
        when('use', 'notContains', 'office'),
        unknown,
      ),
    ).toBe(false)
  })

  test('logic all, any, and none; no conditions match everything', () => {
    const yes = when('floors', 'larger', '2')
    const no = when('use', 'equals', 'school')
    expect(conditionsMatch(CONDITION_FIELDS, 'all', [yes, no], subject)).toBe(
      false,
    )
    expect(conditionsMatch(CONDITION_FIELDS, 'any', [yes, no], subject)).toBe(
      true,
    )
    expect(conditionsMatch(CONDITION_FIELDS, 'none', [no], subject)).toBe(true)
    expect(conditionsMatch(CONDITION_FIELDS, 'none', [yes, no], subject)).toBe(
      false,
    )
    expect(conditionsMatch(CONDITION_FIELDS, 'all', [], subject)).toBe(true)
    expect(conditionsMatch(CONDITION_FIELDS, 'none', [], subject)).toBe(true)
  })

  test('validates a condition by its field type, and allows blank ones', () => {
    expect(
      conditionIssue(CONDITION_FIELDS, when('floors', 'larger', 'six')),
    ).toEqual({
      path: 'value',
      message: 'Enter a number.',
    })
    expect(
      conditionIssue(CONDITION_FIELDS, when('floors', 'contains', '6'))?.path,
    ).toBe('operator')
    expect(
      conditionIssue(CONDITION_FIELDS, when('use', 'equals', 'castle'))?.path,
    ).toBe('value')
    expect(
      conditionIssue(CONDITION_FIELDS, when('name', 'contains', ' '))?.path,
    ).toBe('value')
    expect(
      conditionIssue(CONDITION_FIELDS, when(null, 'equals', '')),
    ).toBeNull()
    expect(
      conditionIssue(CONDITION_FIELDS, when('use', 'equals', 'retail')),
    ).toBeNull()
  })

  test('describes conditions in words', () => {
    expect(describeConditions(CONDITION_FIELDS, 'all', [])).toBe(
      'Every building',
    )
    expect(
      describeConditions(CONDITION_FIELDS, 'all', [
        when('use', 'equals', 'residential'),
        when('yearBuilt', 'smaller', '1980'),
      ]),
    ).toBe('Use equals Residential and Year built is smaller than 1980')
    expect(
      describeConditions(CONDITION_FIELDS, 'any', [when(null, 'equals', '')]),
    ).toBe('Only blank conditions')
  })
})

describe('rule evaluation', () => {
  test('each slot takes the first enabled matching rule that sets it', () => {
    const { prepared } = prepareRules(
      [
        rule('off', [], { a: 'never' }, { enabled: false }),
        rule('tall', [when('floors', 'larger', '5')], { b: 'tall-b' }),
        rule('office', [when('use', 'equals', 'office')], {
          a: 'office-a',
          b: 'office-b',
        }),
        rule('fallback', [], { a: 'any-a', b: 'any-b' }),
      ],
      SLOTS,
      () => true,
      'part',
    )
    const { winners, matched } = firstMatches(
      CONDITION_FIELDS,
      prepared,
      SLOTS,
      subject,
    )
    expect(winners.a).toEqual({
      value: 'office-a',
      ruleId: 'office',
      ruleName: 'office',
    })
    expect(winners.b?.ruleId).toBe('tall')
    expect(matched).toEqual(['tall', 'office', 'fallback'])
  })

  test('warns as RC does about blank conditions and missing values', () => {
    const { prepared, warnings } = prepareRules(
      [
        rule('blank', [when(null, 'equals', '')], { a: 'x' }),
        rule(
          'partial',
          [when(null, 'equals', ''), when('floors', 'larger', '100')],
          { a: 'y' },
        ),
        rule('gone', [], { a: 'missing', b: 'kept' }),
      ],
      SLOTS,
      (_, value) => value !== 'missing',
      'part',
    )
    expect(warnings.map((warning) => warning.code)).toEqual([
      'blank_conditions_skipped',
      'partial_conditions_dropped',
      'missing_target_skipped',
    ])
    expect(prepared.map((each) => each.id)).toEqual(['partial', 'gone'])
    // The partial rule keeps its real condition, which this building fails.
    const { winners } = firstMatches(CONDITION_FIELDS, prepared, SLOTS, subject)
    expect(winners.a).toBeNull()
    expect(winners.b?.value).toBe('kept')
  })

  test('says when no rule is on', () => {
    expect(prepareRules([], SLOTS, () => true, 'part').warnings[0]?.code).toBe(
      'no_enabled_rules',
    )
    expect(
      prepareRules(
        [rule('off', [], { a: 'x' }, { enabled: false })],
        SLOTS,
        () => true,
        'part',
      ).warnings[0]?.message,
    ).toMatch(/No rule is on/)
  })
})

describe('another field registry', () => {
  test('conditions, warnings, and descriptions follow the registry and noun given', () => {
    const fields = [
      {
        id: 'kind',
        label: 'Kind',
        type: 'enum' as const,
        options: [{ value: 'pv', label: 'PV' }],
      },
      { id: 'savings', label: 'Savings', type: 'number' as const, unit: '%' },
    ]
    const item = { kind: 'pv', savings: 12 }
    expect(
      conditionMatches(
        fields,
        { field: 'savings', operator: 'larger', value: '10' },
        item,
      ),
    ).toBe(true)
    expect(
      conditionIssue(fields, {
        field: 'kind',
        operator: 'equals',
        value: 'wind',
      })?.path,
    ).toBe('value')
    // A field the registry lacks is refused and never matches.
    expect(
      conditionIssue(fields, {
        field: 'floors',
        operator: 'equals',
        value: '1',
      } as never)?.path,
    ).toBe('field')
    expect(
      describeConditions(
        fields,
        'all',
        [{ field: 'kind', operator: 'equals', value: 'pv' }],
        'Every measure',
      ),
    ).toBe('Kind equals PV')
    expect(describeConditions(fields, 'all', [], 'Every measure')).toBe(
      'Every measure',
    )
    const { warnings } = prepareRules(
      [
        {
          id: 'r',
          name: 'R',
          enabled: true,
          logic: 'all',
          conditions: [],
          slots: { heating: 'gone' },
        },
      ],
      ['heating'],
      () => false,
      'measure',
    )
    expect(warnings[0]?.message).toMatch(/later rules decide that measure\.$/)
  })
})
