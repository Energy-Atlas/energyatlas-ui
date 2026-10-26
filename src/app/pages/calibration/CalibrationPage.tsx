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
import { cx } from '../../cx.ts'
import { waitingReason } from '../../service/usePendingReason.ts'
import styles from './calibration.module.css'

const KWH = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function isUnit(value: string): value is MeterUnit {
  return value in UNITS
}

function metrics(value: FitMetrics): string {
  return `CV(RMSE) ${value.cvrmsePercent}%, NMBE ${value.nmbePercent}%`
}

function residualPercent(modeled: number, metered: number): string {
  if (metered === 0) return '—'
  return `${Math.round(((metered - modeled) / metered) * 1000) / 10}%`
}

function VariantDetail({ variant }: { variant: CalibratedVariant }) {
  return (
    <table
      className={componentStyles.table}
      aria-label={`Monthly residuals of ${variant.label}`}
    >
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Metered (kWh)</th>
          <th scope="col">Modeled (kWh)</th>
          <th scope="col">Residual before</th>
          <th scope="col">Calibrated (kWh)</th>
          <th scope="col">Residual after</th>
        </tr>
      </thead>
      <tbody>
        {variant.meteredKwh.map((metered, index) => {
          const modeled = variant.modeledKwh[index] ?? 0
          const calibrated = variant.calibratedKwh[index] ?? 0
          return (
            <tr key={index}>
              <th scope="row">{MONTHS[index]}</th>
              <td>{KWH.format(metered)}</td>
              <td>{KWH.format(modeled)}</td>
              <td>{residualPercent(modeled, metered)}</td>
              <td>{KWH.format(calibrated)}</td>
              <td>{residualPercent(calibrated, metered)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
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

  return (
    <section
      className={cx(componentStyles.page, styles.page)}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <h2 id={headingId}>Calibration</h2>
        <CapabilityBadge id="calibration.fit" />
        <span className={styles.working}>
          Working baseline: {adopted ? adopted.label : 'modeled baseline'}
        </span>
      </header>

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
          <table className={componentStyles.table} aria-label="Meter preview">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Value ({unit})</th>
                <th scope="col">Metered (kWh)</th>
                <th scope="col">Modeled (kWh)</th>
                <th scope="col">Residual</th>
              </tr>
            </thead>
            <tbody>
              {series.rows.map((row, index) => {
                const kwh = metered?.[index]
                const modeled = source?.result.monthlyKwh[index]
                return (
                  <tr key={row.month}>
                    <th scope="row">{row.month}</th>
                    <td>{row.value === null ? 'Missing' : row.value}</td>
                    <td>{kwh === undefined ? '—' : KWH.format(kwh)}</td>
                    <td>{modeled === undefined ? '—' : KWH.format(modeled)}</td>
                    <td>
                      {kwh === undefined || modeled === undefined
                        ? '—'
                        : residualPercent(modeled, kwh)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
          <table
            className={componentStyles.table}
            aria-label="Calibrated variants"
          >
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col">Factor</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">Thresholds</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => {
                const blocker = adoptBlocker(state, variant.id)
                const isAdopted = calibration.adoptedVariantId === variant.id
                const outdated =
                  !isAdopted && source?.revision !== variant.baselineRevision
                return (
                  <tr key={variant.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className={styles.link}
                        aria-pressed={detail?.id === variant.id}
                        onClick={() => setShown(variant.id)}
                      >
                        {variant.label}
                      </button>
                    </th>
                    <td>{variant.factor}</td>
                    <td>{metrics(variant.before)}</td>
                    <td>{metrics(variant.after)}</td>
                    <td>
                      {meetsThresholds(variant.after) ? 'Met' : 'Not met'}
                    </td>
                    <td>
                      {isAdopted
                        ? 'Working baseline'
                        : outdated
                          ? 'Outdated: baseline changed'
                          : 'Available'}
                    </td>
                    <td>
                      {isAdopted ? (
                        <ActionButton
                          label="Revert to the modeled baseline"
                          disabledReason={
                            waitingReason(
                              pending,
                              'calibration.revert',
                              'the baseline is being reverted',
                            ) ?? null
                          }
                          onPress={() =>
                            void client.execute({
                              type: 'calibration.revert',
                              input: {},
                            })
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
                            ) ?? blocker
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
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
