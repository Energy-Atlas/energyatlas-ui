import { useState } from 'react'
import {
  Button,
  FieldError,
  Group,
  Input,
  Label,
  NumberField,
  Radio,
  RadioGroup,
  Text,
} from 'react-aria-components'
import type { Measure, MeasureKind } from '../../domain/types.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import { APPLIES_TO, provenanceSentence } from './definitionLabels.ts'
import { PropertyForm, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

const MEASURE_KINDS: { value: MeasureKind; label: string }[] = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'heating', label: 'Heating' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'pv', label: 'Rooftop PV' },
]

type MeasureFields = {
  name: string
  kind: MeasureKind
  savingsPercent: number
  appliesTo: Measure['appliesTo']
}

const EMPTY: MeasureFields = {
  name: '',
  kind: 'envelope',
  savingsPercent: 10,
  appliesTo: 'all',
}

function isKind(value: string): value is MeasureKind {
  return MEASURE_KINDS.some((kind) => kind.value === value)
}

function isAppliesTo(value: string): value is Measure['appliesTo'] {
  return APPLIES_TO.some((option) => option.value === value)
}

/** A measure in Properties: its name, kind, savings, and the buildings it applies to. */
export function MeasureProperties({
  measure,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new measure. */
  measure: Measure | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const edits = useEdits<MeasureFields>(
    measure
      ? {
          name: measure.name,
          kind: measure.kind,
          savingsPercent: measure.savingsPercent,
          appliesTo: measure.appliesTo,
        }
      : EMPTY,
    measure ? `measure:${measure.id}` : 'new:measure',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = measure === null
  const highlight = (field: keyof MeasureFields) =>
    !creating && edits.isEdited(field)
  const update = <K extends keyof MeasureFields>(
    field: K,
    value: MeasureFields[K],
  ) => {
    edits.set(field, value)
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const submit = () => {
    void (
      measure
        ? client.execute({
            type: 'measure.update',
            input: { ...draft, id: measure.id },
          })
        : client.execute({ type: 'measure.create', input: draft })
    ).then((result) => {
      if (result.outcome.status === 'applied') {
        setErrors({})
        setError(null)
        edits.reset()
        if (creating) {
          const created = Object.values(workbench.getState().measures).find(
            (item) => item.name === draft.name.trim(),
          )
          if (created) onCreated(created.id)
        }
        return
      }
      const { fieldErrors, general } = splitIssues(result.outcome.issues)
      setErrors(fieldErrors)
      setError(general)
    })
  }

  return (
    <PropertyForm
      eyebrow="Measure"
      title={measure ? measure.name : 'New measure'}
      meta={<CapabilityBadge id="creator.measure" />}
      provenance={measure ? provenanceSentence(measure.source) : undefined}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={
        waitingReason(
          pending,
          'measure.update',
          'the measure is being saved',
        ) ??
        waitingReason(pending, 'measure.create', 'the measure is being created')
      }
      submitLabel={creating ? 'Create measure' : 'Save measure'}
      onSubmit={submit}
      onCancel={() => {
        if (creating) {
          onCancelCreate()
          return
        }
        edits.reset()
        setErrors({})
        setError(null)
      }}
    >
      <TextProperty
        label="Name"
        value={draft.name}
        edited={highlight('name')}
        error={errors.name}
        onChange={(value) => update('name', value)}
      />
      <RadioGroup
        className={cx(formStyles.field, highlight('kind') && formStyles.edited)}
        value={draft.kind}
        orientation="horizontal"
        isInvalid={Boolean(errors.kind)}
        onChange={(value) => {
          if (!isKind(value)) return
          edits.patch(
            value === 'pv'
              ? { kind: value, savingsPercent: 0 }
              : { kind: value },
          )
        }}
      >
        <Label className={formStyles.label}>Kind</Label>
        <div className={formStyles.options}>
          {MEASURE_KINDS.map((kind) => (
            <Radio
              key={kind.value}
              value={kind.value}
              className={formStyles.radio}
            >
              {kind.label}
            </Radio>
          ))}
        </div>
        <FieldError className={formStyles.fieldError}>{errors.kind}</FieldError>
      </RadioGroup>
      <NumberField
        className={cx(
          formStyles.field,
          highlight('savingsPercent') && formStyles.edited,
        )}
        value={draft.savingsPercent}
        minValue={0}
        maxValue={100}
        isDisabled={draft.kind === 'pv'}
        isInvalid={Boolean(errors.savingsPercent)}
        onChange={(value) =>
          update('savingsPercent', Number.isNaN(value) ? 0 : value)
        }
      >
        <Label className={formStyles.label}>Energy savings (%)</Label>
        <Group className={formStyles.numberGroup}>
          <Button slot="decrement" className={formStyles.stepper}>
            -
          </Button>
          <Input className={formStyles.input} />
          <Button slot="increment" className={formStyles.stepper}>
            +
          </Button>
        </Group>
        {draft.kind === 'pv' ? (
          <Text slot="description" className={formStyles.description}>
            PV measures use estimated PV yield instead of a percentage.
          </Text>
        ) : null}
        <FieldError className={formStyles.fieldError}>
          {errors.savingsPercent}
        </FieldError>
      </NumberField>
      <RadioGroup
        className={cx(
          formStyles.field,
          highlight('appliesTo') && formStyles.edited,
        )}
        value={draft.appliesTo}
        orientation="horizontal"
        isInvalid={Boolean(errors.appliesTo)}
        onChange={(value) => {
          if (isAppliesTo(value)) update('appliesTo', value)
        }}
      >
        <Label className={formStyles.label}>Applies to</Label>
        <div className={formStyles.options}>
          {APPLIES_TO.map((option) => (
            <Radio
              key={option.value}
              value={option.value}
              className={formStyles.radio}
            >
              {option.label}
            </Radio>
          ))}
        </div>
        <FieldError className={formStyles.fieldError}>
          {errors.appliesTo}
        </FieldError>
      </RadioGroup>
    </PropertyForm>
  )
}
