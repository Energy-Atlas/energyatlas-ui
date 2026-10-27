import { useMemo, useState } from 'react'
import {
  Checkbox,
  CheckboxGroup,
  FieldError,
  Label,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Text,
} from 'react-aria-components'
import {
  KIND_LABELS,
  compositionConflict,
  previewScenario,
} from '../../domain/scenarios/comparison.ts'
import type { Scenario } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import { PropertyForm, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

type ScenarioFields = {
  name: string
  measureIds: string[]
  adoptionPercent: number
  included: boolean
}

const EMPTY: ScenarioFields = {
  name: '',
  measureIds: [],
  adoptionPercent: 50,
  included: true,
}

/**
 * A scenario in Properties: its name, its measures (one of each kind), the
 * adoption level, and whether Scenario modeling compares it, with a
 * synthetic preview of the buildings it affects.
 */
export function ScenarioProperties({
  scenario,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new scenario. */
  scenario: Scenario | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const measures = Object.values(state.measures)
  const edits = useEdits<ScenarioFields>(
    scenario
      ? {
          name: scenario.name,
          measureIds: scenario.measureIds,
          adoptionPercent: scenario.adoptionPercent,
          included: scenario.included,
        }
      : EMPTY,
    scenario ? `scenario:${scenario.id}` : 'new:scenario',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = scenario === null
  const conflict = compositionConflict(state.measures, draft.measureIds)
  const preview = useMemo(() => previewScenario(state, draft), [state, draft])
  const highlight = (field: keyof ScenarioFields) =>
    !creating && edits.isEdited(field)
  const update = <K extends keyof ScenarioFields>(
    field: K,
    value: ScenarioFields[K],
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
      scenario
        ? client.execute({
            type: 'scenario.update',
            input: { ...draft, id: scenario.id },
          })
        : client.execute({ type: 'scenario.create', input: draft })
    ).then((result) => {
      if (result.outcome.status === 'applied') {
        setErrors({})
        setError(null)
        edits.reset()
        if (creating) {
          const created = Object.values(workbench.getState().scenarios).find(
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
      eyebrow="Scenario"
      title={scenario ? scenario.name : 'New scenario'}
      meta={<CapabilityBadge id="creator.scenario" />}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={
        waitingReason(
          pending,
          'scenario.update',
          'the scenario is being saved',
        ) ??
        waitingReason(
          pending,
          'scenario.create',
          'the scenario is being created',
        )
      }
      submitLabel={creating ? 'Create scenario' : 'Save scenario'}
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
      <CheckboxGroup
        className={cx(
          formStyles.field,
          highlight('measureIds') && formStyles.edited,
        )}
        value={draft.measureIds}
        isInvalid={Boolean(errors.measureIds)}
        onChange={(measureIds) => update('measureIds', measureIds)}
      >
        <Label className={formStyles.label}>Measures</Label>
        {measures.length === 0 ? (
          <Text slot="description" className={formStyles.description}>
            Create a measure first.
          </Text>
        ) : (
          <div className={formStyles.options}>
            {measures.map((measure) => (
              <Checkbox
                key={measure.id}
                value={measure.id}
                className={formStyles.checkbox}
              >
                {measure.name}{' '}
                <span className={componentStyles.muted}>
                  ({KIND_LABELS[measure.kind]})
                </span>
              </Checkbox>
            ))}
          </div>
        )}
        {conflict && !errors.measureIds ? (
          <Text slot="description" className={formStyles.fieldError}>
            {conflict}
          </Text>
        ) : null}
        <FieldError className={formStyles.fieldError}>
          {errors.measureIds}
        </FieldError>
      </CheckboxGroup>
      <Checkbox
        className={cx(
          formStyles.checkbox,
          highlight('included') && formStyles.edited,
        )}
        isSelected={draft.included}
        onChange={(included) => update('included', included)}
      >
        Include in the comparison set
      </Checkbox>
      <Slider
        className={cx(
          formStyles.slider,
          highlight('adoptionPercent') && formStyles.edited,
        )}
        value={draft.adoptionPercent}
        minValue={0}
        maxValue={100}
        step={5}
        onChange={(adoptionPercent) =>
          update('adoptionPercent', adoptionPercent)
        }
      >
        <Label className={formStyles.label}>Adoption (%)</Label>
        <SliderOutput className={formStyles.description} />
        <SliderTrack className={formStyles.sliderTrack}>
          {({ state: slider }) => (
            <>
              <div
                className={formStyles.sliderFill}
                style={{ width: `${slider.getThumbPercent(0) * 100}%` }}
              />
              <SliderThumb className={formStyles.sliderThumb} />
            </>
          )}
        </SliderTrack>
      </Slider>
      {errors.adoptionPercent ? (
        <p className={formStyles.fieldError} role="alert">
          {errors.adoptionPercent}
        </p>
      ) : null}
      <p className={formStyles.description} aria-live="polite">
        {draft.measureIds.length === 0
          ? 'Choose measures to preview the buildings they affect.'
          : preview.available
            ? `Affects ${preview.affected} modeled buildings; estimated ${preview.reductionPercent}% lower annual demand at ${draft.adoptionPercent}% adoption (synthetic preview).`
            : `${preview.measures.map((item) => `${item.name}: ${item.buildings} buildings`).join('; ')}. ${preview.reason ?? ''}`}
      </p>
    </PropertyForm>
  )
}
