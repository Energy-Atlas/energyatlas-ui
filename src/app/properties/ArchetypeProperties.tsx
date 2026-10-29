import { useState } from 'react'
import { definitionLockReason } from '../../domain/archetypes/assignment.ts'
import {
  PART_LABELS,
  archetypeIntensity,
} from '../../domain/archetypes/parts.ts'
import type { Archetype, PartKind } from '../../domain/types.ts'
import { PART_KINDS } from '../../domain/types.ts'
import { PropertyList } from '../components/PropertyList.tsx'
import { formatNumber } from '../format.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { waitingReason } from '../service/usePendingReason.ts'
import {
  PART_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../../domain/archetypes/library.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import {
  LIBRARY_READ_ONLY,
  USES,
  provenanceSentence,
} from './definitionLabels.ts'
import { PropertyForm, SelectProperty, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

type ArchetypeFields = {
  name: string
  use: Archetype['use']
  yearFrom: string
  yearTo: string
} & Record<PartKind, string>

function toFields(archetype: Archetype | null): ArchetypeFields {
  return {
    name: archetype?.name ?? '',
    use: archetype?.use ?? 'residential',
    yearFrom: archetype?.yearFrom?.toString() ?? '',
    yearTo: archetype?.yearTo?.toString() ?? '',
    construction: archetype?.parts.construction ?? '',
    systems: archetype?.parts.systems ?? '',
    spaceLoads: archetype?.parts.spaceLoads ?? '',
    externalLoads: archetype?.parts.externalLoads ?? '',
  }
}

function optionalYear(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function isUse(value: string): value is Archetype['use'] {
  return USES.some((use) => use.value === value)
}

/**
 * An archetype in Properties (decision 0032): its name, use, year range, and
 * the part of each of RC's four kinds it bundles, with the synthetic
 * intensity they give. Default rules are generated from archetypes, so a
 * change takes effect when the default rules are generated again.
 */
export function ArchetypeProperties({
  archetype,
  library = false,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new archetype. */
  archetype: Archetype | null
  /** A synthetic library entry, shown read-only (decision 0028). */
  library?: boolean
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const locked = useWorkbenchSnapshot((snapshot) =>
    definitionLockReason(snapshot.state.tasks),
  )
  const projectSchedules = useWorkbenchSnapshot(
    (snapshot) => snapshot.state.schedules,
  )
  const projectParts = useWorkbenchSnapshot((snapshot) => snapshot.state.parts)
  const inProject = useWorkbenchSnapshot((snapshot) =>
    archetype ? archetype.id in snapshot.state.archetypes : false,
  )
  // A library entry names the library parts and schedules it would bring.
  const schedules = library
    ? {
        ...Object.fromEntries(SCHEDULE_LIBRARY.map((item) => [item.id, item])),
        ...projectSchedules,
      }
    : projectSchedules
  const parts = library
    ? {
        ...Object.fromEntries(PART_LIBRARY.map((item) => [item.id, item])),
        ...projectParts,
      }
    : projectParts
  const edits = useEdits(
    toFields(archetype),
    archetype
      ? `${library ? 'library:' : ''}archetype:${archetype.id}`
      : 'new:archetype',
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

  const intensity = archetypeIntensity(
    {
      parts: Object.fromEntries(
        PART_KINDS.map((kind) => [kind, draft[kind] || null]),
      ) as Record<PartKind, string | null>,
    },
    parts,
    schedules,
  )

  const submit = () => {
    // Numbers are checked here so a blank or mistyped value is never sent as NaN.
    const local: Record<string, string> = {}
    for (const field of ['yearFrom', 'yearTo'] as const) {
      const value = optionalYear(draft[field])
      if (value !== null && !Number.isInteger(value)) {
        local[field] = 'Enter a whole year, or leave it empty.'
      }
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
          parts: Object.fromEntries(
            PART_KINDS.map((kind) => [kind, draft[kind] || null]),
          ) as Record<PartKind, string | null>,
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
      eyebrow={library ? 'Library archetype' : 'Archetype'}
      readOnly={library ? LIBRARY_READ_ONLY : null}
      actions={
        library && archetype ? (
          <ActionButton
            label={`Add ${archetype.name} to the project`}
            disabledReason={
              inProject
                ? 'Already in the project.'
                : (waitingReason(
                    pending,
                    'archetype.addFromLibrary',
                    'the archetype is being added',
                  ) ?? locked)
            }
            onPress={() =>
              void client
                .execute({
                  type: 'archetype.addFromLibrary',
                  input: { libraryId: archetype.id },
                })
                .then((result) => {
                  if (result.outcome.status === 'applied')
                    onCreated(archetype.id)
                })
            }
          >
            Add to project
          </ActionButton>
        ) : undefined
      }
      title={archetype ? archetype.name : 'New archetype'}
      provenance={archetype ? provenanceSentence(archetype.source) : undefined}
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={
        waitingReason(
          pending,
          'archetype.save',
          'the archetype is being saved',
        ) ?? locked
      }
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
      {PART_KINDS.map((kind) => (
        <SelectProperty
          key={kind}
          label={`${PART_LABELS[kind]} part`}
          value={draft[kind]}
          edited={highlight(kind)}
          error={
            errors[`parts.${kind}`] ??
            (kind === 'construction' ? errors.parts : undefined)
          }
          options={[
            { value: '', label: 'None' },
            ...Object.values(parts)
              .filter((part) => part.kind === kind)
              .map((part) => ({ value: part.id, label: part.name })),
          ]}
          onChange={(value) => update(kind, value)}
        />
      ))}
      <PropertyList
        items={[
          {
            label: 'Energy use intensity',
            value: intensity
              ? formatNumber(intensity.total, {
                  maxDigits: 1,
                  unit: 'kWh/m² a year (synthetic)',
                })
              : 'Needs all four parts',
          },
        ]}
      />
    </PropertyForm>
  )
}
