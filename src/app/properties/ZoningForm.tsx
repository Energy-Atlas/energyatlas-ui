import { useId, useState } from 'react'
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
import { hasActiveTask, STAGE_IDS } from '../../domain/workflow.ts'
import {
  DEFAULT_PERIMETER_DEPTH_M,
  MAX_PERIMETER_DEPTH_M,
  MIN_PERIMETER_DEPTH_M,
  RC_ZONING_MODES,
  ZONING_MODES,
  ZONING_MODE_LABELS,
  describeZoning,
  sameZoning,
  type ZoningMode,
} from '../../domain/zoning/zoning.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { waitingReason } from '../service/usePendingReason.ts'
import styles from './properties.module.css'

const MODE_HINTS: Record<ZoningMode, string> = {
  single: 'RC’s default: the whole building is one thermal zone.',
  floors: 'Every storey is its own zone; floors are the height over storeys.',
  perimeterCore:
    'Every storey gets a core and one perimeter zone per footprint edge; edges shorter than the depth join the zone before them. Footprints that cannot be inset fall back to one zone per floor.',
}

const isMode = (value: string): value is ZoningMode =>
  (ZONING_MODES as readonly string[]).includes(value)

/**
 * The zoning setting, an input of Geospatial preprocessing (decision 0032,
 * stage 6), in the stage's Properties. Saving it is a server command; the
 * stage and later stages become outdated until preprocessing runs again.
 * The viewer page shows the stage read-only and leaves this form out.
 */
export function ZoningForm() {
  const { client } = useServices()
  const titleId = useId()
  const zoning = useWorkbenchSnapshot((snapshot) => snapshot.state.zoning)
  const tasks = useWorkbenchSnapshot((snapshot) => snapshot.state.tasks)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [mode, setMode] = useState<ZoningMode>(zoning.mode)
  const [depth, setDepth] = useState(zoning.perimeterDepthM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  // A setting saved elsewhere (another control, the agent) replaces the
  // draft; server updates that leave the setting alone keep it.
  const savedKey = `${zoning.mode}:${zoning.perimeterDepthM}`
  const [synced, setSynced] = useState(savedKey)
  if (synced !== savedKey) {
    setSynced(savedKey)
    setMode(zoning.mode)
    setDepth(zoning.perimeterDepthM)
  }
  const running = hasActiveTask(tasks, STAGE_IDS.preprocessing)
  const waiting = waitingReason(
    pending,
    'zoning.set',
    'the zoning is being set',
  )
  const unchanged = mode === zoning.mode && depth === zoning.perimeterDepthM
  const reason =
    waiting ??
    (running
      ? '"Geospatial preprocessing" is running. Wait for it to finish before changing the zoning.'
      : unchanged
        ? 'The zoning has not been changed.'
        : null)
  const published = zoning.published
  const draft = { mode, perimeterDepthM: depth }
  const save = () => {
    void client
      .execute({
        type: 'zoning.set',
        input: { mode, perimeterDepthM: depth },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setGeneral(null)
          return
        }
        const split = splitIssues(result.outcome.issues)
        setErrors(split.fieldErrors)
        setGeneral(split.general)
      })
  }

  return (
    <section className={styles.zoningForm} aria-labelledby={titleId}>
      <h4 id={titleId}>Zoning</h4>
      <p className={componentStyles.muted}>
        How this stage divides buildings into thermal zones, in RC&rsquo;s three
        modes.{' '}
        {published
          ? `The last run zoned by: ${describeZoning(published).toLowerCase()}.`
          : 'No run has zoned buildings by this setting yet.'}
      </p>
      <RadioGroup
        className={formStyles.field}
        value={mode}
        isInvalid={Boolean(errors.mode)}
        onChange={(value) => {
          if (!isMode(value)) return
          setMode(value)
          setErrors({})
          setGeneral(null)
        }}
      >
        <Label className={formStyles.label}>Zones</Label>
        <div className={formStyles.options}>
          {ZONING_MODES.map((each) => (
            <Radio key={each} value={each} className={formStyles.radio}>
              {ZONING_MODE_LABELS[each]} ({RC_ZONING_MODES[each]})
            </Radio>
          ))}
        </div>
        <Text slot="description" className={formStyles.description}>
          {MODE_HINTS[mode]}
        </Text>
        <FieldError className={formStyles.fieldError}>{errors.mode}</FieldError>
      </RadioGroup>
      {mode === 'perimeterCore' ? (
        <NumberField
          className={formStyles.field}
          value={depth}
          minValue={MIN_PERIMETER_DEPTH_M}
          maxValue={MAX_PERIMETER_DEPTH_M}
          step={0.5}
          isInvalid={Boolean(errors.perimeterDepthM)}
          onChange={(value) => {
            setDepth(Number.isNaN(value) ? DEFAULT_PERIMETER_DEPTH_M : value)
            setErrors({})
            setGeneral(null)
          }}
        >
          <Label className={formStyles.label}>Perimeter depth (m)</Label>
          <Group className={formStyles.numberGroup}>
            <Button slot="decrement" className={formStyles.stepper}>
              -
            </Button>
            <Input className={formStyles.input} />
            <Button slot="increment" className={formStyles.stepper}>
              +
            </Button>
          </Group>
          <Text slot="description" className={formStyles.description}>
            {MIN_PERIMETER_DEPTH_M} to {MAX_PERIMETER_DEPTH_M} m; 4.5 m is about
            15 ft.
          </Text>
          <FieldError className={formStyles.fieldError}>
            {errors.perimeterDepthM}
          </FieldError>
        </NumberField>
      ) : null}
      {!unchanged && published && !sameZoning(draft, zoning) ? (
        <p className={componentStyles.muted}>
          Saving makes this stage and every later stage outdated until it runs
          again.
        </p>
      ) : null}
      {general ? <InlineAlert tone="danger">{general}</InlineAlert> : null}
      <div className={styles.actions}>
        <ActionButton
          label="Save zoning"
          variant="primary"
          disabledReason={reason}
          onPress={save}
        >
          {waiting ? 'Saving…' : 'Save zoning'}
        </ActionButton>
      </div>
    </section>
  )
}
