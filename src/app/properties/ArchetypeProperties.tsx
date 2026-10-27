import { useState } from 'react'
import type { Archetype } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import { USES, provenanceSentence } from './definitionLabels.ts'
import { PropertyForm, SelectProperty, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

type ArchetypeFields = {
  name: string
  use: Archetype['use']
  yearFrom: string
  yearTo: string
  euiKwhPerM2: string
  scheduleId: string
}

function toFields(archetype: Archetype | null): ArchetypeFields {
  return {
    name: archetype?.name ?? '',
    use: archetype?.use ?? 'residential',
    yearFrom: archetype?.yearFrom?.toString() ?? '',
    yearTo: archetype?.yearTo?.toString() ?? '',
    euiKwhPerM2: archetype?.euiKwhPerM2.toString() ?? '150',
    scheduleId: archetype?.scheduleId ?? '',
  }
}

function optionalYear(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function isUse(value: string): value is Archetype['use'] {
  return USES.some((use) => use.value === value)
}

/**
 * An archetype in Properties: its name, use, year range, energy use
 * intensity, and schedule. Saving outdates Archetype modeling; buildings
 * change only when assignment runs again.
 */
export function ArchetypeProperties({
  archetype,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new archetype. */
  archetype: Archetype | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const schedules = useWorkbenchSnapshot((snapshot) => snapshot.state.schedules)
  const edits = useEdits(
    toFields(archetype),
    archetype ? `archetype:${archetype.id}` : 'new:archetype',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = archetype === null
  const highlight = (field: keyof ArchetypeFields) =>
    !creating && edits.isEdited(field)
  const update = <K extends keyof ArchetypeFields>(
    field: K,
    value: ArchetypeFields[K],
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
    // Numbers are checked here so a blank or mistyped value is never sent as NaN.
    const local: Record<string, string> = {}
    for (const field of ['yearFrom', 'yearTo'] as const) {
      const value = optionalYear(draft[field])
      if (value !== null && !Number.isInteger(value)) {
        local[field] = 'Enter a whole year, or leave it empty.'
      }
    }
    if (
      !draft.euiKwhPerM2.trim() ||
      !Number.isFinite(Number(draft.euiKwhPerM2))
    ) {
      local.euiKwhPerM2 = 'Enter the energy use intensity as a number.'
    }
    if (Object.keys(local).length > 0) {
      setErrors(local)
      setError(null)
      return
    }
    void client
      .execute({
        type: 'archetype.save',
        input: {
          ...(archetype ? { id: archetype.id } : {}),
          name: draft.name,
          use: draft.use,
          yearFrom: optionalYear(draft.yearFrom),
          yearTo: optionalYear(draft.yearTo),
          euiKwhPerM2: Number(draft.euiKwhPerM2),
          scheduleId: draft.scheduleId || null,
        },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setError(null)
          edits.reset()
          if (creating) {
            const created = Object.values(workbench.getState().archetypes).find(
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
      eyebrow="Archetype"
      title={archetype ? archetype.name : 'New archetype'}
      provenance={archetype ? provenanceSentence(archetype.source) : undefined}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={waitingReason(
        pending,
        'archetype.save',
        'the archetype is being saved',
      )}
      submitLabel={creating ? 'Create archetype' : 'Save archetype'}
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
        label="Archetype name"
        value={draft.name}
        edited={highlight('name')}
        error={errors.name}
        onChange={(value) => update('name', value)}
      />
      <SelectProperty
        label="Building use"
        value={draft.use}
        edited={highlight('use')}
        error={errors.use}
        options={USES}
        onChange={(value) => {
          if (isUse(value)) update('use', value)
        }}
      />
      <TextProperty
        label="Built from (year, optional)"
        value={draft.yearFrom}
        inputMode="numeric"
        edited={highlight('yearFrom')}
        error={errors.yearFrom}
        onChange={(value) => update('yearFrom', value)}
      />
      <TextProperty
        label="Built to (year, optional)"
        value={draft.yearTo}
        inputMode="numeric"
        edited={highlight('yearTo')}
        error={errors.yearTo}
        onChange={(value) => update('yearTo', value)}
      />
      <TextProperty
        label="Energy use intensity (kWh/m² per year)"
        value={draft.euiKwhPerM2}
        inputMode="decimal"
        edited={highlight('euiKwhPerM2')}
        error={errors.euiKwhPerM2}
        onChange={(value) => update('euiKwhPerM2', value)}
      />
      <SelectProperty
        label="Schedule"
        value={draft.scheduleId}
        edited={highlight('scheduleId')}
        error={errors.scheduleId}
        options={[
          { value: '', label: 'None' },
          ...Object.values(schedules).map((schedule) => ({
            value: schedule.id,
            label: schedule.name,
          })),
        ]}
        onChange={(value) => update('scheduleId', value)}
      />
    </PropertyForm>
  )
}
