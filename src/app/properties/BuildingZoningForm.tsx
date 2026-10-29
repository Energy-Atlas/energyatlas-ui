import { useId, useState } from 'react'
import {
  Label,
  Radio,
  RadioGroup,
  Text,
  FieldError,
} from 'react-aria-components'
import { hasActiveTask, STAGE_IDS } from '../../domain/workflow.ts'
import {
  DRAWN_ZONE_USE_LABELS,
  type DrawnZoning,
} from '../../domain/zoning/drawn.ts'
import {
  BUILDING_ZONING_CHOICES,
  BUILDING_ZONING_LABELS,
  ZONING_MODE_LABELS,
  ZONING_SOURCE_LABELS,
  describeAppliedZoning,
  describeBuildingZoning,
  describeZoning,
  publishedZoningOf,
  resolveBuildingZoning,
  sameBuildingZoning,
  zoneBuilding,
  type BuildingZoning,
  type BuildingZoningChoice,
} from '../../domain/zoning/zoning.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { waitingReason } from '../service/usePendingReason.ts'
import styles from './properties.module.css'

// A building's own zoning (decision 0034): the project default or one of the
// building's own modes, saved with the zoning.setBuilding server command.
// Changing it outdates Geospatial preprocessing exactly as the project
// setting does. The viewer page shows the zoning as a fact instead.

const isChoice = (value: string): value is BuildingZoningChoice =>
  (BUILDING_ZONING_CHOICES as readonly string[]).includes(value)

const HINTS: Record<Exclude<BuildingZoningChoice, 'drawn'>, string> = {
  default:
    'The building follows the zoning setting of Geospatial preprocessing.',
  single: 'The whole building is one thermal zone.',
  floors: 'Every storey is its own zone.',
  perimeterCore:
    'Every storey gets a core and one perimeter zone per footprint edge, at the project’s perimeter depth; a footprint that cannot be inset falls back to one zone per floor.',
}

/** What the drawn outlines are, in a sentence. */
export function drawnSummary(drawn: DrawnZoning | undefined): string {
  if (!drawn || drawn.plans.length === 0) {
    return 'This building has no drawn zones, so drawn zoning gives it one zone per floor.'
  }
  const zones = drawn.plans.reduce(
    (sum, plan) =>
      sum + plan.zones.length * (plan.toFloor - plan.fromFloor + 1),
    0,
  )
  const uses = [
    ...new Set(
      drawn.plans.flatMap((plan) => plan.zones.map((zone) => zone.use)),
    ),
  ]
    .map((use) => DRAWN_ZONE_USE_LABELS[use].toLowerCase())
    .join(', ')
  return `${drawn.plans.length} drawn plan${drawn.plans.length === 1 ? '' : 's'}, ${zones} zones over its floors (${uses}).`
}

export function BuildingZoningForm({
  buildingId,
  zoning,
}: {
  buildingId: string
  /** The building's zones as the last run published them. */
  zoning: BuildingZoning | null
}) {
  const { client } = useServices()
  const titleId = useId()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const building = state.buildings[buildingId]
  const saved: BuildingZoningChoice =
    state.zoning.overrides[buildingId] ?? 'default'
  const [choice, setChoice] = useState<BuildingZoningChoice>(saved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  // A choice saved elsewhere (another control, the agent) replaces the draft.
  const [synced, setSynced] = useState(saved)
  if (synced !== saved) {
    setSynced(saved)
    setChoice(saved)
  }
  if (!building) return null

  const project = state.zoning
  const drawn = project.drawn[buildingId]
  const running = hasActiveTask(state.tasks, STAGE_IDS.preprocessing)
  const waiting = waitingReason(
    pending,
    'zoning.setBuilding',
    'the building’s zoning is being set',
  )
  const unchanged = choice === saved
  const reason =
    waiting ??
    (running
      ? '"Geospatial preprocessing" is running. Wait for it to finish before changing a building’s zoning.'
      : unchanged
        ? 'The building’s zoning has not been changed.'
        : null)
  const current = resolveBuildingZoning(project, buildingId)
  const draft =
    choice === 'default'
      ? { mode: project.mode, perimeterDepthM: project.perimeterDepthM }
      : { mode: choice, perimeterDepthM: project.perimeterDepthM }
  const draftZones = zoneBuilding(
    building,
    draft,
    building.floors,
    drawn ?? null,
  )
  const draftFallback =
    draft.mode === 'drawn' || draft.mode === 'perimeterCore'
      ? (draftZones?.fallback ??
        (draft.mode === 'drawn' && !drawn
          ? {
              code: 'drawn_zones_missing',
              message:
                'Drawn zones fell back to one zone per floor: this building has no drawn zones.',
            }
          : null))
      : null
  const save = () => {
    void client
      .execute({
        type: 'zoning.setBuilding',
        input: { buildingId, mode: choice },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setGeneral(null)
          return
        }
        const split = splitIssues(result.outcome.issues)
        setErrors(split.fieldErrors)
        setGeneral(split.general ?? split.fieldErrors.buildingId ?? null)
      })
  }
  const hint =
    choice === 'drawn'
      ? drawn
        ? `${drawnSummary(drawn)} The outlines are stored with the project; editing them is deferred.`
        : drawnSummary(drawn)
      : choice === 'default'
        ? `${HINTS.default} It is now ${describeZoning(project).toLowerCase()}.`
        : HINTS[choice]

  return (
    <section className={styles.zoningForm} aria-labelledby={titleId}>
      <h5 id={titleId} className={styles.formTitle}>
        Zoning of this building
      </h5>
      <p className={componentStyles.muted}>
        {zoning
          ? `The last run zoned it by ${describeAppliedZoning(zoning).toLowerCase()} (${ZONING_SOURCE_LABELS[publishedZoningOf(state, buildingId)?.source ?? 'default'].toLowerCase()}).`
          : 'No run has zoned this building yet.'}{' '}
        {current.source === 'override'
          ? `It overrides the project’s ${describeZoning(project).toLowerCase()}.`
          : ''}
      </p>
      <RadioGroup
        className={formStyles.field}
        value={choice}
        isInvalid={Boolean(errors.mode)}
        onChange={(value) => {
          if (!isChoice(value)) return
          setChoice(value)
          setErrors({})
          setGeneral(null)
        }}
      >
        <Label className={formStyles.label}>Zones</Label>
        <div className={`${formStyles.options} ${styles.choiceColumn}`}>
          {BUILDING_ZONING_CHOICES.map((each) => (
            <Radio key={each} value={each} className={formStyles.radio}>
              {each === 'default'
                ? `Project default (${ZONING_MODE_LABELS[project.mode]})`
                : BUILDING_ZONING_LABELS[each]}
            </Radio>
          ))}
        </div>
        <Text slot="description" className={formStyles.description}>
          {hint}
        </Text>
        <FieldError className={formStyles.fieldError}>{errors.mode}</FieldError>
      </RadioGroup>
      {choice === 'drawn' && drawn ? (
        <p className={componentStyles.muted}>
          Drawn zones: {drawn.source}.{' '}
          <CapabilityBadge id="zoning.drawnZones" />
        </p>
      ) : null}
      {!unchanged && draftFallback ? (
        <InlineAlert tone="warning">
          Expect a fallback when the stage runs: {draftFallback.message} (
          {draftFallback.code})
        </InlineAlert>
      ) : null}
      {!unchanged && !sameBuildingZoning(draft, current) ? (
        <p className={componentStyles.muted}>
          Saving zones it by {describeBuildingZoning(draft).toLowerCase()} and
          makes Geospatial preprocessing and every later stage outdated until it
          runs again.
        </p>
      ) : null}
      {!unchanged && sameBuildingZoning(draft, current) ? (
        <p className={componentStyles.muted}>
          Its zones stay the same, so saving outdates nothing.
        </p>
      ) : null}
      {general ? <InlineAlert tone="danger">{general}</InlineAlert> : null}
      <div className={styles.actions}>
        <ActionButton
          label={`Save zoning of ${building.name}`}
          variant="primary"
          disabledReason={reason}
          onPress={save}
        >
          {waiting ? 'Saving…' : 'Save building zoning'}
        </ActionButton>
      </div>
    </section>
  )
}
