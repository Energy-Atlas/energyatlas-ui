import { useMemo, useState } from 'react'
import { FUEL_LABELS, PART_LABELS } from '../../domain/archetypes/parts.ts'
import type { ArchetypePart, PartKind } from '../../domain/types.ts'
import { PART_KINDS } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { PropertyList } from '../components/PropertyList.tsx'
import { waitingReason } from '../service/usePendingReason.ts'
import { provenanceSentence } from './definitionLabels.ts'
import { PropertyForm, SelectProperty, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

/** The numeric fields of each part kind, in form order. */
export const PART_NUMBER_FIELDS: Record<
  PartKind,
  { key: string; label: string; fallback: number }[]
> = {
  construction: [
    { key: 'wallU', label: 'Wall U-value (W/m²K)', fallback: 0.6 },
    { key: 'roofU', label: 'Roof U-value (W/m²K)', fallback: 0.4 },
    { key: 'windowU', label: 'Window U-value (W/m²K)', fallback: 2 },
    { key: 'windowRatio', label: 'Window ratio (0 to 0.9)', fallback: 0.3 },
    {
      key: 'infiltrationAch',
      label: 'Infiltration (air changes per hour)',
      fallback: 0.5,
    },
  ],
  systems: [
    {
      key: 'heatingEfficiency',
      label: 'Heating efficiency or COP',
      fallback: 0.9,
    },
    { key: 'coolingCop', label: 'Cooling COP', fallback: 3 },
    {
      key: 'hotWaterKwhPerM2',
      label: 'Hot water (kWh/m² per year)',
      fallback: 15,
    },
  ],
  spaceLoads: [
    { key: 'lightingWPerM2', label: 'Lighting (W/m²)', fallback: 8 },
    { key: 'equipmentWPerM2', label: 'Equipment (W/m²)', fallback: 8 },
    { key: 'm2PerPerson', label: 'Floor area per person (m²)', fallback: 20 },
  ],
  externalLoads: [
    {
      key: 'exteriorLightingKwhPerM2',
      label: 'Exterior lighting (kWh/m² per year)',
      fallback: 2,
    },
    {
      key: 'processKwhPerM2',
      label: 'Process loads (kWh/m² per year)',
      fallback: 5,
    },
  ],
}

type PartFields = Record<string, string>

function toFields(kind: PartKind, part: ArchetypePart | null): PartFields {
  const values = (part ?? {}) as Record<string, unknown>
  const fields: PartFields = { name: part?.name ?? '' }
  for (const { key, fallback } of PART_NUMBER_FIELDS[kind]) {
    const value = values[key]
    fields[key] = String(typeof value === 'number' ? value : fallback)
  }
  if (kind === 'systems') {
    fields.fuel = typeof values.fuel === 'string' ? values.fuel : 'gas'
  }
  if (kind === 'spaceLoads') {
    fields.scheduleId =
      typeof values.scheduleId === 'string' ? values.scheduleId : ''
  }
  return fields
}

/**
 * An archetype part in Properties (decision 0032): one of RC's four kinds,
 * with the synthetic values the demand formula reads. Saving a part that
 * rules or buildings use outdates Archetype modeling.
 */
export function PartProperties({
  kind,
  part,
  onCreated,
  onCancelCreate,
}: {
  kind: PartKind
  /** Null creates a new part of the kind. */
  part: ArchetypePart | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const schedules = useWorkbenchSnapshot((snapshot) => snapshot.state.schedules)
  const rules = useWorkbenchSnapshot((snapshot) => snapshot.state.rules)
  const archetypes = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.archetypes,
  )
  const usage = useMemo(() => {
    const uses = (parts: Record<PartKind, string | null>) =>
      part !== null && PART_KINDS.some((each) => parts[each] === part.id)
    return {
      rules: Object.values(rules).filter((rule) => uses(rule.parts)).length,
      archetypes: Object.values(archetypes).filter((item) => uses(item.parts))
        .length,
    }
  }, [part, rules, archetypes])
  const saved = useMemo(() => toFields(kind, part), [kind, part])
  const edits = useEdits(saved, part ? `part:${part.id}` : `new:part:${kind}`)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = part === null
  const label = PART_LABELS[kind]
  const update = (field: string, value: string) => {
    edits.set(field, value)
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const submit = () => {
    const local: Record<string, string> = {}
    const numbers: Record<string, number> = {}
    for (const { key } of PART_NUMBER_FIELDS[kind]) {
      const text = (draft[key] ?? '').trim()
      const value = Number(text)
      if (!text || !Number.isFinite(value)) local[key] = 'Enter a number.'
      else numbers[key] = value
    }
    if (Object.keys(local).length > 0) {
      setErrors(local)
      setError(null)
      return
    }
    const input = {
      name: draft.name ?? '',
      ...(part ? { id: part.id } : {}),
      kind,
      ...numbers,
      ...(kind === 'systems' ? { fuel: draft.fuel } : {}),
      ...(kind === 'spaceLoads'
        ? { scheduleId: draft.scheduleId || null }
        : {}),
    }
    void client
      .execute({ type: 'part.save', input } as Parameters<
        typeof client.execute
      >[0])
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setError(null)
          edits.reset()
          if (creating) {
            const created = Object.values(workbench.getState().parts).find(
              (item) => item.name === (draft.name ?? '').trim(),
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
      eyebrow={creating ? `New ${label.toLowerCase()} part` : `${label} part`}
      title={part ? part.name : `New ${label.toLowerCase()} part`}
      provenance={part ? provenanceSentence(part.source) : undefined}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={waitingReason(pending, 'part.save', 'the part is being saved')}
      submitLabel={creating ? 'Create part' : 'Save part'}
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
        label="Part name"
        value={draft.name ?? ''}
        edited={!creating && edits.isEdited('name')}
        error={errors.name}
        onChange={(value) => update('name', value)}
      />
      {kind === 'systems' ? (
        <SelectProperty
          label="Fuel"
          value={draft.fuel ?? 'gas'}
          edited={!creating && edits.isEdited('fuel')}
          error={errors.fuel}
          options={Object.entries(FUEL_LABELS).map(([value, text]) => ({
            value,
            label: text,
          }))}
          onChange={(value) => update('fuel', value)}
        />
      ) : null}
      {PART_NUMBER_FIELDS[kind].map(({ key, label: fieldLabel }) => (
        <TextProperty
          key={key}
          label={fieldLabel}
          value={draft[key] ?? ''}
          inputMode="decimal"
          edited={!creating && edits.isEdited(key)}
          error={errors[key]}
          onChange={(value) => update(key, value)}
        />
      ))}
      {kind === 'spaceLoads' ? (
        <SelectProperty
          label="Occupancy schedule"
          value={draft.scheduleId ?? ''}
          edited={!creating && edits.isEdited('scheduleId')}
          error={errors.scheduleId}
          options={[
            { value: '', label: 'None (a flat half load)' },
            ...Object.values(schedules).map((schedule) => ({
              value: schedule.id,
              label: schedule.name,
            })),
          ]}
          onChange={(value) => update('scheduleId', value)}
        />
      ) : null}
      {part ? (
        <PropertyList
          items={[
            { label: 'Used by rules', value: String(usage.rules) },
            { label: 'Used by archetypes', value: String(usage.archetypes) },
          ]}
        />
      ) : null}
    </PropertyForm>
  )
}
