import { describe, expect, test } from 'vitest'
import type { RuleCondition } from '../types.ts'
import {
  conditionIssue,
  conditionMatches,
  conditionsMatch,
  describeConditions,
  firstMatches,
  prepareRules,
  type ConditionSubject,
  type RuleLike,
} from './conditions.ts'

const subject: ConditionSubject = {
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
  options: Partial<RuleLike<Slot>> = {},
): RuleLike<Slot> {
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
      conditionMatches(when('yearBuilt', 'smaller', '1980'), subject),
    ).toBe(true)
    expect(
      conditionMatches(when('yearBuilt', 'smaller', '1975'), subject),
    ).toBe(false)
    expect(conditionMatches(when('floors', 'larger', '7'), subject)).toBe(true)
    expect(conditionMatches(when('floors', 'equals', '8'), subject)).toBe(true)
    expect(conditionMatches(when('use', 'equals', 'OFFICE'), subject)).toBe(
      true,
    )
    expect(conditionMatches(when('name', 'contains', 'ing 1'), subject)).toBe(
      true,
    )
    expect(
      conditionMatches(when('use', 'notContains', 'residential'), subject),
    ).toBe(true)
    // A missing value fails every operator, does not contain included.
    const unknown = { ...subject, yearBuilt: null, use: null }
    expect(
      conditionMatches(when('yearBuilt', 'smaller', '3000'), unknown),
    ).toBe(false)
    expect(
      conditionMatches(when('use', 'notContains', 'office'), unknown),
    ).toBe(false)
  })

  test('logic all, any, and none; no conditions match everything', () => {
    const yes = when('floors', 'larger', '2')
    const no = when('use', 'equals', 'school')
    expect(conditionsMatch('all', [yes, no], subject)).toBe(false)
    expect(conditionsMatch('any', [yes, no], subject)).toBe(true)
    expect(conditionsMatch('none', [no], subject)).toBe(true)
    expect(conditionsMatch('none', [yes, no], subject)).toBe(false)
    expect(conditionsMatch('all', [], subject)).toBe(true)
    expect(conditionsMatch('none', [], subject)).toBe(true)
  })

  test('validates a condition by its field type, and allows blank ones', () => {
    expect(conditionIssue(when('floors', 'larger', 'six'))).toEqual({
      path: 'value',
      message: 'Enter a number.',
    })
    expect(conditionIssue(when('floors', 'contains', '6'))?.path).toBe(
      'operator',
    )
    expect(conditionIssue(when('use', 'equals', 'castle'))?.path).toBe('value')
    expect(conditionIssue(when('name', 'contains', ' '))?.path).toBe('value')
    expect(conditionIssue(when(null, 'equals', ''))).toBeNull()
    expect(conditionIssue(when('use', 'equals', 'retail'))).toBeNull()
  })

  test('describes conditions in words', () => {
    expect(describeConditions('all', [])).toBe('Every building')
    expect(
      describeConditions('all', [
        when('use', 'equals', 'residential'),
        when('yearBuilt', 'smaller', '1980'),
      ]),
    ).toBe('Use equals Residential and Year built is smaller than 1980')
    expect(describeConditions('any', [when(null, 'equals', '')])).toBe(
      'Only blank conditions',
    )
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
    )
    const { winners, matched } = firstMatches(prepared, SLOTS, subject)
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
    )
    expect(warnings.map((warning) => warning.code)).toEqual([
      'blank_conditions_skipped',
      'partial_conditions_dropped',
      'missing_target_skipped',
    ])
    expect(prepared.map((each) => each.id)).toEqual(['partial', 'gone'])
    // The partial rule keeps its real condition, which this building fails.
    const { winners } = firstMatches(prepared, SLOTS, subject)
    expect(winners.a).toBeNull()
    expect(winners.b?.value).toBe('kept')
  })

  test('says when no rule is on', () => {
    expect(prepareRules([], SLOTS, () => true).warnings[0]?.code).toBe(
      'no_enabled_rules',
    )
    expect(
      prepareRules(
        [rule('off', [], { a: 'x' }, { enabled: false })],
        SLOTS,
        () => true,
      ).warnings[0]?.message,
    ).toMatch(/No rule is on/)
  })
})
