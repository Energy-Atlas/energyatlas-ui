import { useId, useMemo } from 'react'
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
import { PanelHeader } from '../../components/PanelHeader.tsx'
import { PropertyList } from '../../components/PropertyList.tsx'
import { Section } from '../../components/Section.tsx'
import { SegmentedFilter } from '../../components/SegmentedFilter.tsx'
import { downloadText } from '../../csv.ts'
import { WorkbenchTable } from '../../components/WorkbenchTable.tsx'
import { cx } from '../../cx.ts'
import { formatDateTime, formatEnergy, formatNumber } from '../../format.ts'
import type { DataColumn } from '../../tables/tableModel.ts'
import { EChart, useChartFont, type EChartOption } from '../../viz/EChart.tsx'
import {
  MONTH_LABELS,
  buildingRows,
  csvFileName,
  hourlyProfile,
  listResults,
  monthlySeries,
  resultCsv,
  type BuildingRow,
} from './resultsView.ts'
import styles from './results.module.css'

const PAGE_SIZE = 25
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour}:00`)

type SeriesRow = { category: string; value: number | null }

function seriesColumns(
  unit: string,
  resolution: 'monthly' | 'hourly',
): DataColumn<SeriesRow>[] {
  return [
    {
      id: 'category',
      header: resolution === 'hourly' ? 'Hour' : 'Month',
      value: (row) => row.category,
      rowHeader: true,
      sortable: false,
      width: 110,
    },
    {
      id: 'value',
      header: 'Demand',
      value: (row) => row.value,
      type: 'number',
      unit,
      decimals: resolution === 'hourly' ? 1 : 0,
    },
  ]
}

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

  const buildingColumns: DataColumn<BuildingRow>[] = [
    {
      id: 'id',
      header: 'Building',
      value: (row) => row.id,
      type: 'identifier',
      rowHeader: true,
      width: 110,
    },
    { id: 'use', header: 'Use', value: (row) => row.use, type: 'enum' },
    {
      id: 'archetype',
      header: 'Archetype',
      value: (row) => row.archetype,
      type: 'enum',
    },
    {
      id: 'floorArea',
      header: 'Floor area',
      value: (row) => row.floorAreaM2,
      type: 'number',
      unit: 'm²',
      empty: '—',
    },
    {
      id: 'annual',
      header: 'Annual demand',
      value: (row) => row.annualKwh,
      type: 'number',
      unit: 'kWh',
    },
    {
      id: 'eui',
      header: 'EUI',
      value: (row) => row.euiKwhPerM2,
      type: 'number',
      unit: 'kWh/m²',
      decimals: 1,
      empty: '—',
    },
    ...(entry?.compareTo
      ? [
          {
            id: 'saving',
            header: 'Saving vs baseline',
            value: (row: BuildingRow) => row.savingKwh,
            type: 'number' as const,
            unit: 'kWh',
            empty: '—',
          },
        ]
      : []),
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      action: true,
      width: 150,
      render: (row) => (
        <span className={styles.rowActions}>
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
        </span>
      ),
    },
  ]

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

  return (
    <section
      className={cx(componentStyles.page, styles.page)}
      aria-labelledby={headingId}
    >
      <PanelHeader
        title="Results"
        headingId={headingId}
        meta={<CapabilityBadge id="results.drilldown" />}
      />

      <RadioGroup
        className={styles.results}
        orientation="horizontal"
        value={entry.id}
        onChange={(resultId) => {
          view.execute({ type: 'results.select', input: { resultId } })
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
        <PropertyList
          items={[
            {
              label: 'Total',
              value: `${formatEnergy(entry.result.totalKwh, 'MWh', 0)}/yr (synthetic)`,
            },
            {
              label: 'Peak',
              value: formatNumber(entry.result.peakKw, { unit: 'kW' }),
            },
            { label: 'Buildings', value: `${rows.length} with results` },
            {
              label: 'Published by',
              value: `${entry.stageName}, run ${entry.result.runId}${
                entry.publishedAt
                  ? ` at ${formatDateTime(entry.publishedAt)}`
                  : ''
              }`,
            },
            {
              label: 'Currentness',
              value: entry.current
                ? 'Current: produced with the present inputs.'
                : `${entry.currentness.charAt(0).toUpperCase()}${entry.currentness.slice(1)}.`,
            },
            { label: 'Source', value: entry.note },
          ]}
        />
        <div className={styles.actions}>
          <ActionButton
            label={`Export ${entry.label} as CSV`}
            disabledReason={null}
            onPress={() => {
              const exportedAt = new Date().toISOString()
              downloadText(
                csvFileName(entry),
                resultCsv(state, entry, exportedAt),
              )
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
          <SegmentedFilter
            aria-label="Resolution"
            segments={[
              { id: 'monthly', label: 'Monthly' },
              {
                id: 'hourly',
                label: 'Typical weekday (hourly)',
                disabledReason: buildingId
                  ? null
                  : 'Select a building to see its typical weekday.',
              },
            ]}
            value={resolution}
            onChange={(value) =>
              view.execute({
                type: 'results.setResolution',
                input: { resolution: value },
              })
            }
          />
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
            <Section
              title="Show the series as a table"
              id="results.series"
              level={4}
            >
              <WorkbenchTable
                id="results.series"
                aria-label={series.title}
                columns={seriesColumns(series.unit, resolution)}
                rows={series.categories.map((category, index) => ({
                  category,
                  value: series.values[index] ?? null,
                }))}
                rowKey={(row) => row.category}
                exportContext={[
                  `result: ${entry.label}, run ${entry.result.runId}`,
                ]}
              />
            </Section>
          </>
        ) : null}
      </section>

      <section aria-label="Buildings" className={styles.section}>
        <h3 className={styles.label}>
          Buildings in {entry.label}, highest demand first
        </h3>
        <WorkbenchTable
          // A new result starts from its first page.
          key={entry.id}
          id="results.buildings"
          aria-label="Building results"
          columns={buildingColumns}
          rows={rows}
          rowKey={(row) => row.id}
          pageSize={PAGE_SIZE}
          currentKey={buildingId}
          exportContext={[
            `result: ${entry.label}, run ${entry.result.runId}`,
            `currentness: ${entry.currentness}`,
          ]}
        />
      </section>
    </section>
  )
}
