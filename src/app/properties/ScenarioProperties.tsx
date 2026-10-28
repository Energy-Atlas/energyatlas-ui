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
  DEFAULT_ADOPTION_SEED,
  KIND_LABELS,
  kindNoun,
  emptyMeasures,
  previewScenarioRules,
  scenarioRules,
} from '../../domain/scenarios/rules.ts'
import type { Measure, Scenario, ScenarioRule } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import { formatEnergy } from '../format.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import { PropertyForm, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

type ScenarioFields = {
  name: string
  adoptionPercent: number
  /** Text while edited; the server checks it is a whole number. */
  adoptionSeed: string
  included: boolean
  /** Only when creating: measures for a first rule without conditions. */
  measureIds: string[]
}

const EMPTY: ScenarioFields = {
  name: '',
  adoptionPercent: 50,
  adoptionSeed: String(DEFAULT_ADOPTION_SEED),
  included: true,
  measureIds: [],
}

/** Two chosen measures of one category, in words, or null. */
function categoryConflict(
  measures: Record<string, Measure>,
  ids: string[],
): string | null {
  const seen = new Map<Measure['kind'], string>()
  for (const id of ids) {
    const measure = measures[id]
    if (!measure) continue
    const other = seen.get(measure.kind)
    if (other) {
      return `"${other}" and "${measure.name}" are both ${kindNoun(measure.kind)} measures. A rule assigns at most one measure of each category.`
    }
    seen.set(measure.kind, measure.name)
  }
  return null
}

/**
 * A scenario in Properties (decision 0032, stage 3): its name, whether
 * Scenario modeling compares it, and its adoption: the share of affected
 * buildings that adopt, sampled with a fixed seed when results are
 * aggregated, so changing it re-aggregates without modeling again. Its rules
 * are listed on the Scenarios page and edited as scenario
 * rules. A new scenario can start with one rule for every building.
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
  const { client, workbench, layout, view } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const measures = Object.values(state.measures)
  const edits = useEdits<ScenarioFields>(
    scenario
      ? {
          name: scenario.name,
          adoptionPercent: scenario.adoptionPercent,
          adoptionSeed: String(scenario.adoptionSeed),
          included: scenario.included,
          measureIds: [],
        }
      : EMPTY,
    scenario ? `scenario:${scenario.id}` : 'new:scenario',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = scenario === null
  const conflict = creating
    ? categoryConflict(state.measures, draft.measureIds)
    : null
  const seed = Number(draft.adoptionSeed)
  const preview = useMemo(() => {
    // A new scenario previews the rule it would start with.
    const rules: ScenarioRule[] = scenario
      ? scenarioRules(state, scenario)
      : draft.measureIds.length > 0 && !conflict
        ? [
            {
              id: 'preview:all',
              scenarioId: 'preview',
              name: 'All buildings',
              enabled: true,
              logic: 'all',
              conditions: [],
              measures: draft.measureIds.reduce((slots, id) => {
                const measure = state.measures[id]
                if (measure) slots[measure.kind] = id
                return slots
              }, emptyMeasures()),
            },
          ]
        : []
    return previewScenarioRules(state, {
      id: scenario?.id,
      rules,
      adoptionPercent: draft.adoptionPercent,
      adoptionSeed: Number.isInteger(seed) ? seed : DEFAULT_ADOPTION_SEED,
    })
  }, [state, scenario, draft.measureIds, draft.adoptionPercent, seed, conflict])
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
    const adoptionSeed =
      draft.adoptionSeed.trim() === '' ? Number.NaN : Number(draft.adoptionSeed)
    const before = new Set(Object.keys(workbench.getState().scenarios))
    void (
      scenario
        ? client.execute({
            type: 'scenario.update',
            input: {
              id: scenario.id,
              name: draft.name,
              adoptionPercent: draft.adoptionPercent,
              adoptionSeed,
              included: draft.included,
            },
          })
        : client.execute({
            type: 'scenario.create',
            input: {
              name: draft.name,
              adoptionPercent: draft.adoptionPercent,
              adoptionSeed,
              included: draft.included,
              measureIds: draft.measureIds,
            },
          })
    ).then((result) => {
      if (result.outcome.status === 'applied') {
        setErrors({})
        setError(null)
        edits.reset()
        if (creating) {
          const created = Object.keys(workbench.getState().scenarios).find(
            (id) => !before.has(id),
          )
          if (created) onCreated(created)
        }
        return
      }
      const { fieldErrors, general } = splitIssues(result.outcome.issues)
      setErrors(fieldErrors)
      setError(general)
    })
  }

  const modeled = scenario
    ? Boolean(state.results.scenarioVersions[scenario.id])
    : false
  const ruleCount = scenario?.ruleIds.length ?? 0
  const previewText = (() => {
    if (scenario && ruleCount === 0) {
      return 'No rules yet: the scenario changes no building. Add rules on the Scenarios page.'
    }
    if (creating && draft.measureIds.length === 0) {
      return 'Optionally choose measures for a first rule that applies to every building, or add rules after creating the scenario.'
    }
    if (preview.affectedIds.length === 0) {
      return 'No building takes a measure with these rules.'
    }
    const taking = `${preview.affectedIds.length} of ${preview.buildings} buildings take a measure; ${preview.adoptedIds.length} adopt at ${draft.adoptionPercent}% adoption.`
    return preview.estimate
      ? `${taking} Estimated ${preview.estimate.reductionPercent}% lower annual demand than the baseline (${formatEnergy(preview.estimate.scenarioKwh)} a year; ${preview.estimate.fullReductionPercent}% if every affected building adopted). Synthetic preview.`
      : `${taking} ${preview.reason ?? ''}`
  })()

  return (
    <PropertyForm
      eyebrow="Scenario"
      title={scenario ? scenario.name : 'New scenario'}
      meta={<CapabilityBadge id="creator.scenario" />}
      provenance={
        scenario
          ? `${ruleCount} rule${ruleCount === 1 ? '' : 's'}, tried top first.${modeled ? ' Adoption and seed apply when results are aggregated: saving them re-aggregates the published result without modeling again.' : ''}`
          : undefined
      }
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
      actions={
        scenario ? (
          <ActionButton
            label={`Show the rules of ${scenario.name} on the Scenarios page`}
            disabledReason={null}
            onPress={() => {
              view.execute({
                type: 'scenarios.setPreviewScenario',
                input: { scenarioId: scenario.id },
              })
              layout.openPage('creator')
            }}
          >
            Show its rules
          </ActionButton>
        ) : undefined
      }
    >
      <TextProperty
        label="Name"
        value={draft.name}
        edited={highlight('name')}
        error={errors.name}
        onChange={(value) => update('name', value)}
      />
      {creating ? (
        <CheckboxGroup
          className={formStyles.field}
          value={draft.measureIds}
          isInvalid={Boolean(errors.measureIds)}
          onChange={(measureIds) => update('measureIds', measureIds)}
        >
          <Label className={formStyles.label}>
            First rule: measures for every building
          </Label>
          {measures.length === 0 ? (
            <Text slot="description" className={formStyles.description}>
              The project has no measures yet. Create one, or add rules later.
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
      ) : null}
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
      <TextProperty
        label="Adoption seed"
        value={draft.adoptionSeed}
        inputMode="numeric"
        edited={highlight('adoptionSeed')}
        error={errors.adoptionSeed}
        description="Which buildings adopt is fixed by this seed and each building id; another seed samples other buildings at the same share."
        onChange={(value) => update('adoptionSeed', value)}
      />
      <p className={formStyles.description} aria-live="polite">
        {previewText}
      </p>
    </PropertyForm>
  )
}
