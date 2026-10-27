import { KIND_LABELS } from '../../domain/scenarios/comparison.ts'
import type {
  Archetype,
  BuildingUse,
  DefinitionSource,
  Measure,
} from '../../domain/types.ts'

// Words shared by the definition tables and the Properties panel.

export const USE_LABELS: Record<BuildingUse, string> = {
  residential: 'Residential',
  office: 'Office',
  retail: 'Retail',
  school: 'School',
  mixed: 'Mixed use',
}

export const USES = (Object.keys(USE_LABELS) as BuildingUse[]).map((value) => ({
  value,
  label: USE_LABELS[value],
}))

export const APPLIES_TO: { value: BuildingUse | 'all'; label: string }[] = [
  { value: 'all', label: 'All buildings' },
  ...USES,
]

export function appliesToLabel(appliesTo: Measure['appliesTo']): string {
  return appliesTo === 'all' ? 'All buildings' : USE_LABELS[appliesTo]
}

export function measureKindLabel(kind: Measure['kind']): string {
  return KIND_LABELS[kind]
}

export function rangeLabel(
  archetype: Pick<Archetype, 'yearFrom' | 'yearTo'>,
): string {
  if (archetype.yearFrom === null && archetype.yearTo === null)
    return 'Any year'
  if (archetype.yearFrom === null) return `Up to ${archetype.yearTo}`
  if (archetype.yearTo === null) return `From ${archetype.yearFrom}`
  return `${archetype.yearFrom} to ${archetype.yearTo}`
}

/** Why a library entry shown in Properties cannot be changed. */
export const LIBRARY_READ_ONLY =
  'Library entries are read-only. Add one to the project to edit its copy.'

/** A short source for table cells. */
export function sourceLabel(source: DefinitionSource): string {
  if (source.kind === 'library') return 'Library'
  return source.libraryId ? 'Edited library copy' : 'Project'
}

/** Where a definition came from, in a sentence. */
export function provenanceSentence(source: DefinitionSource): string {
  if (source.kind === 'library') return 'From the synthetic library.'
  return source.libraryId
    ? `Edited copy of a library definition (operation ${source.operationId}).`
    : `Created in this project (operation ${source.operationId}).`
}
