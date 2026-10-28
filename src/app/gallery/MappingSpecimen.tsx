import { useState } from 'react'
import {
  checkTarget,
  distribution,
  profileSource,
  type Suggestions,
  type TargetCheck,
  type TargetMapping,
} from '../../domain/mapping/mapping.ts'
import { schemaTargets } from '../../domain/schema/registry.ts'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { MappingReview } from '../components/MappingReview.tsx'

// The mapping review (decision 0032, stage 4) in the gallery: a few sample
// records with a pending suggestion, an unmapped compulsory field, an
// unrecognised enumerated value, and a value map; plus the waiting and empty
// states. Local state only, no project.

const RECORDS: Record<string, string | null>[] = [
  ['apartments', '4', '1905', '13.1', 'flat'],
  ['office', '9', 'c. 1960', '29.0', 'flat'],
  ['yes', '3', null, null, 'gabled'],
  ['retail', null, '1988', '48 ft', 'flat'],
  ['school', '2', '1931', '6.8', 'hipped'],
  ['apartments', '5', '1899', null, 'mansard'],
].map(([building, levels, start, height, roof]) => ({
  building: building ?? null,
  'building:levels': levels ?? null,
  start_date: start ?? null,
  height: height ?? null,
  'roof:shape': roof ?? null,
}))

const NAMES = Object.keys(RECORDS[0] ?? {})

export function MappingSpecimen({
  onNote,
  onBlocked,
}: {
  onNote: (text: string) => void
  onBlocked: (label: string, reason: string) => void
}) {
  const [mapping, setMapping] = useState<TargetMapping>({
    use: 'building',
    yearBuilt: 'start_date',
  })
  const [suggestions, setSuggestions] = useState<Suggestions>({
    floors: {
      source: 'building:levels',
      score: 1,
      reason: 'a known name for this field',
    },
  })
  const [valueMaps, setValueMaps] = useState<
    Record<string, Record<string, string>>
  >({ use: { apartments: 'residential' } })
  const [customTargets, setCustomTargets] = useState<string[]>([])
  const [chosen, setChosen] = useState<string | null>('building')
  const targets = schemaTargets({ customTargets })
  const sources = NAMES.map((name) =>
    profileSource(
      name,
      RECORDS.map((record) => record[name] ?? null),
    ),
  )
  const checks: Record<string, TargetCheck> = {}
  for (const target of targets) {
    const source = mapping[target.id]
    if (!source) continue
    checks[target.id] = checkTarget(
      target,
      source,
      RECORDS.map((record) => record[source] ?? null),
      valueMaps[target.id],
    )
  }
  const chosenSource = sources.find((source) => source.name === chosen)
  const issues = targets.flatMap((target) =>
    target.required && !mapping[target.id]
      ? [
          {
            path: `targets.${target.id}`,
            message: `${target.label} is compulsory: accept or replace the suggestion.`,
          },
        ]
      : [],
  )
  const props = {
    targets,
    sources,
    records: RECORDS.length,
    recordNoun: 'buildings',
    mapping,
    suggestions,
    issues,
    checks,
    chosenSource: chosen,
    distribution: chosenSource
      ? distribution(
          chosenSource,
          RECORDS.map((record) => record[chosenSource.name] ?? null),
        )
      : null,
    onChooseSource: (name: string) => {
      setChosen(name)
      onNote(`Showing ${name}.`)
    },
    onMap: (target: string, source: string | null) => {
      setMapping((current) => ({ ...current, [target]: source }))
      setSuggestions((current) => {
        const next = { ...current }
        delete next[target]
        return next
      })
      onNote(`${target} takes ${source ?? 'nothing'}.`)
    },
    onReview: (chosenTargets: string[], decision: 'accept' | 'reject') => {
      const reviewed =
        chosenTargets.length > 0 ? chosenTargets : Object.keys(suggestions)
      if (decision === 'accept') {
        setMapping((current) => ({
          ...current,
          ...Object.fromEntries(
            reviewed.map((target) => [target, suggestions[target]?.source]),
          ),
        }))
      }
      setSuggestions((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([target]) => !reviewed.includes(target),
          ),
        ),
      )
      onNote(
        `${decision === 'accept' ? 'Accepted' : 'Rejected'} ${reviewed.join(', ')}.`,
      )
    },
    onBlocked,
  }
  return (
    <>
      <MappingReview
        idPrefix="gallery-mapping"
        aria-label="Sample mapping"
        {...props}
        onSuggest={() => onNote('Suggest matches pressed.')}
        onMapValue={(target, value, to) => {
          setValueMaps((current) => {
            const map = { ...current[target] }
            if (to) map[value] = to
            else delete map[value]
            return { ...current, [target]: map }
          })
          onNote(`${value} reads as ${to ?? 'nothing'}.`)
        }}
        custom={{
          onAdd: (name, source) => {
            setCustomTargets((current) => [...current, name])
            setMapping((current) => ({
              ...current,
              [`custom:${name}`]: source,
            }))
            onNote(`Added ${name}.`)
            return Promise.resolve(true)
          },
          onRemove: (name) => {
            setCustomTargets((current) =>
              current.filter((item) => item !== name),
            )
            onNote(`Removed ${name}.`)
          },
        }}
      />
      <MappingReview
        idPrefix="gallery-mapping-waiting"
        aria-label="Sample mapping waiting"
        {...props}
        disabledReason="Waiting for the server to answer: the mapping is being changed."
      />
      <MappingReview
        idPrefix="gallery-mapping-empty"
        aria-label="Sample mapping without sources"
        {...props}
        sources={[]}
        empty={
          <InlineAlert tone="info" title="No source attributes yet">
            Capture footprints first; their attributes appear here.
          </InlineAlert>
        }
      />
    </>
  )
}
