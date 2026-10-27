import { useState } from 'react'

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Unsaved edits by definition ("archetype:<id>", "new:schedule"), so
 * choosing another row and coming back finds them again. They live for the
 * session and the project; Save or Cancel drops them.
 */
const unsaved = new Map<string, Record<string, unknown>>()

/** Forgets every unsaved edit, as when another project opens. */
export function forgetUnsavedEdits(): void {
  unsaved.clear()
}

export type Edits<T> = {
  /** The saved values with the edits laid over them. */
  value: T
  set: <K extends keyof T>(field: K, value: T[K]) => void
  /** Sets several fields at once. */
  patch: (values: Partial<T>) => void
  /** Whether a field differs from its saved value. */
  isEdited: (field: keyof T) => boolean
  /** How many fields differ from the saved values. */
  editedCount: number
  /** Drops every edit, back to the saved values. */
  reset: () => void
}

/**
 * Unsaved edits laid over a saved definition (decision 0028). Only edited
 * fields are kept, so a field nobody touched follows the saved value even
 * when the agent or another view changes it meanwhile.
 */
export function useEdits<T extends Record<string, unknown>>(
  saved: T,
  key: string,
): Edits<T> {
  const [edits, setEdits] = useState<Partial<T>>(
    () => (unsaved.get(key) as Partial<T> | undefined) ?? {},
  )
  const keep = (next: Partial<T>) => {
    if (Object.keys(next).length > 0) unsaved.set(key, next)
    else unsaved.delete(key)
    setEdits(next)
  }
  const fields = Object.keys(edits) as (keyof T)[]
  const isEdited = (field: keyof T) =>
    field in edits && !same(edits[field], saved[field])
  return {
    value: { ...saved, ...edits },
    set: (field, value) => keep({ ...edits, [field]: value }),
    patch: (values) => keep({ ...edits, ...values }),
    isEdited,
    editedCount: fields.filter(isEdited).length,
    reset: () => keep({}),
  }
}
