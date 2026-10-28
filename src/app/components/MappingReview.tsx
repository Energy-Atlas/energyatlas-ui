import { Check, Plus, Sparkles, X } from 'lucide-react'
import { Fragment, useId, useState, type ReactNode } from 'react'
import type { ValidationIssue } from '../../domain/commands.ts'
import {
  MAPPING_TIERS,
  TIER_LABELS,
  describeTargetType,
  type Bucket,
  type SourceAttribute,
  type Suggestions,
  type TargetCheck,
  type TargetMapping,
  type TargetSpec,
} from '../../domain/mapping/mapping.ts'
import { cx } from '../cx.ts'
import { formatNumber } from '../format.ts'
import componentStyles from './components.module.css'
import formStyles from './forms.module.css'
import { InlineAlert } from './InlineAlert.tsx'
import styles from './mappingReview.module.css'
import { SelectableList } from './SelectableList.tsx'
import { Toolbar, type ToolbarItem } from './Toolbar.tsx'

export type MappingReviewProps = {
  /** Prefixes element ids, so two reviews can be on screen at once. */
  idPrefix: string
  'aria-label': string
  targets: TargetSpec[]
  sources: SourceAttribute[]
  /** Records in the source, such as buildings or dataset rows. */
  records: number
  /** What a record is called, plural: "buildings", "records". */
  recordNoun: string
  mapping: TargetMapping
  suggestions: Suggestions
  /**
   * Blocking problems: `targets.<id>` on that target, `custom.name` and
   * `custom.source` on the custom form, anything else above the targets.
   */
  issues: ValidationIssue[]
  checks: Record<string, TargetCheck>
  chosenSource: string | null
  distribution: Bucket[] | null
  onChooseSource: (name: string) => void
  onMap: (target: string, source: string | null) => void
  onReview: (targets: string[], decision: 'accept' | 'reject') => void
  /** RC's "Fuzzy Match All"; left out where the host suggests on its own. */
  onSuggest?: () => void
  /** Reads unrecognised enumerated values as allowed ones; without it they are only listed. */
  onMapValue?: (target: string, value: string, to: string | null) => void
  /** RC's Custom tab: user-named targets copied as text. */
  custom?: {
    /** Resolves true when the target was added, which clears the form. */
    onAdd: (name: string, source: string) => Promise<boolean>
    onRemove: (name: string) => void
  }
  /** Why the mapping cannot be changed now; it stays readable. */
  disabledReason?: string | null
  onBlocked?: (label: string, reason: string) => void
  /** More actions for the target toolbar, such as rule sets. */
  extraItems?: ToolbarItem[]
  /** Shown instead of the review when the source has no attributes. */
  empty?: ReactNode
}

function percent(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'
}

/** Values of the chosen source attribute as a bar list with counts. */
function DistributionView({
  name,
  buckets,
  total,
}: {
  name: string
  buckets: Bucket[]
  total: number
}) {
  const headingId = useId()
  const largest = Math.max(1, ...buckets.map((bucket) => bucket.count))
  return (
    <section className={styles.distribution} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.heading}>
        Values of {name}
      </h4>
      <table className={cx(componentStyles.table, styles.bars)}>
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">Count</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.label}>
              <th scope="row">{bucket.label}</th>
              <td className={styles.number}>{formatNumber(bucket.count)}</td>
              <td className={styles.share}>
                <span
                  className={styles.bar}
                  style={{ inlineSize: `${(bucket.count / largest) * 100}%` }}
                  aria-hidden="true"
                />
                <span className={styles.shareText}>
                  {percent(bucket.count, total)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** What reading the mapped source gives the target. */
function ValuesCell({
  target,
  check,
  recordNoun,
  selectId,
  disabled,
  onMapValue,
}: {
  target: TargetSpec
  check: TargetCheck | undefined
  recordNoun: string
  selectId: string
  disabled: boolean
  onMapValue?: MappingReviewProps['onMapValue']
}) {
  if (!check) {
    return <span className={componentStyles.muted}>{target.fallback}</span>
  }
  const parts = [
    `${formatNumber(check.valid)} of ${formatNumber(check.records)} ${recordNoun} take a value`,
    ...(check.missing > 0 ? [`${formatNumber(check.missing)} missing`] : []),
    ...(check.invalid > 0
      ? [
          `${formatNumber(check.invalid)} not valid (${check.invalidExamples.map((example) => `"${example}"`).join(', ')})`,
        ]
      : []),
  ]
  const unread = check.enumValues.filter((entry) => entry.readAs === null)
  return (
    <div className={styles.values}>
      <span>{parts.join('; ')}.</span>
      {target.unit ? (
        <span className={componentStyles.muted}>
          Read as {target.unit}; units are not converted.
        </span>
      ) : null}
      {check.missing + check.invalid > 0 || unread.length > 0 ? (
        <span className={componentStyles.muted}>{target.fallback}</span>
      ) : null}
      {check.enumValues.length > 0 ? (
        <table className={cx(componentStyles.table, styles.enumTable)}>
          <caption className={styles.caption}>
            {unread.length > 0
              ? `${unread.length} value${unread.length === 1 ? ' is' : 's are'} not recognised`
              : 'Every value is recognised'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Source value</th>
              <th scope="col">Count</th>
              <th scope="col">Read as</th>
            </tr>
          </thead>
          <tbody>
            {check.enumValues.map((entry, index) => {
              const id = `${selectId}-value-${index}`
              return (
                <tr
                  key={entry.value}
                  className={entry.readAs ? undefined : styles.unread}
                >
                  <th scope="row">
                    <label htmlFor={id}>{entry.value}</label>
                  </th>
                  <td className={styles.number}>{formatNumber(entry.count)}</td>
                  <td>
                    {entry.via === 'alias' || !onMapValue ? (
                      <span id={id}>
                        {entry.readAs
                          ? `${entry.readAs}${entry.via === 'alias' ? ' (code)' : ''}`
                          : 'Not recognised'}
                      </span>
                    ) : (
                      <select
                        id={id}
                        className={formStyles.input}
                        aria-label={`Read "${entry.value}" as`}
                        value={entry.readAs ?? ''}
                        disabled={disabled}
                        onChange={(event) =>
                          onMapValue(
                            target.id,
                            entry.value,
                            event.target.value || null,
                          )
                        }
                      >
                        <option value="">Not read</option>
                        {(target.allowed ?? []).map((allowed) => (
                          <option key={allowed} value={allowed}>
                            {allowed}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

/**
 * A mapping review (decision 0032, stage 4), shared by Schema matching and
 * Data intake: the source attributes with their type, an example, and the
 * chosen one's value distribution, beside the target fields in RC's tiers.
 * Each target takes one source; suggestions wait to be accepted or rejected;
 * each mapped target shows what its values give, with unrecognised values of
 * enumerated targets and their counts. Changes go to the host's callbacks.
 */
export function MappingReview({
  idPrefix,
  'aria-label': ariaLabel,
  targets,
  sources,
  records,
  recordNoun,
  mapping,
  suggestions,
  issues,
  checks,
  chosenSource,
  distribution,
  onChooseSource,
  onMap,
  onReview,
  onSuggest,
  onMapValue,
  custom,
  disabledReason = null,
  onBlocked,
  extraItems = [],
  empty,
}: MappingReviewProps) {
  const [customName, setCustomName] = useState('')
  const [customSource, setCustomSource] = useState('')
  const disabled = Boolean(disabledReason)
  const pending = Object.keys(suggestions).filter((target) =>
    targets.some((item) => item.id === target),
  )
  const mappedBy = (source: string) =>
    targets
      .filter((target) => mapping[target.id] === source)
      .map((target) => target.label)
  const issueOf = (path: string) =>
    issues.find((issue) => issue.path === path)?.message ?? null
  const general = issues.filter(
    (issue) =>
      !issue.path.startsWith('targets.') && !issue.path.startsWith('custom.'),
  )
  const guarded = (label: string, action: () => void) => () => {
    if (disabledReason) onBlocked?.(label, disabledReason)
    else action()
  }

  if (sources.length === 0 && empty) {
    return (
      <section className={styles.review} aria-label={ariaLabel}>
        {empty}
      </section>
    )
  }

  const toolbar: ToolbarItem[] = [
    ...(onSuggest
      ? [
          {
            id: 'suggest',
            label: 'Suggest matches',
            icon: Sparkles,
            disabledReason,
            onPress: onSuggest,
          },
        ]
      : []),
    {
      id: 'accept',
      label: `Accept all suggestions (${pending.length})`,
      icon: Check,
      disabledReason:
        disabledReason ??
        (pending.length === 0 ? 'There are no suggestions to review.' : null),
      onPress: () => onReview([], 'accept'),
    },
    {
      id: 'reject',
      label: 'Reject all suggestions',
      icon: X,
      disabledReason:
        disabledReason ??
        (pending.length === 0 ? 'There are no suggestions to review.' : null),
      onPress: () => onReview([], 'reject'),
    },
    ...extraItems,
  ]

  return (
    <section className={styles.review} aria-label={ariaLabel}>
      <div className={styles.sources}>
        <h3 className={styles.heading}>Source attributes</h3>
        <SelectableList
          aria-label="Source attributes"
          items={sources.map((source) => {
            const mappedTo = mappedBy(source.name)
            return {
              id: source.name,
              title: source.name,
              status: <span className={styles.type}>{source.type}</span>,
              meta: `${source.example === null ? 'no values' : `e.g. ${source.example}`}; ${formatNumber(source.present)} of ${formatNumber(source.present + source.missing)} present${mappedTo.length > 0 ? `; to ${mappedTo.join(', ')}` : '; not mapped'}`,
              description: `${source.type}, ${source.example === null ? 'no values' : `example ${source.example}`}, ${source.present} present, ${mappedTo.length > 0 ? `mapped to ${mappedTo.join(', ')}` : 'not mapped'}`,
            }
          })}
          selectedId={chosenSource}
          onSelect={onChooseSource}
        />
        {chosenSource && distribution ? (
          <DistributionView
            name={chosenSource}
            buckets={distribution}
            total={records}
          />
        ) : (
          <p className={componentStyles.muted}>
            Choose an attribute to see its values.
          </p>
        )}
      </div>

      <div className={styles.targets}>
        <h3 className={styles.heading}>Target fields</h3>
        <Toolbar
          aria-label="Mapping actions"
          items={toolbar}
          onBlocked={(item, reason) =>
            onBlocked?.(item.ariaLabel ?? item.label, reason)
          }
        />
        {disabledReason ? (
          <InlineAlert tone="info" title="The mapping cannot change now">
            {disabledReason}
          </InlineAlert>
        ) : null}
        {general.length > 0 ? (
          <InlineAlert tone="danger" title="Fix the mapping">
            <ul className={styles.list}>
              {general.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}
        {pending.length > 0 ? (
          <InlineAlert tone="info" title="Suggestions to review">
            {pending.length} suggested match{pending.length === 1 ? '' : 'es'}{' '}
            {pending.length === 1 ? 'waits' : 'wait'} for review. A suggestion
            is not used until it is accepted.
          </InlineAlert>
        ) : null}
        <table className={cx(componentStyles.table, styles.form)}>
          <thead>
            <tr>
              <th scope="col">Target field</th>
              <th scope="col">Source attribute</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            {MAPPING_TIERS.map((tier) => {
              const inTier = targets.filter((target) => target.tier === tier)
              if (inTier.length === 0 && !(tier === 'custom' && custom)) {
                return null
              }
              const groups = [
                ...new Set(inTier.map((target) => target.group ?? '')),
              ]
              return (
                <Fragment key={tier}>
                  <tr className={styles.tierRow}>
                    <th scope="colgroup" colSpan={3}>
                      {TIER_LABELS[tier]}
                    </th>
                  </tr>
                  {groups.flatMap((group) => [
                    ...(group
                      ? [
                          <tr
                            key={`group-${group}`}
                            className={styles.groupRow}
                          >
                            <th scope="colgroup" colSpan={3}>
                              {group}
                            </th>
                          </tr>,
                        ]
                      : []),
                    ...inTier
                      .filter((target) => (target.group ?? '') === group)
                      .map((target) => {
                        const selectId = `${idPrefix}-target-${target.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
                        const issue = issueOf(`targets.${target.id}`)
                        const suggestion = suggestions[target.id]
                        const source = mapping[target.id] ?? null
                        const known = sources.some(
                          (item) => item.name === source,
                        )
                        const tone = cx(
                          issue && styles.invalid,
                          suggestion && styles.suggested,
                        )
                        return (
                          <Fragment key={target.id}>
                            <tr className={cx(tone, styles.mainRow)}>
                              <th scope="row">
                                <label htmlFor={selectId}>{target.label}</label>
                                <span className={styles.targetType}>
                                  {describeTargetType(target)}
                                  {target.required ? '; compulsory' : ''}
                                </span>
                              </th>
                              <td>
                                <select
                                  id={selectId}
                                  className={formStyles.input}
                                  value={source ?? ''}
                                  disabled={disabled}
                                  aria-invalid={issue ? true : undefined}
                                  aria-describedby={
                                    issue ? `${selectId}-issue` : undefined
                                  }
                                  title={target.description}
                                  onChange={(event) =>
                                    onMap(target.id, event.target.value || null)
                                  }
                                >
                                  {tier === 'custom' ? null : (
                                    <option value="">Not mapped</option>
                                  )}
                                  {source && !known ? (
                                    <option value={source}>
                                      {source} (missing)
                                    </option>
                                  ) : null}
                                  {sources.map((item) => (
                                    <option key={item.name} value={item.name}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                {issue ? (
                                  <span
                                    id={`${selectId}-issue`}
                                    className={styles.issue}
                                  >
                                    {issue}
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                {suggestion ? (
                                  <div className={styles.suggestion}>
                                    <span>
                                      Suggested{' '}
                                      <strong>{suggestion.source}</strong>:{' '}
                                      {suggestion.reason}
                                    </span>
                                    <span className={styles.buttons}>
                                      <button
                                        type="button"
                                        className={componentStyles.button}
                                        aria-label={`Accept "${suggestion.source}" for ${target.label}`}
                                        aria-disabled={disabled || undefined}
                                        title={disabledReason ?? undefined}
                                        onClick={guarded(
                                          `Accept "${suggestion.source}" for ${target.label}`,
                                          () => onReview([target.id], 'accept'),
                                        )}
                                      >
                                        Accept
                                      </button>
                                      <button
                                        type="button"
                                        className={componentStyles.button}
                                        aria-label={`Reject "${suggestion.source}" for ${target.label}`}
                                        aria-disabled={disabled || undefined}
                                        title={disabledReason ?? undefined}
                                        onClick={guarded(
                                          `Reject "${suggestion.source}" for ${target.label}`,
                                          () => onReview([target.id], 'reject'),
                                        )}
                                      >
                                        Reject
                                      </button>
                                    </span>
                                  </div>
                                ) : tier === 'custom' && custom ? (
                                  <button
                                    type="button"
                                    className={componentStyles.button}
                                    aria-label={`Remove the custom target ${target.label}`}
                                    aria-disabled={disabled || undefined}
                                    title={disabledReason ?? undefined}
                                    onClick={guarded(
                                      `Remove the custom target ${target.label}`,
                                      () => custom.onRemove(target.label),
                                    )}
                                  >
                                    Remove
                                  </button>
                                ) : (
                                  <span className={componentStyles.muted}>
                                    {source ? 'Mapped' : 'Not mapped'}
                                  </span>
                                )}
                              </td>
                            </tr>
                            <tr className={cx(tone, styles.detailRow)}>
                              <td colSpan={3}>
                                <ValuesCell
                                  target={target}
                                  check={checks[target.id]}
                                  recordNoun={recordNoun}
                                  selectId={selectId}
                                  disabled={disabled}
                                  onMapValue={onMapValue}
                                />
                              </td>
                            </tr>
                          </Fragment>
                        )
                      }),
                  ])}
                  {tier === 'custom' && custom ? (
                    <tr key="custom-add" className={styles.addRow}>
                      <th scope="row">
                        <label htmlFor={`${idPrefix}-custom-name`}>
                          New custom target
                        </label>
                        <input
                          id={`${idPrefix}-custom-name`}
                          className={formStyles.input}
                          value={customName}
                          placeholder="e.g. roof_shape"
                          disabled={disabled}
                          aria-invalid={
                            issueOf('custom.name') ? true : undefined
                          }
                          aria-describedby={
                            issueOf('custom.name')
                              ? `${idPrefix}-custom-name-issue`
                              : undefined
                          }
                          onChange={(event) =>
                            setCustomName(event.target.value)
                          }
                        />
                        {issueOf('custom.name') ? (
                          <span
                            id={`${idPrefix}-custom-name-issue`}
                            className={styles.issue}
                          >
                            {issueOf('custom.name')}
                          </span>
                        ) : null}
                      </th>
                      <td>
                        <select
                          aria-label="Source attribute for the new custom target"
                          className={formStyles.input}
                          value={customSource}
                          disabled={disabled}
                          onChange={(event) =>
                            setCustomSource(event.target.value)
                          }
                        >
                          <option value="">Choose an attribute</option>
                          {sources.map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        {issueOf('custom.source') ? (
                          <span className={styles.issue}>
                            {issueOf('custom.source')}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={componentStyles.button}
                          aria-label="Add the custom target"
                          aria-disabled={
                            disabled ||
                            !customName.trim() ||
                            !customSource ||
                            undefined
                          }
                          title={
                            disabledReason ??
                            (!customName.trim()
                              ? 'Name the custom target first.'
                              : !customSource
                                ? 'Choose its source attribute first.'
                                : 'Add the custom target')
                          }
                          onClick={() => {
                            const reason =
                              disabledReason ??
                              (!customName.trim()
                                ? 'Name the custom target first.'
                                : !customSource
                                  ? 'Choose its source attribute first.'
                                  : null)
                            if (reason) {
                              onBlocked?.('Add the custom target', reason)
                              return
                            }
                            void custom
                              .onAdd(customName.trim(), customSource)
                              .then((added) => {
                                if (!added) return
                                setCustomName('')
                                setCustomSource('')
                              })
                          }}
                        >
                          <Plus size={14} aria-hidden="true" /> Add
                        </button>
                        <span className={componentStyles.muted}>
                          {' '}
                          Custom targets copy the attribute as text and keep it
                          with each {recordNoun.replace(/s$/, '')}.
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
