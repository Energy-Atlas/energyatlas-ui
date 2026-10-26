import {
  ArrowDown,
  CircleCheck,
  CircleX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  Checkbox,
  Label,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
} from 'react-aria-components'
import { capabilities } from '../../domain/capabilities.ts'
import { stageSubmitBlocker } from '../../domain/commands.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  useAppearance,
  useClientSnapshot,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import type { DataPalette } from '../appearance/appearances.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge, StatusTag } from '../components/CapabilityBadge.tsx'
import componentStyles from '../components/components.module.css'
import { EmptyState } from '../components/EmptyState.tsx'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { Section } from '../components/Section.tsx'
import { PanelHeader } from '../components/PanelHeader.tsx'
import { cx } from '../cx.ts'
import { forStage, waitingReason } from '../service/usePendingReason.ts'
import { compileChartSpec, type ChartSpec } from '../view/chartSpec.ts'
import { EChart, useChartFont } from '../viz/EChart.tsx'
import {
  annualDemandOption,
  formatMwh,
  monthlyDemandOption,
  scenarioColor,
  scenarioLabel,
} from './dashboardCharts.ts'
import {
  buildDashboardData,
  MAX_CHARTED_SCENARIOS,
  MONTHS,
} from './dashboardData.ts'
import styles from './dashboard.module.css'

type LoadingStatus = {
  label: string
  icon: LucideIcon
  color: string
  className: string | undefined
}

function loadingStatus(
  percent: number,
  colors: DataPalette['status'],
): LoadingStatus {
  if (percent > 100) {
    return {
      label: 'Over rating',
      icon: CircleX,
      color: colors.critical,
      className: styles.critical,
    }
  }
  if (percent >= 80) {
    return {
      label: 'Near rating',
      icon: TriangleAlert,
      color: colors.warning,
      className: styles.warning,
    }
  }
  return {
    label: 'Within rating',
    icon: CircleCheck,
    color: colors.good,
    className: styles.good,
  }
}

function omit(
  record: Record<string, number>,
  key: string,
): Record<string, number> {
  const next = { ...record }
  delete next[key]
  return next
}

function StatTile({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue}>{value}</p>
      {children}
    </div>
  )
}

/** A chart added from a validated specification (decision 0011). */
function AddedChart({ spec }: { spec: ChartSpec }) {
  const { view } = useServices()
  const project = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const palette = useAppearance().data
  const font = useChartFont()
  const compiled = useMemo(
    () => compileChartSpec(spec, project, palette, font.family),
    [spec, project, palette, font],
  )
  return (
    <article className={styles.card} aria-label={spec.title}>
      <div className={styles.addedHeader}>
        <h4>{spec.title}</h4>
        <ActionButton
          label={`Remove the chart ${spec.title}`}
          disabledReason={null}
          onPress={() =>
            view.execute({
              type: 'dashboard.removeChart',
              input: { chartId: spec.id },
            })
          }
        >
          Remove
        </ActionButton>
      </div>
      {compiled.missing.length > 0 ? (
        <p className={componentStyles.muted}>
          Not charted because they have no results now:{' '}
          {compiled.missing.join(', ')}.
        </p>
      ) : null}
      {compiled.leftOut.length > 0 ? (
        <p className={componentStyles.muted}>
          Not charted because they are left out of the comparison set:{' '}
          {compiled.leftOut.join(', ')}.
        </p>
      ) : null}
      <EChart
        option={compiled.option}
        height={compiled.height}
        label={compiled.summary}
      />
      <Section
        title={`Show data table for ${spec.title}`}
        className={styles.dataTable}
        level={4}
      >
        <table
          className={componentStyles.table}
          aria-label={compiled.table.caption}
        >
          <thead>
            <tr>
              {compiled.table.columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compiled.table.rows.map((row) => (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                {row.slice(1).map((cell, index) => (
                  <td key={compiled.table.columns[index + 1] ?? index}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </article>
  )
}

export function DashboardPage() {
  const headingId = useId()
  const controlsHeadingId = useId()
  const addedChartsHeadingId = useId()
  const { client, layout, view } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const workflow = state.workflow
  const stageStates = useStageStates()
  const palette = useAppearance().data
  const font = useChartFont()
  const [previews, setPreviews] = useState<Record<string, number>>({})
  const hiddenIds = useViewState(
    (viewState) => viewState.dashboard.hiddenScenarioIds,
  )
  const addedCharts = useViewState((viewState) => viewState.dashboard.charts)

  const data = useMemo(
    () => buildDashboardData(state, previews),
    [state, previews],
  )
  const visible = useMemo(
    () =>
      data.scenarios.filter(
        (item) => item.shown && !hiddenIds.includes(item.scenario.id),
      ),
    [data, hiddenIds],
  )
  const monthlyOption = useMemo(
    () => monthlyDemandOption(data, visible, palette, font.family),
    [data, visible, palette, font],
  )
  const annualOption = useMemo(
    () => annualDemandOption(data, visible, palette, font.family),
    [data, visible, palette, font],
  )

  const header = (
    <PanelHeader
      className={styles.header}
      title="Dashboard"
      headingId={headingId}
      meta={<CapabilityBadge id="dashboard.comparison" />}
    />
  )

  const baseline = data.baseline
  if (!baseline) {
    return (
      <section className={styles.page} aria-labelledby={headingId}>
        {header}
        <EmptyState
          title="No results yet"
          message="The dashboard compares baseline and scenario demand once the baseline model has run."
          stageId={STAGE_IDS.baseline}
        />
      </section>
    )
  }

  const definitionsState = stageStates[STAGE_IDS.scenarioDefinitions]
  const modelingState = stageStates[STAGE_IDS.scenarioModeling]
  const staleStageId =
    definitionsState === 'stale'
      ? STAGE_IDS.scenarioDefinitions
      : modelingState === 'stale'
        ? STAGE_IDS.scenarioModeling
        : null
  const staleStage = staleStageId ? workflow.stages[staleStageId] : undefined
  const transformers = Object.values(state.gridElements).filter(
    (element) => element.kind === 'transformer',
  )
  const gridResult = state.gridResult

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      {header}

      {staleStage && staleStageId ? (
        <InlineAlert
          tone="warning"
          className={styles.staleNotice}
          actions={
            <ActionButton
              label={`Run ${staleStage.name}`}
              disabledReason={
                waitingReason(
                  pending,
                  'workflow.runStage',
                  'the run was requested',
                  forStage(staleStageId),
                ) ?? stageSubmitBlocker(state, staleStageId)
              }
              onPress={() =>
                void client.execute({
                  type: 'workflow.runStage',
                  input: { stageId: staleStageId },
                })
              }
            >
              Run {staleStage.name}
            </ActionButton>
          }
        >
          Scenario results are outdated: scenario inputs changed after the last
          run. Rerun &ldquo;{staleStage.name}&rdquo; and the stages after it.
        </InlineAlert>
      ) : null}

      <section className={styles.controls} aria-labelledby={controlsHeadingId}>
        <h3 id={controlsHeadingId}>Scenario controls</h3>
        {data.scenarios.length === 0 ? (
          <div className={styles.controlEmpty}>
            <span className={componentStyles.muted}>
              No scenarios yet. Create a measure and a scenario, then run the
              scenario stages.
            </span>
            <ActionButton
              label="Open the Creator page"
              disabledReason={null}
              onPress={() => layout.openPage('creator')}
            >
              Open Creator
            </ActionButton>
          </div>
        ) : (
          data.scenarios.map((item) => {
            const { scenario } = item
            const adoption = previews[scenario.id] ?? scenario.adoptionPercent
            const isPreview = item.previewAdoption !== null
            return (
              <div key={scenario.id} className={styles.controlRow}>
                <span
                  className={styles.swatch}
                  style={{ background: scenarioColor(item, palette) }}
                  aria-hidden="true"
                />
                <Checkbox
                  className={formStyles.checkbox}
                  isSelected={
                    Boolean(item.shown) && !hiddenIds.includes(scenario.id)
                  }
                  isDisabled={!item.shown}
                  onChange={(isSelected) =>
                    view.execute({
                      type: 'dashboard.setScenarioCompared',
                      input: { scenarioId: scenario.id, compared: isSelected },
                    })
                  }
                >
                  Compare {scenario.name}
                </Checkbox>
                {item.modeled ? null : (
                  <span className={componentStyles.muted}>Not modeled yet</span>
                )}
                <Slider
                  className={cx(formStyles.slider, styles.slider)}
                  value={adoption}
                  minValue={0}
                  maxValue={100}
                  step={5}
                  onChange={(value) =>
                    setPreviews((current) => ({
                      ...current,
                      [scenario.id]: value,
                    }))
                  }
                >
                  <Label className={formStyles.label}>
                    What-if adoption for {scenario.name}
                  </Label>
                  <SliderOutput className={formStyles.description}>
                    {({ state: slider }) => `${slider.getThumbValue(0)}%`}
                  </SliderOutput>
                  <SliderTrack className={formStyles.sliderTrack}>
                    {({ state: slider }) => (
                      <>
                        <div
                          className={formStyles.sliderFill}
                          style={{
                            width: `${slider.getThumbPercent(0) * 100}%`,
                          }}
                        />
                        <SliderThumb className={formStyles.sliderThumb} />
                      </>
                    )}
                  </SliderTrack>
                </Slider>
                <span className={styles.saved}>
                  Saved: {scenario.adoptionPercent}%
                </span>
                {isPreview ? (
                  <span className={styles.previewTag}>Preview, not saved</span>
                ) : null}
                <ActionButton
                  label={`Apply ${adoption}% adoption to ${scenario.name}`}
                  variant="primary"
                  disabledReason={
                    isPreview
                      ? waitingReason(
                          pending,
                          'scenario.setAdoption',
                          'the adoption is being applied',
                          (input) =>
                            (input as { scenarioId?: unknown }).scenarioId ===
                            scenario.id,
                        )
                      : 'The preview matches the saved adoption.'
                  }
                  onPress={() => {
                    void client
                      .execute({
                        type: 'scenario.setAdoption',
                        input: {
                          scenarioId: scenario.id,
                          adoptionPercent: adoption,
                        },
                      })
                      .then((result) => {
                        if (result.outcome.status === 'applied') {
                          setPreviews((current) => omit(current, scenario.id))
                        }
                      })
                  }}
                >
                  Apply
                </ActionButton>
                <ActionButton
                  label={`Reset preview for ${scenario.name}`}
                  disabledReason={
                    isPreview ? null : 'There is no preview to reset.'
                  }
                  onPress={() =>
                    setPreviews((current) => omit(current, scenario.id))
                  }
                >
                  Reset
                </ActionButton>
              </div>
            )
          })
        )}
        {data.uncharted.length > 0 ? (
          <p className={componentStyles.muted}>
            Charts compare the first {MAX_CHARTED_SCENARIOS} scenarios in the
            comparison set, the most the validated palette distinguishes. Not
            charted: {data.uncharted.join(', ')}.
          </p>
        ) : null}
        {data.leftOut.length > 0 ? (
          <p className={componentStyles.muted}>
            Left out of the comparison set, so not charted:{' '}
            {data.leftOut.join(', ')}. Include them in Creator to model and
            chart them.
          </p>
        ) : null}
      </section>

      <div className={styles.tiles}>
        <StatTile
          label="Baseline annual demand"
          value={`${formatMwh(baseline.totalKwh)} MWh`}
        />
        <StatTile
          label="Baseline peak"
          value={`${baseline.peakKw.toLocaleString('en-US')} kW`}
        />
        {visible.map((item) =>
          item.shown ? (
            <StatTile
              key={item.scenario.id}
              label={`${scenarioLabel(item)} annual demand`}
              value={`${formatMwh(item.shown.totalKwh)} MWh`}
            >
              {item.reductionPercent !== null && item.reductionPercent > 0 ? (
                <p className={cx(styles.delta, styles.good)}>
                  <ArrowDown size={14} aria-hidden="true" />
                  {item.reductionPercent}% vs baseline
                </p>
              ) : (
                <p className={styles.delta}>No reduction vs baseline</p>
              )}
            </StatTile>
          ) : null,
        )}
      </div>

      {addedCharts.length > 0 ? (
        <section
          className={styles.addedCharts}
          aria-labelledby={addedChartsHeadingId}
        >
          <h3 id={addedChartsHeadingId}>Added charts</h3>
          <div className={styles.charts}>
            {addedCharts.map((spec) => (
              <AddedChart key={spec.id} spec={spec} />
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.charts}>
        <article className={styles.card} aria-label="Monthly demand">
          <h3>Monthly demand (MWh, synthetic)</h3>
          <EChart
            option={monthlyOption}
            height={300}
            label={`Line chart of monthly demand for the baseline and ${visible.length} scenario(s). Values are in the data table below.`}
          />
          <Section
            title="Show monthly data table"
            id="dashboard.monthly"
            className={styles.dataTable}
            level={4}
          >
            <table
              className={componentStyles.table}
              aria-label="Monthly demand data"
            >
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Baseline (MWh)</th>
                  {visible.map((item) => (
                    <th scope="col" key={item.scenario.id}>
                      {scenarioLabel(item)} (MWh)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((month, index) => (
                  <tr key={month}>
                    <th scope="row">{month}</th>
                    <td>{formatMwh(baseline.monthlyKwh[index] ?? 0)}</td>
                    {visible.map((item) => (
                      <td key={item.scenario.id}>
                        {item.shown
                          ? formatMwh(item.shown.monthlyKwh[index] ?? 0)
                          : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </article>

        <article className={styles.card} aria-label="Annual demand">
          <h3>Annual demand (MWh/yr, synthetic)</h3>
          <EChart
            option={annualOption}
            height={72 + 44 * (visible.length + 1)}
            label={`Bar chart of annual demand for the baseline and ${visible.length} scenario(s). Values are in the data table below.`}
          />
          <Section
            title="Show annual data table"
            id="dashboard.annual"
            className={styles.dataTable}
            level={4}
          >
            <table
              className={componentStyles.table}
              aria-label="Annual demand data"
            >
              <thead>
                <tr>
                  <th scope="col">Result</th>
                  <th scope="col">Annual demand (MWh/yr)</th>
                  <th scope="col">Peak (kW)</th>
                  <th scope="col">Reduction vs baseline</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Baseline</th>
                  <td>{formatMwh(baseline.totalKwh)}</td>
                  <td>{baseline.peakKw.toLocaleString('en-US')}</td>
                  <td>n/a</td>
                </tr>
                {visible.map((item) =>
                  item.shown ? (
                    <tr key={item.scenario.id}>
                      <th scope="row">{scenarioLabel(item)}</th>
                      <td>{formatMwh(item.shown.totalKwh)}</td>
                      <td>{item.shown.peakKw.toLocaleString('en-US')}</td>
                      <td>
                        {item.reductionPercent === null
                          ? ''
                          : `${item.reductionPercent}%`}
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </Section>
        </article>

        <article className={styles.card} aria-label="Transformer loading">
          <h3>Transformer peak loading (synthetic)</h3>
          {gridResult && transformers.length > 0 ? (
            <ul className={styles.meters}>
              {transformers.map((transformer) => {
                const percent =
                  gridResult.transformerLoadingPercent[transformer.id] ?? 0
                const status = loadingStatus(percent, palette.status)
                const Icon = status.icon
                return (
                  <li key={transformer.id} className={styles.meterRow}>
                    <span className={styles.meterName}>{transformer.name}</span>
                    <div
                      className={styles.meterTrack}
                      role="meter"
                      aria-label={`${transformer.name} peak loading`}
                      aria-valuemin={0}
                      aria-valuemax={150}
                      aria-valuenow={percent}
                      aria-valuetext={`${percent}% of rating, ${status.label.toLowerCase()}`}
                    >
                      <div
                        className={styles.meterFill}
                        style={{
                          width: `${(Math.min(percent, 150) / 150) * 100}%`,
                          background: status.color,
                        }}
                      />
                      <div className={styles.meterLimit} aria-hidden="true" />
                    </div>
                    <span className={cx(styles.meterStatus, status.className)}>
                      <Icon size={14} aria-hidden="true" /> {percent}%{' '}
                      {status.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={componentStyles.muted}>
              Transformer loading appears after &ldquo;Grid modeling&rdquo;
              runs. The line marks 100% of rating.
            </p>
          )}
        </article>
      </div>

      <div className={styles.planned}>
        <ActionButton
          label="Add a custom widget"
          disabledReason={`Planned: ${capabilities['dashboard.customWidgets'].explanation}`}
          onPress={() => undefined}
        >
          Add widget
        </ActionButton>
        <ActionButton
          label="Export report"
          disabledReason={`Planned: ${capabilities['reports.export'].explanation}`}
          onPress={() => undefined}
        >
          Export report
        </ActionButton>
        <StatusTag status="planned" />
      </div>
    </section>
  )
}
