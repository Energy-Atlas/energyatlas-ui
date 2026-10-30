import { Download, FolderOpen, Trash2, Upload } from 'lucide-react'
import { FieldError, Input, Label, TextField } from 'react-aria-components'
import { useId, useMemo, useRef, useState } from 'react'
import {
  BUILT_IN_RULE_SET_ID,
  stageSubmitBlocker,
  type ValidationIssue,
} from '../../../domain/commands.ts'
import {
  reviewSchema,
  sourceDistribution,
} from '../../../domain/schema/matching.ts'
import {
  BUILT_IN_RULE_SET,
  createSchemaMatching,
} from '../../../domain/schema/registry.ts'
import {
  checkRuleSet,
  currentMappings,
  parseRuleSetFile,
  ruleSetFile,
} from '../../../domain/schema/ruleSets.ts'
import type { Command } from '../../../domain/commands.ts'
import type { SchemaRuleSet } from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import {
  ActionButton,
  useRecordBlocked,
} from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import componentStyles from '../../components/components.module.css'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { EmptyState } from '../../components/EmptyState.tsx'
import formStyles from '../../components/forms.module.css'
import { cx } from '../../cx.ts'
import { InlineAlert } from '../../components/InlineAlert.tsx'
import { MappingReview } from '../../components/MappingReview.tsx'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { PropertyList } from '../../components/PropertyList.tsx'
import { SelectableList } from '../../components/SelectableList.tsx'
import { StateBadge } from '../../components/StateBadge.tsx'
import { Toolbar } from '../../components/Toolbar.tsx'
import { downloadText, fileSlug } from '../../csv.ts'
import { formatDateTime } from '../../format.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import styles from './schema.module.css'

const SCHEMA_COMMANDS = [
  'schema.mapTarget',
  'schema.reviewSuggestions',
  'schema.suggest',
  'schema.mapValue',
  'schema.addCustomTarget',
  'schema.removeCustomTarget',
  'schema.saveRuleSet',
  'schema.loadRuleSet',
  'schema.deleteRuleSet',
] as const

type Notice = { tone: 'success' | 'warning' | 'danger'; text: string }

/**
 * Reports a rule set operation as a message (decision 0036), never as a
 * notice that pushes the section down. Applied and refused commands already
 * report themselves; this adds what they do not say: skipped mappings, and a
 * file that could not be read before any command was sent.
 */
function useRuleSetNotice() {
  const { messages, workbench } = useServices()
  return (notice: Notice | null) => {
    if (!notice || notice.tone === 'success') return
    messages.post({
      tone: notice.tone,
      source: 'project',
      projectId: workbench.getState().project.id,
      text: notice.text,
      toast: true,
    })
  }
}

/**
 * Schema matching (decision 0032, stage 4): review how the captured
 * footprints' attributes map to the model's target fields, save and load
 * rule sets, and run the stage to apply the mapping as a job. Every change
 * is a server command; nothing changes the buildings until the run
 * publishes.
 */
export function SchemaMatchingPage() {
  const headingId = useId()
  const services = useServices()
  const { client, view, layout } = services
  const recordBlocked = useRecordBlocked()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const chosen = useViewState((current) => current.schema.source)
  const stageState = useStageStates()[STAGE_IDS.schema] ?? 'future'
  const review = useMemo(() => reviewSchema(state), [state])
  const matching = state.schemaMatching
  const published = matching.published
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const setNotice = useRuleSetNotice()
  // Deleting a rule set or removing a custom target asks first (decision 0036).
  const [confirming, setConfirming] = useState<
    | { kind: 'ruleSet'; id: string; name: string }
    | { kind: 'target'; name: string }
    | null
  >(null)
  const [ruleSetName, setRuleSetName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [chosenSet, setChosenSet] = useState<string>(BUILT_IN_RULE_SET_ID)
  const fileRef = useRef<HTMLInputElement>(null)

  const source =
    chosen && review.collection.names.includes(chosen)
      ? chosen
      : (review.collection.names[1] ?? review.collection.names[0] ?? null)
  const distribution = source
    ? sourceDistribution(review.collection, source)
    : null

  const active = Object.values(state.tasks).some(
    (task) => task.status === 'queued' || task.status === 'running',
  )
  const editBlocker =
    SCHEMA_COMMANDS.map((type) =>
      waitingReason(pending, type, 'the mapping is being changed'),
    ).find(Boolean) ??
    (active
      ? 'A job is queued or running. The mapping can change when it finishes.'
      : null)
  const runBlocker =
    waitingReason(
      pending,
      'workflow.runStage',
      'the run is being queued',
      (input) => (input as { stageId?: unknown }).stageId === STAGE_IDS.schema,
    ) ?? stageSubmitBlocker(state, STAGE_IDS.schema)

  /** Sends a command; its rejection shows where it applies. */
  async function send(
    command: Command,
    paths: Record<string, string> = {},
  ): Promise<boolean> {
    const result = await client.execute(command)
    if (result.outcome.status === 'applied') {
      setIssues([])
      return true
    }
    setIssues(
      result.outcome.issues.map((issue) => ({
        ...issue,
        path: paths[issue.path] ?? '',
      })),
    )
    return false
  }

  const ruleSets: { id: string; ruleSet: SchemaRuleSet | null }[] = [
    { id: BUILT_IN_RULE_SET_ID, ruleSet: null },
    ...matching.ruleSetIds.flatMap((id) => {
      const ruleSet = matching.ruleSets[id]
      return ruleSet ? [{ id, ruleSet }] : []
    }),
  ]
  const selectedSet =
    ruleSets.find((entry) => entry.id === chosenSet) ?? ruleSets[0]
  const builtIn = createSchemaMatching()
  const selectedContent = selectedSet?.ruleSet ?? {
    mappings: currentMappings(builtIn),
    valueMaps: builtIn.valueMaps,
  }
  const selectedName = selectedSet?.ruleSet?.name ?? BUILT_IN_RULE_SET
  const selectedCheck = checkRuleSet(state, selectedContent)
  const noSources = review.collection.names.length === 0

  const download = (name: string, content: SchemaRuleSet) => {
    downloadText(
      `${fileSlug(name, 'rule-set')}.json`,
      ruleSetFile(content),
      'application/json',
    )
  }

  return (
    <section
      className={`${componentStyles.page} ${styles.page}`}
      aria-labelledby={headingId}
    >
      <PanelHeader
        className={styles.header}
        title="Schema matching"
        headingId={headingId}
        meta={<CapabilityBadge id="schema.mapping" />}
        actions={
          <span className={styles.stage}>
            Stage <StateBadge state={stageState} />
          </span>
        }
        description="Map the captured footprints' attributes to the model's fields. Each field takes one attribute; suggestions wait for review; running Schema matching copies the values into the buildings as a job and keeps the original attributes. Datasets are fused separately on the Data intake page."
      />

      {noSources ? (
        <EmptyState
          title="No source attributes yet"
          message="Footprints and their attributes are captured by Location setup. Run it first; the built-in mapping of OpenStreetMap building tags is ready to review."
          stageId={STAGE_IDS.location}
        />
      ) : (
        <>
          <section className={styles.section} aria-label="Run status">
            {stageState === 'running' ? (
              <InlineAlert tone="info" title="Schema matching is running">
                Buildings keep their values until the run publishes the mapping.
              </InlineAlert>
            ) : review.blocker ? (
              <InlineAlert tone="warning" title="Schema matching cannot run">
                {review.blocker}
              </InlineAlert>
            ) : published && stageState === 'stale' ? (
              <InlineAlert
                tone="warning"
                title="The mapping differs from the applied one"
              >
                The mapping or an earlier stage changed since the last run. Run
                Schema matching to apply the mapping shown here.
              </InlineAlert>
            ) : !published ? (
              <InlineAlert tone="info" title="The mapping is not applied yet">
                Buildings keep the values from Geospatial data enriching until
                Schema matching runs.
              </InlineAlert>
            ) : null}
            {published ? (
              <PropertyList
                items={[
                  { label: 'Applied by run', value: published.runId },
                  {
                    label: 'Targets applied',
                    value: Object.keys(published.mapping).length,
                  },
                  {
                    label: 'Values copied',
                    value: Object.entries(published.applied)
                      .map(
                        ([target, count]) =>
                          `${review.targets.find((item) => item.id === target)?.label ?? target} ${count}`,
                      )
                      .join(', '),
                  },
                  {
                    label: 'Loaded from',
                    value: matching.loadedFrom ?? 'Edited mapping',
                  },
                ]}
              />
            ) : null}
            {published && published.warnings.length > 0 ? (
              <InlineAlert
                tone="warning"
                title={`${published.warnings.length} warnings from the last run`}
              >
                <ul className={styles.list}>
                  {published.warnings.map((warning) => (
                    <li key={`${warning.code}-${warning.target}`}>
                      <code>{warning.code}</code> {warning.message}
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            ) : null}
            <div className={styles.actions}>
              <ActionButton
                label="Run Schema matching to apply the mapping"
                variant="primary"
                disabledReason={runBlocker}
                onPress={() =>
                  void client.execute({
                    type: 'workflow.runStage',
                    input: { stageId: STAGE_IDS.schema },
                  })
                }
              >
                Run Schema matching
              </ActionButton>
              <ActionButton
                label="Open Data intake to map and fuse a dataset"
                disabledReason={null}
                onPress={() => layout.openPage('intake')}
              >
                Data intake
              </ActionButton>
              <span className={componentStyles.muted}>
                The run is a job; buildings change only when it completes, and
                later stages become outdated.
              </span>
            </div>
          </section>

          <MappingReview
            idPrefix="schema"
            aria-label="Attribute mapping"
            targets={review.targets}
            sources={review.collection.attributes}
            records={review.collection.records.length}
            recordNoun="buildings"
            mapping={matching.mapping}
            suggestions={matching.suggestions}
            issues={[...review.issues, ...issues]}
            checks={review.checks}
            chosenSource={source}
            distribution={distribution}
            onChooseSource={(name) =>
              view.execute({
                type: 'schema.inspectSource',
                input: { source: name },
              })
            }
            onMap={(target, attribute) =>
              void send(
                {
                  type: 'schema.mapTarget',
                  input: { target, source: attribute },
                },
                { source: `targets.${target}`, target: `targets.${target}` },
              )
            }
            onReview={(targets, decision) =>
              void send({
                type: 'schema.reviewSuggestions',
                input: { targets, decision },
              })
            }
            onSuggest={() => void send({ type: 'schema.suggest', input: {} })}
            onMapValue={(target, value, to) =>
              void send(
                { type: 'schema.mapValue', input: { target, value, to } },
                { to: `targets.${target}`, value: `targets.${target}` },
              )
            }
            custom={{
              onAdd: (name, attribute) =>
                send(
                  {
                    type: 'schema.addCustomTarget',
                    input: { name, source: attribute },
                  },
                  { name: 'custom.name', source: 'custom.source' },
                ),
              onRemove: (name) => setConfirming({ kind: 'target', name }),
            }}
            disabledReason={editBlocker}
            onBlocked={recordBlocked}
          />

          <section className={styles.section} aria-label="Rule sets">
            <h3 className={styles.sectionTitle}>Rule sets</h3>
            <p className={componentStyles.muted}>
              A rule set is a saved mapping in RC&apos;s shape (target, source,
              tier, transform) with the value maps. Rule sets are kept with the
              project; download one to use it in another project.
            </p>
            <div className={styles.saveRow}>
              <TextField
                className={cx(formStyles.field, styles.nameField)}
                value={ruleSetName}
                isInvalid={Boolean(nameError)}
                onChange={(value) => {
                  setRuleSetName(value)
                  setNameError(null)
                }}
              >
                <Label className={formStyles.label}>Rule set name</Label>
                <Input
                  className={formStyles.input}
                  placeholder="Back Bay assessor tags"
                />
                <FieldError className={formStyles.fieldError}>
                  {nameError}
                </FieldError>
              </TextField>
              <ActionButton
                label="Save the mapping as a rule set"
                disabledReason={
                  editBlocker ??
                  (ruleSetName.trim() ? null : 'Name the rule set first.')
                }
                onPress={() =>
                  void client
                    .execute({
                      type: 'schema.saveRuleSet',
                      input: { name: ruleSetName },
                    })
                    .then((result) => {
                      if (result.outcome.status === 'applied') {
                        setNotice({
                          tone: 'success',
                          text: result.outcome.summary,
                        })
                        setRuleSetName('')
                        setNameError(null)
                      } else {
                        // Refusals belong to the name field.
                        setNotice(null)
                        setNameError(
                          result.outcome.issues
                            .map((issue) => issue.message)
                            .join(' '),
                        )
                      }
                    })
                }
              >
                Save rule set
              </ActionButton>
            </div>
            <div className={styles.ruleSets}>
              <SelectableList
                aria-label="Saved rule sets"
                items={ruleSets.map(({ id, ruleSet }) => ({
                  id,
                  title: ruleSet?.name ?? BUILT_IN_RULE_SET,
                  meta: ruleSet
                    ? `${ruleSet.mappings.length} mappings; saved ${formatDateTime(ruleSet.savedAt)}`
                    : 'Compulsory fields from OpenStreetMap building tags',
                }))}
                selectedId={selectedSet?.id ?? null}
                onSelect={setChosenSet}
              />
              <div className={styles.ruleSetDetail}>
                <Toolbar
                  aria-label="Rule set actions"
                  onBlocked={(item, reason) =>
                    recordBlocked(item.ariaLabel ?? item.label, reason)
                  }
                  items={[
                    {
                      id: 'load',
                      label: 'Load',
                      ariaLabel: `Load the rule set ${selectedName}`,
                      icon: Upload,
                      primary: true,
                      disabledReason:
                        editBlocker ??
                        (selectedCheck.applicable.length === 0
                          ? `Nothing in "${selectedName}" can be loaded here.`
                          : null),
                      onPress: () =>
                        void client
                          .execute({
                            type: 'schema.loadRuleSet',
                            input: { ruleSetId: selectedSet?.id ?? '' },
                          })
                          .then((result) =>
                            setNotice(
                              result.outcome.status === 'applied'
                                ? {
                                    tone:
                                      selectedCheck.skipped.length > 0
                                        ? 'warning'
                                        : 'success',
                                    text: result.outcome.summary,
                                  }
                                : null,
                            ),
                          ),
                    },
                    {
                      id: 'download',
                      label: 'Download',
                      ariaLabel: `Download the rule set ${selectedName}`,
                      icon: Download,
                      onPress: () =>
                        download(
                          selectedName,
                          selectedSet?.ruleSet ?? {
                            id: BUILT_IN_RULE_SET_ID,
                            name: BUILT_IN_RULE_SET,
                            version: 1,
                            mappings: currentMappings(builtIn),
                            valueMaps: builtIn.valueMaps,
                            savedAt: '',
                            operationId: '',
                          },
                        ),
                    },
                    {
                      id: 'delete',
                      label: 'Delete',
                      ariaLabel: `Delete the rule set ${selectedName}`,
                      icon: Trash2,
                      disabledReason:
                        editBlocker ??
                        (selectedSet?.ruleSet
                          ? null
                          : 'The built-in rule set cannot be deleted.'),
                      onPress: () => {
                        const id = selectedSet?.id
                        if (id)
                          setConfirming({
                            kind: 'ruleSet',
                            id,
                            name: selectedName,
                          })
                      },
                    },
                    {
                      id: 'open',
                      label: 'Open rule set file…',
                      icon: FolderOpen,
                      disabledReason: editBlocker,
                      onPress: () => fileRef.current?.click(),
                    },
                  ]}
                />
                <p>
                  Loading &ldquo;{selectedName}&rdquo; replaces the mapping with{' '}
                  {selectedCheck.applicable.length} mapping
                  {selectedCheck.applicable.length === 1 ? '' : 's'}
                  {selectedCheck.skipped.length > 0
                    ? ` and skips ${selectedCheck.skipped.length}:`
                    : '.'}
                </p>
                {selectedCheck.skipped.length > 0 ? (
                  <ul className={styles.list}>
                    {selectedCheck.skipped.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className={styles.file}
                  aria-label="Rule set file"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    void file.text().then((text) => {
                      const parsed = parseRuleSetFile(text)
                      if (!parsed.ok) {
                        setNotice({ tone: 'danger', text: parsed.message })
                        return
                      }
                      void client
                        .execute({
                          type: 'schema.loadRuleSet',
                          input: {
                            file: {
                              ...parsed.file,
                              name: parsed.file.name ?? file.name,
                            },
                          },
                        })
                        .then((result) =>
                          setNotice(
                            result.outcome.status === 'applied'
                              ? {
                                  tone: result.outcome.summary.includes(
                                    'skipped',
                                  )
                                    ? 'warning'
                                    : 'success',
                                  text: result.outcome.summary,
                                }
                              : null,
                          ),
                        )
                    })
                  }}
                />
              </div>
            </div>
          </section>
        </>
      )}
      <ConfirmDialog
        isOpen={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={
          confirming?.kind === 'ruleSet'
            ? `Delete the rule set "${confirming.name}"?`
            : `Remove the custom target "${confirming?.name ?? ''}"?`
        }
        confirm={{
          label:
            confirming?.kind === 'ruleSet'
              ? 'Delete rule set'
              : 'Remove target',
          disabledReason: editBlocker,
          onPress: async () => {
            if (!confirming) return
            if (confirming.kind === 'target') {
              await send({
                type: 'schema.removeCustomTarget',
                input: { name: confirming.name },
              })
              return
            }
            const result = await client.execute({
              type: 'schema.deleteRuleSet',
              input: { ruleSetId: confirming.id },
            })
            if (result.outcome.status === 'applied') {
              setChosenSet(BUILT_IN_RULE_SET_ID)
            }
          },
        }}
        onBlocked={recordBlocked}
        returnFocus={() =>
          document.querySelector<HTMLElement>(
            '[role="listbox"][aria-label="Saved rule sets"]',
          )
        }
      >
        <p>
          {confirming?.kind === 'ruleSet'
            ? 'The rule set leaves this project; the current mapping does not change. Downloaded copies are not affected. This cannot be undone.'
            : 'The target and its mapping leave this project. This cannot be undone.'}
        </p>
      </ConfirmDialog>
    </section>
  )
}
