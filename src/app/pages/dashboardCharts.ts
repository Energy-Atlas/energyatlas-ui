import type { DataPalette } from '../appearance/appearances.ts'
import type { EChartOption } from '../viz/EChart.tsx'
import {
  MONTHS,
  type ChartedScenario,
  type DashboardData,
} from './dashboardData.ts'

// Routine analytical charts stay restrained (guidelines section 3): 2px lines,
// 8px markers with a 2px surface ring, bars capped at 24px with a 4px rounded
// data end, hairline grids quieter than the data, recessive axes, a legend for
// two or more series, and a single annotation on the baseline peak. Colors come
// from the active appearance and text uses the workbench font.

const TEXT_SIZE = 12

export function toMwh(kwh: number): number {
  return Math.round(kwh / 1000)
}

export function formatMwh(kwh: number): string {
  return toMwh(kwh).toLocaleString('en-US')
}

export function scenarioLabel(item: ChartedScenario): string {
  return item.previewAdoption === null
    ? item.scenario.name
    : `${item.scenario.name} (preview ${item.previewAdoption}%)`
}

export function scenarioColor(
  item: ChartedScenario,
  palette: DataPalette,
): string {
  return palette.categorical[item.slot] ?? palette.categorical[0]
}

/** Index of the largest monthly value; the chart annotates only this point. */
export function peakMonthIndex(monthly: number[]): number {
  let peak = 0
  monthly.forEach((value, index) => {
    if (value > (monthly[peak] ?? Number.NEGATIVE_INFINITY)) peak = index
  })
  return peak
}

function tooltipStyle(palette: DataPalette) {
  const ink = palette.ink
  return {
    backgroundColor: ink.surface,
    borderColor: ink.axis,
    textStyle: { color: ink.primary, fontSize: TEXT_SIZE },
    borderRadius: 0,
    extraCssText: 'box-shadow: none;',
  }
}

function compactNumber(value: unknown): string {
  if (typeof value !== 'number') return String(value)
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toLocaleString('en-US')}k`
    : value.toLocaleString('en-US')
}

function axisNumber(value: unknown): string {
  return typeof value === 'number'
    ? value.toLocaleString('en-US')
    : String(value)
}

export function monthlyDemandOption(
  data: DashboardData,
  visible: ChartedScenario[],
  palette: DataPalette,
  fontFamily: string,
): EChartOption {
  const baseline = data.baseline
  if (!baseline) return {}
  const ink = palette.ink
  const lineSeries = (name: string, color: string, monthlyKwh: number[]) => ({
    name,
    type: 'line',
    data: monthlyKwh.map(toMwh),
    color,
    lineStyle: { width: 2, cap: 'round', join: 'round' },
    symbol: 'circle',
    symbolSize: 8,
    itemStyle: { color, borderColor: ink.surface, borderWidth: 2 },
    emphasis: { focus: 'series' },
  })
  const peakIndex = peakMonthIndex(baseline.monthlyKwh)
  const peakMonth = MONTHS[peakIndex] ?? ''
  const peakMwh = toMwh(baseline.monthlyKwh[peakIndex] ?? 0)
  const lastIndex = MONTHS.length - 1

  return {
    animation: false,
    textStyle: { fontFamily, fontSize: TEXT_SIZE },
    grid: { left: 56, right: 24, top: 48, bottom: 28 },
    legend: {
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 16,
      itemHeight: 3,
      textStyle: { color: ink.secondary, fontFamily, fontSize: TEXT_SIZE },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: ink.axis, width: 1 } },
      valueFormatter: (value: unknown) => `${axisNumber(value)} MWh`,
      ...tooltipStyle(palette),
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
      axisLabel: { color: ink.muted, formatter: axisNumber },
      splitLine: { lineStyle: { color: ink.grid, width: 1, type: 'solid' } },
    },
    series: [
      {
        ...lineSeries('Baseline', palette.deemphasis, baseline.monthlyKwh),
        markPoint: {
          silent: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: ink.primary },
          label: {
            show: true,
            position: 'top',
            distance: 8,
            align:
              peakIndex === 0
                ? 'left'
                : peakIndex === lastIndex
                  ? 'right'
                  : 'center',
            color: ink.primary,
            fontFamily,
            fontSize: TEXT_SIZE,
            formatter: `Baseline peak ${peakMonth}: ${peakMwh.toLocaleString('en-US')} MWh`,
          },
          data: [{ coord: [peakMonth, peakMwh] }],
        },
      },
      ...visible.flatMap((item) =>
        item.shown
          ? [
              lineSeries(
                scenarioLabel(item),
                scenarioColor(item, palette),
                item.shown.monthlyKwh,
              ),
            ]
          : [],
      ),
    ],
  }
}

export function annualDemandOption(
  data: DashboardData,
  visible: ChartedScenario[],
  palette: DataPalette,
  fontFamily: string,
): EChartOption {
  const baseline = data.baseline
  if (!baseline) return {}
  const ink = palette.ink
  const bars = [
    {
      name: 'Baseline',
      kwh: baseline.totalKwh,
      color: palette.deemphasis,
      reduction: null,
    },
    ...visible.flatMap((item) =>
      item.shown
        ? [
            {
              name: scenarioLabel(item),
              kwh: item.shown.totalKwh,
              color: scenarioColor(item, palette),
              reduction: item.reductionPercent,
            },
          ]
        : [],
    ),
  ]

  return {
    animation: false,
    textStyle: { fontFamily, fontSize: TEXT_SIZE },
    grid: { left: 8, right: 150, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: unknown) => `${axisNumber(value)} MWh/yr`,
      ...tooltipStyle(palette),
    },
    xAxis: {
      type: 'value',
      splitNumber: 3,
      axisLabel: { color: ink.muted, formatter: compactNumber },
      splitLine: { lineStyle: { color: ink.grid, width: 1, type: 'solid' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: bars.map((bar) => bar.name),
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.secondary },
    },
    series: [
      {
        name: 'Annual demand',
        type: 'bar',
        barMaxWidth: 24,
        data: bars.map((bar) => ({
          value: toMwh(bar.kwh),
          itemStyle: { color: bar.color, borderRadius: 0 },
          label: {
            show: true,
            position: 'right',
            color: ink.secondary,
            formatter: `${formatMwh(bar.kwh)} MWh${bar.reduction === null ? '' : ` (${bar.reduction > 0 ? '-' : ''}${Math.abs(bar.reduction)}%)`}`,
          },
        })),
      },
    ],
  }
}
