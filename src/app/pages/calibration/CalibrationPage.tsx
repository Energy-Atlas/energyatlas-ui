import { useId, useState } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import {
  METER_SERIES,
  MONTHS,
  THRESHOLDS,
  UNITS,
  adoptBlocker,
  findMeter,
  fitBlocker,
  meetsThresholds,
  meterIssues,
  meteredKwh,
  modeledSource,
  runLockReason,
  unitWarning,
} from '../../../domain/calibration/calibration.ts'
import type {
  CalibratedVariant,
  FitMetrics,
  MeterUnit,
} from '../../../domain/types.ts'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { ActionButton } from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import componentStyles from '../../components/components.module.css'
import formStyles from '../../components/forms.module.css'
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import { cx } from '../../cx.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import type { DataColumn } from '../../tables/tableModel.ts'
import styles from './calibration.module.css'

function isUnit(value: string): value is MeterUnit {
  return value in UNITS
}

function metrics(value: FitMetrics): string {
  return `CV(RMSE) ${value.cvrmsePercent}%, NMBE ${value.nmbePercent}%`
}

/** How far a modeled value misses the meter, in percent of the meter. */
function residualPercent(modeled: number, metered: number): number | null {
  if (metered === 0) return null
  return Math.round(((metered - modeled) / metered) * 1000) / 10
}

type ResidualRow = {
  month: string
  metered: number
  modeled: number
  calibrated: number
}

const KWH_COLUMN = { type: 'number', unit: 'kWh' } as const
const RESIDUAL_COLUMN = {
  type: 'number',
  unit: '%',
  decimals: 1,
  empty: '—',
} as const

const RESIDUAL_COLUMNS: DataColumn<ResidualRow>[] = [
  {
    id: 'month',
    header: 'Month',
    value: (row) => row.month,
    rowHeader: true,
    sortable: false,
  },
  {
    id: 'metered',
    header: 'Metered',
    value: (row) => row.metered,
    ...KWH_COLUMN,
  },
  {
    id: 'modeled',
    header: 'Modeled',
    value: (row) => row.modeled,
    ...KWH_COLUMN,
  },
  {
    id: 'before',
    header: 'Residual before',
    value: (row) => residualPercent(row.modeled, row.metered),
    ...RESIDUAL_COLUMN,
  },
  {
    id: 'calibrated',
    header: 'Calibrated',
    value: (row) => row.calibrated,
    ...KWH_COLUMN,
  },
  {
    id: 'after',
    header: 'Residual after',
    value: (row) => residualPercent(row.calibrated, row.metered),
    ...RESIDUAL_COLUMN,
  },
]

type PreviewRow = {
  month: string
  value: number | null
  metered: number | null
  modeled: number | null
}

function previewColumns(unit: MeterUnit): DataColumn<PreviewRow>[] {
  return [
    {
      id: 'month',
      header: 'Month',
      value: (row) => row.month,
      rowHeader: true,
      sortable: false,
    },
    {
      id: 'value',
      header: 'Value',
      value: (row) => row.value,
      type: 'number',
      unit,
      decimals: 3,
      empty: 'Missing',
    },
    {
      id: 'metered',
      header: 'Metered',
      value: (row) => row.metered,
      ...KWH_COLUMN,
      empty: '—',
    },
    {
      id: 'modeled',
      header: 'Modeled',
      value: (row) => row.modeled,
      ...KWH_COLUMN,
      empty: '—',
    },
    {
      id: 'residual',
      header: 'Residual',
      value: (row) =>
        row.metered === null || row.modeled === null
          ? null
          : residualPercent(row.modeled, row.metered),
      ...RESIDUAL_COLUMN,
    },
  ]
}

function VariantDetail({ variant }: { variant: CalibratedVariant }) {
  return (
    <WorkbenchTable
      id="calibration.residuals"
      aria-label={`Monthly residuals of ${variant.label}`}
      columns={RESIDUAL_COLUMNS}
      rows={variant.meteredKwh.map((metered, index) => ({
        month: MONTHS[index] ?? String(index + 1),
        metered,
        modeled: variant.modeledKwh[index] ?? 0,
        calibrated: variant.calibratedKwh[index] ?? 0,
      }))}
      rowKey={(row) => row.month}
      exportContext={[`variant: ${variant.label}`]}
    />
  )
}

/**
 * Calibration (jobs rollout plan, slice 7; decision D10): validate a
 * synthetic meter series, fit the modeled baseline to it as one job, compare
 * residuals before and after, and explicitly adopt a calibrated variant as the
 * working baseline, or revert.
 */
export function CalibrationPage() {
  const headingId = useId()
  const { client, view, layout, workbench } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const [meterId, setMeterId] = useState<string>(METER_SERIES[0]?.id ?? '')
  const [unit, setUnit] = useState<MeterUnit>('kWh')
  const [shown, setShown] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const series = findMeter(meterId)
  const issues = series ? meterIssues(series) : []
  const metered = series ? meteredKwh(series, unit) : null
  const source = modeledSource(state)
  const warning = series ? unitWarning(series, unit) : null
  const calibration = state.calibration
  const adopted = calibration.adoptedVariantId
    ? calibration.variants[calibration.adoptedVariantId]
    : null
  const variants = calibration.variantIds.flatMap((id) => {
    const variant = calibration.variants[id]
    return variant ? [variant] : []
  })
  const detail =
    (shown ? calibration.variants[shown] : undefined) ?? variants.at(-1)
  const fitReason =
    waitingReason(pending, 'calibration.fit', 'the fit is being queued') ??
    fitBlocker(state, { meterId, unit })
  const statusOf = (variant: CalibratedVariant) => {
    if (calibration.adoptedVariantId === variant.id) return 'Working baseline'
    if (variant.unitMismatch) return 'Unit does not match the export'
    return source?.result.runId !== variant.baselineRunId
      ? 'Outdated: baseline changed'
      : 'Available'
  }
  const variantColumns: DataColumn<CalibratedVariant>[] = [
    {
      id: 'variant',
      header: 'Variant',
      value: (variant) => variant.label,
      rowHeader: true,
      render: (variant) => (
        <button
          type="button"
          className={styles.link}
          aria-pressed={detail?.id === variant.id}
          onClick={() => setShown(variant.id)}
        >
          {variant.label}
        </button>
      ),
    },
    {
      id: 'factor',
      header: 'Factor',
      value: (variant) => variant.factor,
      type: 'number',
      decimals: 3,
    },
    {
      id: 'before',
      header: 'Before',
      value: (variant) => metrics(variant.before),
    },
    {
      id: 'after',
      header: 'After',
      value: (variant) => metrics(variant.after),
    },
    {
      id: 'thresholds',
      header: 'Thresholds',
      value: (variant) => (meetsThresholds(variant.after) ? 'Met' : 'Not met'),
      type: 'enum',
    },
    { id: 'status', header: 'Status', value: statusOf, type: 'enum' },
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      action: true,
      width: 100,
      render: (variant) =>
        calibration.adoptedVariantId === variant.id ? (
          <ActionButton
            label="Revert to the modeled baseline"
            disabledReason={
              waitingReason(
                pending,
                'calibration.revert',
                'the baseline is being reverted',
              ) ?? runLockReason(state)
            }
            onPress={() =>
              void client.execute({ type: 'calibration.revert', input: {} })
            }
          >
            Revert
          </ActionButton>
        ) : (
          <ActionButton
            label={`Adopt ${variant.label} as the working baseline`}
            disabledReason={
              waitingReason(
                pending,
                'calibration.adopt',
                'the variant is being adopted',
              ) ??
              runLockReason(state) ??
              adoptBlocker(state, variant.id)
            }
            onPress={() =>
              void client.execute({
                type: 'calibration.adopt',
                input: { variantId: variant.id },
              })
            }
          >
            Adopt
          </ActionButton>
        ),
    },
  ]

  return (
    <section
      className={cx(componentStyles.page, styles.page)}
      aria-labelledby={headingId}
    >
      <PanelHeader
        className={styles.header}
        title="Calibration"
        headingId={headingId}
        meta={<CapabilityBadge id="calibration.fit" />}
        actions={
          <span className={styles.working}>
            Working baseline: {adopted ? adopted.label : 'modeled baseline'}
          </span>
        }
      />

      <section aria-label="Meter series" className={styles.section}>
        <RadioGroup
          className={styles.series}
          value={meterId}
          onChange={(value) => {
            setMeterId(value)
            const stated = findMeter(value)?.statedUnit ?? 'kWh'
            setUnit(isUnit(stated) ? stated : 'kWh')
          }}
        >
          <Label className={styles.label}>Meter series (synthetic)</Label>
          {METER_SERIES.map((candidate) => (
            <Radio
              key={candidate.id}
              value={candidate.id}
              className={cx(formStyles.radio, styles.option)}
            >
              <span>
                <strong>{candidate.label}</strong>{' '}
                <span className={componentStyles.muted}>
                  {candidate.rows.length} months, stated in{' '}
                  {candidate.statedUnit}
                </span>
                <span className={styles.description}>
                  {candidate.description}
                </span>
              </span>
            </Radio>
          ))}
        </RadioGroup>
        <div className={styles.unit}>
          <label className={formStyles.label} htmlFor={`${headingId}-unit`}>
            Unit of the values
          </label>
          <select
            id={`${headingId}-unit`}
            className={formStyles.input}
            value={unit}
            aria-describedby={warning ? `${headingId}-unit-warning` : undefined}
            onChange={(event) => {
              if (isUnit(event.target.value)) setUnit(event.target.value)
            }}
          >
            {(Object.keys(UNITS) as MeterUnit[]).map((value) => (
              <option key={value} value={value}>
                {UNITS[value].label}
              </option>
            ))}
          </select>
          {warning ? (
            <span id={`${headingId}-unit-warning`} className={styles.warning}>
              {warning}
            </span>
          ) : null}
        </div>
      </section>

      {series ? (
        <section aria-label="Meter preview" className={styles.section}>
          <h3 className={styles.title}>Preview against the modeled baseline</h3>
          {issues.length > 0 ? (
            <ul className={styles.issues} role="alert">
              {issues.map((issue) => (
                <li key={issue.path + issue.message}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          <WorkbenchTable
            id="calibration.meterPreview"
            aria-label="Meter preview"
            columns={previewColumns(unit)}
            rows={series.rows.map((row, index) => ({
              month: row.month,
              value: row.value,
              metered: metered?.[index] ?? null,
              modeled: source?.result.monthlyKwh[index] ?? null,
            }))}
            rowKey={(row) => row.month}
            exportContext={[`meter series: ${series.label}`]}
          />
          <div className={styles.actions}>
            <ActionButton
              label={`Fit the modeled baseline to ${series.label}`}
              variant="primary"
              disabledReason={fitReason}
              onPress={() =>
                void client
                  .execute({
                    type: 'calibration.fit',
                    input: { meterId, unit },
                  })
                  .then((result) => {
                    if (result.outcome.status === 'applied') {
                      setQueued(workbench.getState().taskIds.at(-1) ?? null)
                    }
                  })
              }
            >
              Run fit
            </ActionButton>
            {queued && state.tasks[queued] ? (
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
                Open fit job
              </button>
            ) : (
              <span className={componentStyles.muted}>
                The fit runs as one job and publishes a separate calibrated
                variant; the working baseline changes only when you adopt it.
              </span>
            )}
          </div>
        </section>
      ) : null}

      <section aria-label="Calibrated variants" className={styles.section}>
        <h3 className={styles.title}>Calibrated variants</h3>
        <p className={componentStyles.muted}>
          Acceptance follows ASHRAE Guideline 14 for monthly data: CV(RMSE) at
          most {THRESHOLDS.cvrmsePercent}% and NMBE within ±
          {THRESHOLDS.nmbePercent}%. These are the demo&apos;s labels on
          synthetic data.
        </p>
        {variants.length === 0 ? (
          <p className={componentStyles.empty}>
            No calibrated variants yet. Run a fit to publish one.
          </p>
        ) : (
          <WorkbenchTable
            id="calibration.variants"
            aria-label="Calibrated variants"
            columns={variantColumns}
            rows={variants}
            rowKey={(variant) => variant.id}
          />
        )}
        {detail ? <VariantDetail variant={detail} /> : null}
        {adopted ? (
          <p className={componentStyles.muted}>
            Results that depend on the baseline are outdated until their stages
            run again (Baseline model setup is followed by{' '}
            {state.workflow.stages[STAGE_IDS.scenarioDefinitions]?.name ??
              'scenario stages'}
            ).
          </p>
        ) : null}
      </section>
    </section>
  )
}
