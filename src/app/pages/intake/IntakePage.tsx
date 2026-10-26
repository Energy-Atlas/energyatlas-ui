import { useId, useMemo, useState } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import { DATASETS, findDataset } from '../../../domain/intake/datasets.ts'
import {
  TARGET_FIELDS,
  TARGET_FIELD_IDS,
  fusionSubmitBlocker,
  prepareDataset,
  type PreparedDataset,
  type PreparedRow,
} from '../../../domain/intake/fusion.ts'
import { discardNote, heldCount } from '../../../domain/jobs/runGroups.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import type {
  AppliedDataset,
  HeldFusionOutput,
  ImportedFields,
  TargetField,
} from '../../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { ActionButton } from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import componentStyles from '../../components/components.module.css'
import formStyles from '../../components/forms.module.css'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { PropertyList } from '../../components/PropertyList.tsx'
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import { cx } from '../../cx.ts'
import { formatTime } from '../../format.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import type { DataColumn } from '../../tables/tableModel.ts'
import styles from './intake.module.css'

const PAGE_SIZE = 20

function sample(values: unknown[]): string {
  const shown = values
    .filter((value) => value !== null && value !== '')
    .slice(0, 2)
    .map((value) =>
      Array.isArray(value) ? `ring of ${value.length} points` : String(value),
    )
  return shown.length > 0 ? shown.join(', ') : 'empty'
}

function describeFields(fields: ImportedFields): string {
  const parts = Object.entries(fields).map(
    ([field, value]) =>
      `${TARGET_FIELDS[field as TargetField].label}: ${String(value)}`,
  )
  return parts.length > 0 ? parts.join('; ') : 'No changes'
}

const REJECTED_COLUMNS: DataColumn<PreparedRow>[] = [
  {
    id: 'row',
    header: 'Row',
    value: (row) => row.index + 1,
    type: 'number',
    rowHeader: true,
    width: 80,
  },
  {
    id: 'source',
    header: 'Source ID',
    value: (row) => row.key,
    type: 'identifier',
    empty: '—',
  },
  {
    id: 'problem',
    header: 'Problem',
    wrap: true,
    value: (row) => row.issues.map((issue) => issue.message).join('; '),
    render: (row) =>
      row.issues.map((issue) => (
        <span key={issue.path + issue.message} className={styles.issue}>
          {issue.message}
        </span>
      )),
  },
]

const CHANGE_COLUMNS: DataColumn<HeldFusionOutput>[] = [
  {
    id: 'source',
    header: 'Source ID',
    value: (plan) => plan.sourceKey,
    type: 'identifier',
    rowHeader: true,
  },
  {
    id: 'building',
    header: 'Building',
    value: (plan) => plan.buildingId,
    type: 'identifier',
  },
  {
    id: 'action',
    header: 'Action',
    value: (plan) => (plan.action === 'add' ? 'Add' : 'Update'),
    type: 'enum',
  },
  {
    id: 'values',
    header: 'Values',
    value: (plan) => describeFields(plan.fields),
    wrap: true,
  },
  {
    id: 'override',
    header: 'Manual override kept',
    wrap: true,
    value: (plan) =>
      plan.conflicts
        .map(
          (conflict) =>
            `Floors stay ${String(conflict.manual)} (import says ${conflict.imported})`,
        )
        .join('; '),
  },
]

const APPLIED_COLUMNS: DataColumn<AppliedDataset>[] = [
  {
    id: 'dataset',
    header: 'Dataset',
    value: (entry) => entry.label,
    rowHeader: true,
  },
  {
    id: 'updated',
    header: 'Updated',
    value: (entry) => entry.updated,
    type: 'number',
  },
  {
    id: 'added',
    header: 'Added',
    value: (entry) => entry.added,
    type: 'number',
  },
  {
    id: 'conflicts',
    header: 'Overrides kept',
    value: (entry) => entry.conflicts,
    type: 'number',
  },
  {
    id: 'appliedAt',
    header: 'Applied',
    value: (entry) => entry.appliedAt,
    render: (entry) => (
      <time dateTime={entry.appliedAt}>{formatTime(entry.appliedAt)}</time>
    ),
  },
]

function Preview({ prepared }: { prepared: PreparedDataset }) {
  const { counts } = prepared
  const rejected = prepared.rows.filter((row) => row.status === 'rejected')
  const changes = prepared.plans.filter(
    (plan) =>
      plan.action === 'add' ||
      Object.keys(plan.fields).length > 0 ||
      plan.conflicts.length > 0,
  )
  return (
    <>
      <section aria-label="Validation" className={styles.section}>
        <h3>Validation</h3>
        <p>
          {counts.records} records: {counts.valid} valid, {counts.rejected}{' '}
          rejected. Rejected records are not applied.
        </p>
        {rejected.length > 0 ? (
          <WorkbenchTable
            id="intake.rejected"
            aria-label="Rejected records"
            columns={REJECTED_COLUMNS}
            rows={rejected}
            rowKey={(row) => String(row.index)}
            pageSize={PAGE_SIZE}
            exportContext={[`dataset: ${prepared.dataset.label}`]}
          />
        ) : null}
      </section>
      <section aria-label="Fusion preview" className={styles.section}>
        <h3>Fusion preview</h3>
        <PropertyList
          items={[
            { label: 'Update', value: `${counts.updates} buildings` },
            { label: 'Add', value: `${counts.adds} buildings` },
            {
              label: 'Unchanged',
              value: `${counts.unchanged} matched records`,
            },
            { label: 'Manual overrides kept', value: counts.conflicts },
            {
              label: 'Kept as they are',
              value: `${counts.retained} buildings no record matches`,
            },
          ]}
        />
        {changes.length > 0 ? (
          <WorkbenchTable
            id="intake.changes"
            aria-label="Planned changes"
            columns={CHANGE_COLUMNS}
            rows={changes}
            rowKey={(plan) => plan.sourceKey}
            pageSize={PAGE_SIZE}
            exportContext={[`dataset: ${prepared.dataset.label}`]}
          />
        ) : null}
      </section>
    </>
  )
}

/**
 * Data intake (jobs rollout plan, slice 4): choose a synthetic dataset, review
 * the mapping and validation, preview the stable-ID fusion, then apply it as
 * a job. Nothing changes until Apply, and results publish together.
 */
export function IntakePage() {
  const headingId = useId()
  const services = useServices()
  const { view, client, layout } = services
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const draft = useViewState((current) => current.intake)
  const dataset = draft.datasetId ? findDataset(draft.datasetId) : null
  const prepared = useMemo(
    () => (dataset ? prepareDataset(state, dataset, draft.mapping) : null),
    [state, dataset, draft.mapping],
  )
  const [queued, setQueued] = useState<string | null>(null)
  const fieldIssue = (field: string) =>
    prepared?.schemaIssues.find((issue) => issue.path === `mapping.${field}`)
  const schemaWide =
    prepared?.schemaIssues.filter((issue) => issue.path === 'mapping') ?? []
  const applyBlocker =
    waitingReason(
      pending,
      'intake.applyDataset',
      'the dataset is being queued',
    ) ??
    (!prepared
      ? 'Choose a dataset first.'
      : (fusionSubmitBlocker(state) ??
        (prepared.schemaIssues.length > 0
          ? `Fix the mapping first: ${prepared.schemaIssues[0]?.message ?? ''}`
          : prepared.plans.length === 0
            ? 'No record is valid, so there is nothing to apply.'
            : null)))
  const discards = heldCount(state, STAGE_IDS.schema, 'fusion')
  const applied = Object.values(state.datasets)

  return (
    <section className={componentStyles.page} aria-labelledby={headingId}>
      <PanelHeader
        title="Data intake"
        headingId={headingId}
        meta={<CapabilityBadge id="intake.fusion" />}
      />
      <p className={componentStyles.muted}>
        Choose a dataset, review how its fields map to the model, then apply it.
        Records match buildings by a stable source ID; nothing changes until you
        apply, and results publish together once every record succeeds.
      </p>

      <section aria-label="Dataset" className={styles.section}>
        <RadioGroup
          className={styles.datasets}
          value={draft.datasetId}
          onChange={(datasetId) =>
            view.execute({ type: 'intake.chooseDataset', input: { datasetId } })
          }
        >
          <Label className={styles.label}>Dataset (synthetic)</Label>
          {DATASETS.map((candidate) => (
            <Radio
              key={candidate.id}
              value={candidate.id}
              className={cx(formStyles.radio, styles.dataset)}
            >
              <span>
                <strong>{candidate.label}</strong>{' '}
                <span className={componentStyles.muted}>
                  {candidate.format}, {candidate.records.length} records
                </span>
                <span className={styles.description}>
                  {candidate.description}
                </span>
              </span>
            </Radio>
          ))}
        </RadioGroup>
        <div className={styles.upload}>
          <ActionButton
            label="Upload a file"
            disabledReason="Choosing a file from disk or a server is deferred; choose a synthetic dataset instead."
            onPress={() => undefined}
          >
            Upload file…
          </ActionButton>
          <CapabilityBadge id="intake.upload" />
        </div>
      </section>

      {dataset && prepared ? (
        <>
          <section aria-label="Field mapping" className={styles.section}>
            <h3>Field mapping</h3>
            {schemaWide.map((issue) => (
              <p key={issue.message} className={styles.blocking} role="alert">
                {issue.message}
              </p>
            ))}
            <table
              className={cx(componentStyles.table, styles.mapping)}
              aria-label="Field mapping"
            >
              <thead>
                <tr>
                  <th scope="col">Dataset field</th>
                  <th scope="col">Sample values</th>
                  <th scope="col">Model field</th>
                </tr>
              </thead>
              <tbody>
                {dataset.fields.map((field) => {
                  const issue = fieldIssue(field)
                  const selectId = `intake-map-${field}`
                  return (
                    <tr key={field}>
                      <th scope="row">
                        <label htmlFor={selectId}>{field}</label>
                      </th>
                      <td>
                        {sample(dataset.records.map((record) => record[field]))}
                      </td>
                      <td>
                        <select
                          id={selectId}
                          className={formStyles.input}
                          value={draft.mapping[field] ?? ''}
                          aria-invalid={issue ? true : undefined}
                          aria-describedby={
                            issue ? `${selectId}-error` : undefined
                          }
                          onChange={(event) =>
                            view.execute({
                              type: 'intake.mapField',
                              input: {
                                field,
                                target:
                                  (event.target.value as TargetField | '') ||
                                  null,
                              },
                            })
                          }
                        >
                          <option value="">Ignore</option>
                          {TARGET_FIELD_IDS.map((target) => (
                            <option key={target} value={target}>
                              {TARGET_FIELDS[target].label}
                            </option>
                          ))}
                        </select>
                        {issue ? (
                          <span
                            id={`${selectId}-error`}
                            className={styles.issue}
                          >
                            {issue.message}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          {prepared.schemaIssues.length === 0 ? (
            <Preview prepared={prepared} />
          ) : null}
          <div className={styles.apply}>
            <ActionButton
              label={`Apply ${dataset.label}${discardNote(state, STAGE_IDS.schema, 'fusion')}`}
              variant="primary"
              disabledReason={applyBlocker}
              onPress={() =>
                void client
                  .execute({
                    type: 'intake.applyDataset',
                    input: { datasetId: dataset.id, mapping: draft.mapping },
                  })
                  .then((result) => {
                    if (result.outcome.status !== 'applied') return
                    const latest = services.workbench.getState().taskIds.at(-1)
                    setQueued(latest ?? null)
                  })
              }
            >
              Apply dataset
            </ActionButton>
            {discards > 0 ? (
              <span className={componentStyles.muted}>
                Applying starts over and discards the {discards} results held by
                the earlier, partly failed fusion.
              </span>
            ) : null}
            {queued && state.tasks[queued] ? (
              <span>
                Queued as a job.{' '}
                <button
                  type="button"
                  className={componentStyles.button}
                  onClick={() => {
                    view.execute({
                      type: 'jobs.select',
                      input: { taskId: queued },
                    })
                    layout.openPage('tasks')
                  }}
                >
                  Open job
                </button>
              </span>
            ) : (
              <span className={componentStyles.muted}>
                Applying queues a data fusion job; the project changes only when
                every valid record has succeeded.
              </span>
            )}
          </div>
        </>
      ) : null}

      <section aria-label="Applied datasets" className={styles.section}>
        <h3>Applied datasets</h3>
        {applied.length === 0 ? (
          <p className={componentStyles.empty}>No dataset has been applied.</p>
        ) : (
          <WorkbenchTable
            id="intake.applied"
            aria-label="Applied datasets"
            columns={APPLIED_COLUMNS}
            rows={applied}
            rowKey={(entry) => entry.datasetId}
          />
        )}
      </section>
    </section>
  )
}
