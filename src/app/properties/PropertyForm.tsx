import { useId, type ReactNode } from 'react'
import {
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from 'react-aria-components'
import { ActionButton } from '../components/ActionButton.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import styles from './properties.module.css'

type PropertyFormProps = {
  /** The kind of thing, such as "Archetype" or "New schedule". */
  eyebrow: string
  title: string
  /** Where it came from, under the title. */
  provenance?: ReactNode
  /** Badges beside the title, such as a capability status. */
  meta?: ReactNode
  /** Creating something new rather than editing something saved. */
  creating: boolean
  /** How many fields differ from the saved values. */
  editedCount: number
  /** A blocking error for the whole form. */
  error: string | null
  /** Why saving must wait, such as a request in flight. */
  waiting: string | null
  submitLabel: string
  onSubmit: () => void
  /** Discards the edits, or leaves the new definition. */
  onCancel: () => void
  children: ReactNode
}

/**
 * A definition in the Properties panel (decision 0028): what it is and where
 * it came from, its fields, and Save and Cancel. Edited fields are marked
 * until saved; Cancel discards them.
 */
export function PropertyForm({
  eyebrow,
  title,
  provenance,
  meta,
  creating,
  editedCount,
  error,
  waiting,
  submitLabel,
  onSubmit,
  onCancel,
  children,
}: PropertyFormProps) {
  const headingId = useId()
  const unchanged = !creating && editedCount === 0
  return (
    <section className={styles.definition} aria-labelledby={headingId}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <div className={styles.titleRow}>
          <h3 id={headingId} className={styles.title}>
            {title}
          </h3>
          {meta}
        </div>
        {provenance ? <p className={styles.provenance}>{provenance}</p> : null}
      </header>
      <Form
        className={styles.fields}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          if (waiting || unchanged) return
          onSubmit()
        }}
      >
        {children}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div className={styles.footer}>
          <p className={styles.editedNote} aria-live="polite">
            {creating
              ? null
              : editedCount === 0
                ? 'No unsaved edits.'
                : `${editedCount} field${editedCount === 1 ? '' : 's'} edited, not saved.`}
          </p>
          <div className={styles.footerActions}>
            <ActionButton
              label={
                creating
                  ? `Cancel the new ${eyebrow.toLowerCase()}`
                  : 'Discard the edits'
              }
              disabledReason={unchanged ? 'Nothing has been edited.' : null}
              onPress={onCancel}
            >
              Cancel
            </ActionButton>
            <button
              type="submit"
              className={cx(componentStyles.button, componentStyles.primary)}
              aria-disabled={waiting || unchanged ? true : undefined}
              title={
                waiting ?? (unchanged ? 'Nothing has been edited.' : undefined)
              }
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </Form>
    </section>
  )
}

/** A text field that marks itself while edited. */
export function TextProperty({
  label,
  value,
  edited,
  error,
  inputMode,
  description,
  onChange,
}: {
  label: string
  value: string
  edited: boolean
  error: string | undefined
  inputMode?: 'numeric' | 'decimal'
  description?: string
  onChange: (value: string) => void
}) {
  const descriptionId = useId()
  return (
    <TextField
      className={cx(formStyles.field, edited && formStyles.edited)}
      value={value}
      inputMode={inputMode}
      isInvalid={Boolean(error)}
      onChange={onChange}
      aria-describedby={description ? descriptionId : undefined}
    >
      <Label className={formStyles.label}>{label}</Label>
      <Input className={formStyles.input} />
      {description ? (
        <span id={descriptionId} className={formStyles.description}>
          {description}
        </span>
      ) : null}
      <FieldError className={formStyles.fieldError}>{error}</FieldError>
    </TextField>
  )
}

/** A native select that marks itself while edited. */
export function SelectProperty({
  label,
  value,
  edited,
  error,
  options,
  onChange,
}: {
  label: string
  value: string
  edited: boolean
  error: string | undefined
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className={cx(formStyles.field, edited && formStyles.edited)}>
      <label className={formStyles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={formStyles.input}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={`${id}-error`} className={formStyles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
