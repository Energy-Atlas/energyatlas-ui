import { useId, useState } from 'react'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  FieldError,
  Form,
  Group,
  Input,
  Label,
  NumberField,
  Radio,
  RadioGroup,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Text,
  TextField,
} from 'react-aria-components'
import { capabilities } from '../../domain/capabilities.ts'
import type { BuildingUse, Measure, MeasureKind } from '../../domain/types.ts'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import styles from './creator.module.css'

// Validation comes from the shared commands. Each field shows its own command
// issue via isInvalid, and editing a field clears only that field's issue.
// (Form-level validationErrors kept native validity blocking later submits.)

const MEASURE_KINDS: { value: MeasureKind; label: string }[] = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'heating', label: 'Heating' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'pv', label: 'Rooftop PV' },
]

const APPLIES_TO: { value: BuildingUse | 'all'; label: string }[] = [
  { value: 'all', label: 'All buildings' },
  { value: 'residential', label: 'Residential' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'school', label: 'School' },
  { value: 'mixed', label: 'Mixed use' },
]

const OTHER_CREATORS = ['Building', 'Grid element', 'View or report']

type MeasureDraft = {
  name: string
  kind: MeasureKind
  savingsPercent: number
  appliesTo: BuildingUse | 'all'
}

const EMPTY_MEASURE: MeasureDraft = {
  name: '',
  kind: 'envelope',
  savingsPercent: 10,
  appliesTo: 'all',
}

type ScenarioDraft = {
  name: string
  measureIds: string[]
  adoptionPercent: number
}

const EMPTY_SCENARIO: ScenarioDraft = {
  name: '',
  measureIds: [],
  adoptionPercent: 50,
}

type FormMessage = { tone: 'error' | 'success'; text: string } | null

function isMeasureKind(value: string): value is MeasureKind {
  return MEASURE_KINDS.some((kind) => kind.value === value)
}

function isAppliesTo(value: string): value is BuildingUse | 'all' {
  return APPLIES_TO.some((option) => option.value === value)
}

function withoutKey(
  record: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function Message({ message }: { message: FormMessage }) {
  if (!message) return null
  return (
    <p
      className={
        message.tone === 'error' ? formStyles.alert : formStyles.success
      }
      role={message.tone === 'error' ? 'alert' : 'status'}
    >
      {message.text}
    </p>
  )
}

export function CreatorPage() {
  const headingId = useId()
  const measures = useWorkbenchSnapshot((snapshot) => snapshot.state.measures)
  const scenarios = useWorkbenchSnapshot((snapshot) => snapshot.state.scenarios)
  const measureList = Object.values(measures)
  const scenarioList = Object.values(scenarios)

  return (
    <section className={componentStyles.page} aria-labelledby={headingId}>
      <h2 id={headingId}>Creator</h2>
      <div className={styles.creators}>
        <MeasureCreator />
        <ScenarioCreator measures={measureList} />
        <OtherCreators />
      </div>

      <h3>Measures</h3>
      {measureList.length === 0 ? (
        <p className={componentStyles.empty}>No measures yet.</p>
      ) : (
        <table className={componentStyles.table} aria-label="Measures">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Savings</th>
              <th scope="col">Applies to</th>
            </tr>
          </thead>
          <tbody>
            {measureList.map((measure) => (
              <tr key={measure.id}>
                <td>{measure.name}</td>
                <td>{measure.kind}</td>
                <td>
                  {measure.kind === 'pv'
                    ? 'From PV yield'
                    : `${measure.savingsPercent}%`}
                </td>
                <td>{measure.appliesTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Scenarios</h3>
      {scenarioList.length === 0 ? (
        <p className={componentStyles.empty}>No scenarios yet.</p>
      ) : (
        <table className={componentStyles.table} aria-label="Scenarios">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Measures</th>
              <th scope="col">Adoption</th>
            </tr>
          </thead>
          <tbody>
            {scenarioList.map((scenario) => (
              <tr key={scenario.id}>
                <td>{scenario.name}</td>
                <td>
                  {scenario.measureIds
                    .map((id) => measures[id]?.name ?? id)
                    .join(', ')}
                </td>
                <td>{scenario.adoptionPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function MeasureCreator() {
  const headingId = useId()
  const { client } = useServices()
  const [draft, setDraft] = useState<MeasureDraft>(EMPTY_MEASURE)
  const [sending, setSending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<FormMessage>(null)

  const update = (field: keyof MeasureDraft, next: MeasureDraft) => {
    setDraft(next)
    setErrors((current) => withoutKey(current, field))
  }

  return (
    <section className={formStyles.form} aria-labelledby={headingId}>
      <div className={formStyles.formHeader}>
        <h3 id={headingId}>New measure</h3>
        <CapabilityBadge id="creator.measure" />
      </div>
      <Form
        className={styles.fields}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          if (sending) return
          setSending(true)
          void client
            .execute({
              type: 'measure.create',
              input: draft,
            })
            .then((result) => {
              setSending(false)
              if (result.outcome.status === 'applied') {
                setDraft(EMPTY_MEASURE)
                setErrors({})
                setMessage({ tone: 'success', text: result.outcome.summary })
                return
              }
              const { fieldErrors, general } = splitIssues(
                result.outcome.issues,
              )
              setErrors(fieldErrors)
              setMessage(general ? { tone: 'error', text: general } : null)
            })
        }}
      >
        <TextField
          name="name"
          className={formStyles.field}
          value={draft.name}
          isInvalid={Boolean(errors.name)}
          onChange={(name) => update('name', { ...draft, name })}
        >
          <Label className={formStyles.label}>Name</Label>
          <Input className={formStyles.input} />
          <FieldError className={formStyles.fieldError}>
            {errors.name}
          </FieldError>
        </TextField>

        <RadioGroup
          name="kind"
          className={formStyles.field}
          value={draft.kind}
          orientation="horizontal"
          isInvalid={Boolean(errors.kind)}
          onChange={(value) => {
            if (!isMeasureKind(value)) return
            update('kind', {
              ...draft,
              kind: value,
              savingsPercent: value === 'pv' ? 0 : draft.savingsPercent,
            })
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
          <FieldError className={formStyles.fieldError}>
            {errors.kind}
          </FieldError>
        </RadioGroup>

        <NumberField
          name="savingsPercent"
          className={formStyles.field}
          value={draft.savingsPercent}
          minValue={0}
          maxValue={100}
          isDisabled={draft.kind === 'pv'}
          isInvalid={Boolean(errors.savingsPercent)}
          onChange={(value) =>
            update('savingsPercent', {
              ...draft,
              savingsPercent: Number.isNaN(value) ? 0 : value,
            })
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
          name="appliesTo"
          className={formStyles.field}
          value={draft.appliesTo}
          orientation="horizontal"
          isInvalid={Boolean(errors.appliesTo)}
          onChange={(value) => {
            if (isAppliesTo(value))
              update('appliesTo', { ...draft, appliesTo: value })
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

        <Message message={message} />
        <Button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
          isPending={sending}
        >
          {sending ? 'Sending…' : 'Create measure'}
        </Button>
      </Form>
    </section>
  )
}

function ScenarioCreator({ measures }: { measures: Measure[] }) {
  const headingId = useId()
  const { client } = useServices()
  const [draft, setDraft] = useState<ScenarioDraft>(EMPTY_SCENARIO)
  const [sending, setSending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<FormMessage>(null)

  const update = (field: keyof ScenarioDraft, next: ScenarioDraft) => {
    setDraft(next)
    setErrors((current) => withoutKey(current, field))
  }

  return (
    <section className={formStyles.form} aria-labelledby={headingId}>
      <div className={formStyles.formHeader}>
        <h3 id={headingId}>New scenario</h3>
        <CapabilityBadge id="creator.scenario" />
      </div>
      <Form
        className={styles.fields}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          if (sending) return
          setSending(true)
          void client
            .execute({
              type: 'scenario.create',
              input: draft,
            })
            .then((result) => {
              setSending(false)
              if (result.outcome.status === 'applied') {
                setDraft(EMPTY_SCENARIO)
                setErrors({})
                setMessage({ tone: 'success', text: result.outcome.summary })
                return
              }
              const { fieldErrors, general } = splitIssues(
                result.outcome.issues,
              )
              setErrors(fieldErrors)
              setMessage(general ? { tone: 'error', text: general } : null)
            })
        }}
      >
        <TextField
          name="name"
          className={formStyles.field}
          value={draft.name}
          isInvalid={Boolean(errors.name)}
          onChange={(name) => update('name', { ...draft, name })}
        >
          <Label className={formStyles.label}>Name</Label>
          <Input className={formStyles.input} />
          <FieldError className={formStyles.fieldError}>
            {errors.name}
          </FieldError>
        </TextField>

        <CheckboxGroup
          name="measureIds"
          className={formStyles.field}
          value={draft.measureIds}
          isInvalid={Boolean(errors.measureIds)}
          onChange={(measureIds) =>
            update('measureIds', { ...draft, measureIds })
          }
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
                  {measure.name}
                </Checkbox>
              ))}
            </div>
          )}
          <FieldError className={formStyles.fieldError}>
            {errors.measureIds}
          </FieldError>
        </CheckboxGroup>

        <Slider
          className={formStyles.slider}
          value={draft.adoptionPercent}
          minValue={0}
          maxValue={100}
          step={5}
          onChange={(adoptionPercent) =>
            update('adoptionPercent', { ...draft, adoptionPercent })
          }
        >
          <Label className={formStyles.label}>Adoption (%)</Label>
          <SliderOutput className={formStyles.description} />
          <SliderTrack className={formStyles.sliderTrack}>
            {({ state }) => (
              <>
                <div
                  className={formStyles.sliderFill}
                  style={{ width: `${state.getThumbPercent(0) * 100}%` }}
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

        <Message message={message} />
        <Button
          type="submit"
          className={cx(componentStyles.button, componentStyles.primary)}
          isPending={sending}
        >
          {sending ? 'Sending…' : 'Create scenario'}
        </Button>
      </Form>
    </section>
  )
}

function OtherCreators() {
  const headingId = useId()
  return (
    <section className={formStyles.form} aria-labelledby={headingId}>
      <div className={formStyles.formHeader}>
        <h3 id={headingId}>Other creators</h3>
        <StatusTag status="planned" />
      </div>
      <p className={componentStyles.muted}>
        {capabilities['creator.otherAssets'].explanation}
      </p>
      <ul className={styles.plannedList}>
        {OTHER_CREATORS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  )
}
