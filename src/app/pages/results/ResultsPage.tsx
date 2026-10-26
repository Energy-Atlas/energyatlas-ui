import { useId, useMemo, useState } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import { STAGE_IDS } from '../../../domain/workflow.ts'
import {
  useAppearance,
  useServices,
  useStageStates,
  useViewState,
  useWorkbenchSnapshot,
} from '../../WorkbenchContext.tsx'
import { ActionButton } from '../../components/ActionButton.tsx'
import { CapabilityBadge } from '../../components/CapabilityBadge.tsx'
import { EmptyState } from '../../components/EmptyState.tsx'
import componentStyles from '../../components/components.module.css'
import formStyles from '../../components/forms.module.css'
import { cx } from '../../cx.ts'
import { EChart, useChartFont, type EChartOption } from '../../viz/EChart.tsx'
import {
  MONTH_LABELS,
  buildingRows,
  csvFileName,
  hourlyProfile,
  listResults,
  monthlySeries,
  resultCsv,
} from './resultsView.ts'
import styles from './results.module.css'

const PAGE_SIZE = 25
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour}:00`)

/** A one-series line chart in the dashboard's style. */
function lineOption(
  categories: string[],
  values: number[],
  unit: string,
  color: string,
  ink: { muted: string; grid: string; axis: string; surface: string },
  fontFamily: string,
): EChartOption {
  return {
    animation: false,
    textStyle: { fontFamily, fontSize: 12 },
    grid: { left: 64, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) =>
        `${typeof value === 'number' ? NUMBER.format(value) : String(value)} ${unit}`,
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: ink.muted,
        formatter: (value: number) => NUMBER.format(value),
      },
      splitLine: { lineStyle: { color: ink.grid } },
    },
    series: [
      {
        type: 'line',
        data: values,
        color,
        lineStyle: { width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color, borderColor: ink.surface, borderWidth: 2 },
      },
    ],
  }
}

/** Starts a browser download of text as a file. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke later so the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Results (jobs rollout plan, slice 8): published results only, with
 * provenance and currentness, per-building drill-down, monthly and
 * typical-weekday series, and a CSV export that names what it exports.
 */
export function ResultsPage() {
  const headingId = useId()
  const { view, workbench, client } = useServices()
  const appearance = useAppearance()
  const font = useChartFont()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const states = useStageStates()
  const choice = useViewState((current) => current.results)
  const [shown, setShown] = useState(PAGE_SIZE)
  const entries = useMemo(() => listResults(state, states), [state, states])
  const entry =
    entries.find((candidate) => candidate.id === choice.resultId) ?? entries[0]
  const rows = useMemo(
    () => (entry ? buildingRows(state, entry) : []),
    [state, entry],
  )
  const buildingId =
    choice.buildingId &&
    entry?.result.byBuildingKwh[choice.buildingId] !== undefined
      ? choice.buildingId
      : null
  const resolution = buildingId ? choice.resolution : 'monthly'
  const palette = appearance.data
  const series = useMemo(() => {
    if (!entry) return null
    if (resolution === 'hourly' && buildingId) {
      const profile = hourlyProfile(state, entry.result, buildingId)
      return {
        categories: HOURS,
        values: profile.kw,
        unit: 'kW',
        title: `Typical weekday, ${state.buildings[buildingId]?.name ?? buildingId} (kW)`,
        basis: profile.basis,
      }
    }
    return {
      categories: MONTH_LABELS,
      values: monthlySeries(entry.result, buildingId),
      unit: 'kWh',
      title: `Monthly demand, ${buildingId ? (state.buildings[buildingId]?.name ?? buildingId) : 'district'} (kWh)`,
      basis: buildingId
        ? 'The building’s share of the district’s monthly shape.'
        : 'District monthly totals of the published result.',
    }
  }, [entry, resolution, buildingId, state])
  const option = useMemo(
    () =>
      series
        ? lineOption(
            series.categories,
            series.values,
            series.unit,
            palette.categorical[0],
            palette.ink,
            font.family,
          )
        : {},
    [series, palette, font],
  )

  if (!entry) {
    return (
      <section className={componentStyles.page} aria-labelledby={headingId}>
        <h2 id={headingId}>Results</h2>
        <EmptyState
          title="No published results yet"
          stageId={STAGE_IDS.baseline}
          message="Results appear once Baseline model setup has published a baseline."
        />
      </section>
    )
  }

  const visibleRows = rows.slice(0, shown)

  return (
    <section
      className={cx(componentStyles.page, styles.page)}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <h2 id={headingId}>Results</h2>
        <CapabilityBadge id="results.drilldown" />
      </header>

      <RadioGroup
        className={styles.results}
        orientation="horizontal"
        value={entry.id}
        onChange={(resultId) => {
          view.execute({ type: 'results.select', input: { resultId } })
          setShown(PAGE_SIZE)
        }}
      >
        <Label className={styles.label}>Published result</Label>
        {entries.map((candidate) => (
          <Radio
            key={candidate.id}
            value={candidate.id}
            className={formStyles.radio}
          >
            {candidate.label}{' '}
            <span
              className={cx(
                styles.currentness,
                !candidate.current && styles.outdated,
              )}
            >
              {candidate.current ? 'Current' : 'Outdated'}
            </span>
          </Radio>
        ))}
      </RadioGroup>

      <section aria-label="Provenance" className={styles.section}>
        <dl className={styles.facts}>
          <dt>Total</dt>
          <dd>
            {NUMBER.format(entry.result.totalKwh / 1000)} MWh/yr (synthetic)
          </dd>
          <dt>Peak</dt>
          <dd>{NUMBER.format(entry.result.peakKw)} kW</dd>
          <dt>Buildings</dt>
          <dd>{rows.length} with results</dd>
          <dt>Published by</dt>
          <dd>
            {entry.stageName}, run {entry.result.runId}
            {entry.publishedAt
              ? ` at ${new Date(entry.publishedAt).toLocaleString()}`
              : ''}
          </dd>
          <dt>Currentness</dt>
          <dd>
            {entry.current
              ? 'Current: produced with the present inputs.'
              : `${entry.currentness.charAt(0).toUpperCase()}${entry.currentness.slice(1)}.`}
          </dd>
          <dt>Source</dt>
          <dd>{entry.note}</dd>
        </dl>
        <div className={styles.actions}>
          <ActionButton
            label={`Export ${entry.label} as CSV`}
            disabledReason={null}
            onPress={() => {
              const exportedAt = new Date().toISOString()
              download(csvFileName(entry), resultCsv(state, entry, exportedAt))
              workbench.record({
                type: 'results.export',
                title: 'Export results as CSV',
                input: { resultId: entry.id, runId: entry.result.runId },
                summary: `Exported "${entry.label}" (run ${entry.result.runId}, ${entry.current ? 'current' : 'outdated'}) as CSV with ${rows.length} buildings.`,
              })
            }}
          >
            Export CSV
          </ActionButton>
          <CapabilityBadge id="results.csv" />
          {!entry.current ? (
            <span className={styles.warning}>
              The export states this in its header: {entry.currentness}.
            </span>
          ) : null}
        </div>
      </section>

      <section aria-label="Time series" className={styles.section}>
        <div className={styles.seriesHeader}>
          <h3 className={styles.label}>{series?.title}</h3>
          <RadioGroup
            className={styles.resolution}
            orientation="horizontal"
            value={resolution}
            onChange={(value) => {
              if (value === 'monthly' || value === 'hourly') {
                view.execute({
                  type: 'results.setResolution',
                  input: { resolution: value },
                })
              }
            }}
          >
            <Label className="visually-hidden">Resolution</Label>
            <Radio value="monthly" className={formStyles.radio}>
              Monthly
            </Radio>
            <Radio
              value="hourly"
              className={formStyles.radio}
              isDisabled={!buildingId}
            >
              Typical weekday (hourly)
            </Radio>
          </RadioGroup>
          {buildingId ? (
            <button
              type="button"
              className={componentStyles.button}
              onClick={() =>
                view.execute({
                  type: 'results.showBuilding',
                  input: { buildingId: null },
                })
              }
            >
              Back to district
            </button>
          ) : (
            <span className={componentStyles.muted}>
              Choose a building below for its hourly profile.
            </span>
          )}
        </div>
        {series ? (
          <>
            <EChart
              option={option}
              height={220}
              label={`Line chart: ${series.title}. Values are in the table below.`}
            />
            <p className={componentStyles.muted}>{series.basis}</p>
            <details className={styles.details}>
              <summary>Show the series as a table</summary>
              <table
                className={componentStyles.table}
                aria-label={series.title}
              >
                <thead>
                  <tr>
                    {series.categories.map((category) => (
                      <th key={category} scope="col">
                        {category}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {series.values.map((value, index) => (
                      <td key={index}>{NUMBER.format(value)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </details>
          </>
        ) : null}
      </section>

      <section aria-label="Buildings" className={styles.section}>
        <h3 className={styles.label}>
          Buildings in {entry.label}, highest demand first
        </h3>
        <div className={styles.tableWrap}>
          <table
            className={componentStyles.table}
            aria-label="Building results"
          >
            <thead>
              <tr>
                <th scope="col">Building</th>
                <th scope="col">Use</th>
                <th scope="col">Archetype</th>
                <th scope="col">Floor area (m²)</th>
                <th scope="col">Annual demand (kWh)</th>
                <th scope="col">EUI (kWh/m²)</th>
                {entry.compareTo ? (
                  <th scope="col">Saving vs baseline (kWh)</th>
                ) : null}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  aria-current={row.id === buildingId ? 'true' : undefined}
                  className={cx(row.id === buildingId && styles.currentRow)}
                >
                  <th scope="row">{row.id}</th>
                  <td>{row.use}</td>
                  <td>{row.archetype}</td>
                  <td>
                    {row.floorAreaM2 === null
                      ? '—'
                      : NUMBER.format(row.floorAreaM2)}
                  </td>
                  <td>{NUMBER.format(row.annualKwh)}</td>
                  <td>{row.euiKwhPerM2 ?? '—'}</td>
                  {entry.compareTo ? (
                    <td>
                      {row.savingKwh === null
                        ? '—'
                        : NUMBER.format(row.savingKwh)}
                    </td>
                  ) : null}
                  <td className={styles.rowActions}>
                    <button
                      type="button"
                      className={componentStyles.button}
                      aria-label={`Show results of ${row.id}`}
                      onClick={() =>
                        view.execute({
                          type: 'results.showBuilding',
                          input: { buildingId: row.id },
                        })
                      }
                    >
                      Show
                    </button>
                    <button
                      type="button"
                      className={componentStyles.button}
                      aria-label={`Select ${row.id} on the map and table`}
                      onClick={() =>
                        void client.execute({
                          type: 'selection.set',
                          input: { entityType: 'building', ids: [row.id] },
                        })
                      }
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown ? (
          <p className={styles.more}>
            Showing {shown} of {rows.length}.{' '}
            <button
              type="button"
              className={componentStyles.button}
              onClick={() => setShown(shown + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, rows.length - shown)} more
            </button>
          </p>
        ) : null}
      </section>
    </section>
  )
}
