import { chartedScenarioOrder } from '../pages/dashboardData.ts'
import { z } from 'zod'
import type { ValidationIssue } from '../../domain/commands.ts'
import type { ResultSet, WorkbenchState } from '../../domain/types.ts'
import type { DataPalette } from '../appearance/appearances.ts'
import { formatMwh, toMwh } from '../pages/dashboardCharts.ts'
import { MAX_CHARTED_SCENARIOS, MONTHS } from '../pages/dashboardData.ts'
import type { EChartOption } from '../viz/EChart.tsx'

// Declarative chart specifications (decisions 0006 and 0011). A specification
// is serializable view state: the agent or a person creates one through the
// dashboard.addChart view operation, and the Dashboard compiles it to ECharts
// options and a data table with the same visual method as its built-in charts.

export const BASELINE_SERIES = 'baseline'

export const CHART_MEASURE_LABELS = {
  monthlyDemand: 'Monthly demand (MWh)',
  annualDemand: 'Annual demand (MWh/yr)',
  peakDemand: 'Peak demand (kW)',
} as const

export const chartSpecInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a chart title.')
      .max(80, 'Use at most 80 characters.'),
    kind: z.enum(['line', 'bar']),
    measure: z.enum(['monthlyDemand', 'annualDemand', 'peakDemand']),
    series: z
      .array(z.string().min(1))
      .min(1, 'Choose at least one series.')
      .max(
        MAX_CHARTED_SCENARIOS,
        `Charts compare at most ${MAX_CHARTED_SCENARIOS} series.`,
      ),
  })
  .superRefine((spec, context) => {
    if (spec.kind === 'line' && spec.measure !== 'monthlyDemand') {
      context.addIssue({
        code: 'custom',
        path: ['measure'],
        message:
          'Line charts show monthly demand; use a bar chart for annual or peak demand.',
      })
    }
    if (spec.kind === 'bar' && spec.measure === 'monthlyDemand') {
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Monthly demand is shown as a line chart.',
      })
    }
    if (new Set(spec.series).size !== spec.series.length) {
      context.addIssue({
        code: 'custom',
        path: ['series'],
        message: 'Each series can appear only once.',
      })
    }
  })

export type ChartSpecInput = z.output<typeof chartSpecInputSchema>

export type ChartSpec = ChartSpecInput & { id: string }

/** Checks a structurally valid specification against the project. */
export function validateChartSpec(
  spec: ChartSpecInput,
  project: WorkbenchState,
): ValidationIssue[] {
  if (!project.results.baseline) {
    return [
      {
        path: '',
        message: 'Charts need baseline results. Run "Baseline model setup".',
      },
    ]
  }
  const scenarios = chartedScenarioOrder(project)
  const issues: ValidationIssue[] = []
  for (const id of spec.series) {
    if (id === BASELINE_SERIES) continue
    const slot = scenarios.findIndex((scenario) => scenario.id === id)
    const scenario = scenarios[slot]
    if (!scenario) {
      const leftOut = project.scenarios[id]
      issues.push({
        path: 'series',
        message: leftOut
          ? `"${leftOut.name}" is left out of the comparison set, so it has no chart slot.`
          : `Unknown scenario "${id}".`,
      })
    } else if (slot >= MAX_CHARTED_SCENARIOS) {
      issues.push({
        path: 'series',
        message: `"${scenario.name}" is beyond the first ${MAX_CHARTED_SCENARIOS} scenarios, which have validated chart colors.`,
      })
    } else if (!project.results.scenarios[id]) {
      issues.push({
        path: 'series',
        message: `"${scenario.name}" has no results yet. Run "Scenario modeling".`,
      })
    }
  }
  return issues
}

type ResolvedSeries = { label: string; color: string; result: ResultSet }

function resolveSeries(
  spec: ChartSpec,
  project: WorkbenchState,
  palette: DataPalette,
): { series: ResolvedSeries[]; missing: string[] } {
  const scenarios = chartedScenarioOrder(project)
  const series: ResolvedSeries[] = []
  const missing: string[] = []
  for (const id of spec.series) {
    if (id === BASELINE_SERIES) {
      const baseline = project.results.baseline
      if (baseline) {
        series.push({
          label: 'Baseline',
          color: palette.deemphasis,
          result: baseline,
        })
      } else {
        missing.push('Baseline')
      }
      continue
    }
    const slot = scenarios.findIndex((scenario) => scenario.id === id)
    const scenario = scenarios[slot]
    const result = project.results.scenarios[id]
    if (!scenario || !result || slot >= MAX_CHARTED_SCENARIOS) {
      missing.push(scenario?.name ?? project.scenarios[id]?.name ?? id)
      continue
    }
    series.push({
      label: scenario.name,
      color: palette.categorical[slot] ?? palette.categorical[0],
      result,
    })
  }
  return { series, missing }
}

function formatNumber(value: unknown): string {
  return typeof value === 'number'
    ? value.toLocaleString('en-US')
    : String(value)
}

export type CompiledChart = {
  option: EChartOption
  height: number
  /** Accessible summary; the data table carries the values. */
  summary: string
  table: { caption: string; columns: string[]; rows: string[][] }
  /** Series named in the specification that have no results now. */
  missing: string[]
}

export function compileChartSpec(
  spec: ChartSpec,
  project: WorkbenchState,
  palette: DataPalette,
  fontFamily: string,
): CompiledChart {
  const { series, missing } = resolveSeries(spec, project, palette)
  const ink = palette.ink
  const text = { fontFamily, fontSize: 12 }
  const tooltip = {
    backgroundColor: ink.surface,
    borderColor: ink.axis,
    textStyle: { color: ink.primary, fontSize: 12 },
    borderRadius: 0,
    extraCssText: 'box-shadow: none;',
  }
  const measureLabel = CHART_MEASURE_LABELS[spec.measure]
  const summary = `${spec.kind === 'line' ? 'Line' : 'Bar'} chart of ${measureLabel.toLowerCase()} for ${series.map((item) => item.label).join(', ') || 'no series'}. Values are in the data table below.`
  const caption = `${spec.title} data`

  if (spec.measure === 'monthlyDemand') {
    return {
      option: {
        animation: false,
        textStyle: text,
        grid: { left: 56, right: 24, top: 40, bottom: 28 },
        legend: {
          top: 0,
          left: 0,
          icon: 'roundRect',
          itemWidth: 16,
          itemHeight: 3,
          textStyle: { color: ink.secondary, ...text },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'line',
            lineStyle: { color: ink.axis, width: 1 },
          },
          valueFormatter: (value: unknown) => `${formatNumber(value)} MWh`,
          ...tooltip,
        },
        xAxis: {
          type: 'category',
          data: MONTHS,
          boundaryGap: false,
          axisLine: { lineStyle: { color: ink.axis } },
          axisTick: { show: false },
          axisLabel: { color: ink.muted },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: ink.muted, formatter: formatNumber },
          splitLine: { lineStyle: { color: ink.grid, width: 1 } },
        },
        series: series.map((item) => ({
          name: item.label,
          type: 'line',
          data: item.result.monthlyKwh.map(toMwh),
          color: item.color,
          lineStyle: { width: 2, cap: 'round', join: 'round' },
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: {
            color: item.color,
            borderColor: ink.surface,
            borderWidth: 2,
          },
        })),
      },
      height: 280,
      summary,
      table: {
        caption,
        columns: ['Month', ...series.map((item) => `${item.label} (MWh)`)],
        rows: MONTHS.map((month, index) => [
          month,
          ...series.map((item) =>
            formatMwh(item.result.monthlyKwh[index] ?? 0),
          ),
        ]),
      },
      missing,
    }
  }

  const unit = spec.measure === 'annualDemand' ? 'MWh/yr' : 'kW'
  const value = (item: ResolvedSeries) =>
    spec.measure === 'annualDemand'
      ? toMwh(item.result.totalKwh)
      : item.result.peakKw
  return {
    option: {
      animation: false,
      textStyle: text,
      grid: { left: 8, right: 120, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'item',
        valueFormatter: (raw: unknown) => `${formatNumber(raw)} ${unit}`,
        ...tooltip,
      },
      xAxis: {
        type: 'value',
        splitNumber: 3,
        axisLabel: { color: ink.muted, formatter: formatNumber },
        splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: series.map((item) => item.label),
        axisLine: { lineStyle: { color: ink.axis } },
        axisTick: { show: false },
        axisLabel: { color: ink.secondary },
      },
      series: [
        {
          name: measureLabel,
          type: 'bar',
          barMaxWidth: 24,
          data: series.map((item) => ({
            value: value(item),
            itemStyle: { color: item.color, borderRadius: 0 },
            label: {
              show: true,
              position: 'right',
              color: ink.secondary,
              formatter: `${formatNumber(value(item))} ${unit}`,
            },
          })),
        },
      ],
    },
    height: 72 + 44 * Math.max(1, series.length),
    summary,
    table: {
      caption,
      columns: ['Series', measureLabel],
      rows: series.map((item) => [item.label, formatNumber(value(item))]),
    },
    missing,
  }
}
