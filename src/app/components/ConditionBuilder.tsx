import { Plus, X } from 'lucide-react'
import { useId } from 'react'
import { Input, TextField } from 'react-aria-components'
import {
  LOGIC_LABELS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  fieldDefinition,
  type Condition,
  type FieldRegistry,
} from '../../domain/rules/conditions.ts'
import type { ConditionOperator, RuleLogic } from '../../domain/types.ts'
import { cx } from '../cx.ts'
import componentStyles from './components.module.css'
import formStyles from './forms.module.css'
import styles from './ruleList.module.css'

type ConditionBuilderProps<Field extends string> = {
  /** The fields conditions may test; every lookup uses this registry. */
  fields: FieldRegistry<Field>
  logic: RuleLogic
  onLogicChange: (logic: RuleLogic) => void
  conditions: Condition<Field>[]
  onChange: (conditions: Condition<Field>[]) => void
  /** Messages by path: "logic", "conditions", or "conditions.0.value". */
  errors?: Record<string, string | undefined>
  /** What the conditions select, for the wording, such as "building". */
  subject?: string
  readOnly?: boolean
  /** Marks the logic and the conditions as edited. */
  edited?: boolean
}

/**
 * Typed conditions for assignment rules (decision 0032), shared by archetype
 * and scenario rules: whether all, any, or none must match, then rows of
 * field, operator, and value. Operators follow the field's type (numbers:
 * larger, smaller, equals; a use: equals, does not contain; text: contains,
 * does not contain, equals), and an enumerated field offers its values. A
 * row without a field is blank: it is kept, and skipped when rules are
 * evaluated, as RC does. Selects are native, as in `SelectProperty`, and
 * mark issues with aria-invalid; the value field is a React Aria TextField
 * with `isInvalid`.
 */
export function ConditionBuilder<Field extends string>({
  fields,
  logic,
  onLogicChange,
  conditions,
  onChange,
  errors = {},
  subject = 'building',
  readOnly = false,
  edited = false,
}: ConditionBuilderProps<Field>) {
  const id = useId()
  const update = (index: number, patch: Partial<Condition<Field>>) =>
    onChange(
      conditions.map((condition, position) =>
        position === index ? { ...condition, ...patch } : condition,
      ),
    )
  const changeField = (index: number, value: string) => {
    if (value === '') {
      update(index, { field: null })
      return
    }
    const definition = fields.find((field) => field.id === value)
    if (!definition) return
    const current = conditions[index]
    const previous =
      current && current.field !== null
        ? fieldDefinition(fields, current.field)
        : undefined
    const operators = OPERATORS_BY_TYPE[definition.type]
    update(index, {
      field: definition.id,
      operator:
        current && operators.includes(current.operator)
          ? current.operator
          : (operators[0] ?? 'equals'),
      value:
        definition.type === 'enum'
          ? (definition.options?.[0]?.value ?? '')
          : current && previous?.type === definition.type
            ? current.value
            : '',
    })
  }
  const blank = conditions.filter((condition) => condition.field === null)
  const full = conditions.length >= 20
  return (
    <fieldset
      className={cx(styles.conditions, edited && formStyles.edited)}
      aria-describedby={`${id}-note`}
    >
      <legend className={styles.legend}>Conditions</legend>
      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor={`${id}-logic`}>
          Applies when
        </label>
        <select
          id={`${id}-logic`}
          className={formStyles.input}
          value={logic}
          disabled={readOnly}
          aria-invalid={errors.logic ? true : undefined}
          aria-describedby={errors.logic ? `${id}-logic-error` : undefined}
          onChange={(event) => onLogicChange(event.target.value as RuleLogic)}
        >
          {(Object.keys(LOGIC_LABELS) as RuleLogic[]).map((value) => (
            <option key={value} value={value}>
              {LOGIC_LABELS[value]}
            </option>
          ))}
        </select>
        {errors.logic ? (
          <span id={`${id}-logic-error`} className={formStyles.fieldError}>
            {errors.logic}
          </span>
        ) : null}
      </div>
      {conditions.map((condition, index) => {
        const number = index + 1
        const definition =
          condition.field === null
            ? null
            : (fieldDefinition(fields, condition.field) ?? null)
        const path = `conditions.${index}`
        const message =
          errors[`${path}.field`] ??
          errors[`${path}.operator`] ??
          errors[`${path}.value`] ??
          errors[path]
        const errorId = `${id}-${index}-error`
        const invalid = (part: string) =>
          errors[`${path}.${part}`] ? true : undefined
        return (
          <div
            key={index}
            className={cx(styles.row, condition.field === null && styles.blank)}
            role="group"
            aria-label={`Condition ${number}`}
          >
            <select
              aria-label={`Condition ${number} field`}
              className={formStyles.input}
              value={condition.field ?? ''}
              disabled={readOnly}
              aria-invalid={invalid('field')}
              aria-describedby={message ? errorId : undefined}
              onChange={(event) => changeField(index, event.target.value)}
            >
              <option value="">Blank (choose a field)</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                  {field.unit ? ` (${field.unit})` : ''}
                </option>
              ))}
            </select>
            <select
              aria-label={`Condition ${number} operator`}
              className={formStyles.input}
              value={condition.operator}
              disabled={readOnly || definition === null}
              aria-invalid={invalid('operator')}
              aria-describedby={message ? errorId : undefined}
              onChange={(event) =>
                update(index, {
                  operator: event.target.value as ConditionOperator,
                })
              }
            >
              {(definition
                ? OPERATORS_BY_TYPE[definition.type]
                : [condition.operator]
              ).map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
            {definition?.type === 'enum' ? (
              <select
                aria-label={`Condition ${number} value`}
                className={formStyles.input}
                value={condition.value}
                disabled={readOnly}
                aria-invalid={invalid('value')}
                aria-describedby={message ? errorId : undefined}
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
              >
                {definition.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <TextField
                aria-label={`Condition ${number} value`}
                aria-describedby={message ? errorId : undefined}
                value={condition.value}
                isReadOnly={readOnly}
                isDisabled={definition === null}
                isInvalid={Boolean(invalid('value'))}
                inputMode={
                  definition?.type === 'number' ? 'decimal' : undefined
                }
                onChange={(value) => update(index, { value })}
              >
                <Input
                  className={formStyles.input}
                  placeholder={definition?.unit ?? undefined}
                />
              </TextField>
            )}
            {readOnly ? null : (
              <span className={styles.remove}>
                <button
                  type="button"
                  className={componentStyles.button}
                  aria-label={`Remove condition ${number}`}
                  title={`Remove condition ${number}`}
                  onClick={() =>
                    onChange(
                      conditions.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            )}
            {message ? (
              <span
                id={errorId}
                className={cx(formStyles.fieldError, styles.rowError)}
              >
                {message}
              </span>
            ) : null}
          </div>
        )
      })}
      <p id={`${id}-note`} className={styles.note}>
        {conditions.length === 0
          ? `No conditions: the rule applies to every ${subject}.`
          : blank.length > 0
            ? blank.length === conditions.length
              ? 'Only blank conditions: the rule is skipped until a field is chosen.'
              : `${blank.length} blank condition${blank.length === 1 ? ' is' : 's are'} skipped; the others still apply.`
            : `Text compares without case; a ${subject} without a value never matches.`}
      </p>
      {errors.conditions ? (
        <span className={formStyles.fieldError}>{errors.conditions}</span>
      ) : null}
      {readOnly ? null : (
        <div>
          <button
            type="button"
            className={componentStyles.button}
            aria-disabled={full ? true : undefined}
            title={full ? 'A rule has at most 20 conditions.' : undefined}
            onClick={() => {
              if (full) return
              onChange([
                ...conditions,
                { field: null, operator: 'equals', value: '' },
              ])
            }}
          >
            <Plus size={14} aria-hidden="true" /> Add condition
          </button>
        </div>
      )}
    </fieldset>
  )
}
