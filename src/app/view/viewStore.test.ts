import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../domain/initialState.ts'
import type { Building, ResultSet, WorkbenchState } from '../../domain/types.ts'
import { createWorkbench } from '../../domain/workbench.ts'
import { APPEARANCES } from '../appearance/appearances.ts'
import { compileChartSpec } from './chartSpec.ts'
import { describeViewOperations } from './viewOperations.ts'
import { createViewStore } from './viewStore.ts'

function result(id: string, totalKwh: number): ResultSet {
  return {
    id,
    label: id,
    runId: 'run-1',
    totalKwh,
    peakKw: 10,
    monthlyKwh: Array.from({ length: 12 }, () => totalKwh / 12),
    byBuildingKwh: { B1: totalKwh },
  }
}

function building(id: string): Building {
  return {
    id,
    name: `Building ${id}`,
    footprint: [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001],
    ],
    footprintAreaM2: 100,
    sourceRef: null,
    use: 'office',
    yearBuilt: 1990,
    floors: 3,
    heightM: 9,
    floorAreaM2: 300,
    zoneCount: 2,
    shadingFactor: null,
    pvYieldKwh: null,
    archetypeId: null,
  }
}

const modeled: Partial<WorkbenchState> = {
  buildings: { B1: building('B1') },
  buildingIds: ['B1'],
  scenarios: {
    'scenario-1': {
      id: 'scenario-1',
      name: 'Half retrofitted',
      measureIds: ['measure-1'],
      adoptionPercent: 50,
      included: true,
    },
  },
  results: {
    baseline: result('baseline', 12000),
    scenarios: { 'scenario-1': result('scenario-1', 9000) },
  },
}

function setup(patch: Partial<WorkbenchState> = {}) {
  const workbench = createWorkbench({
    initialState: { ...createInitialState(), ...patch },
  })
  return { workbench, view: createViewStore(workbench) }
}

describe('view store', () => {
  it('applies view operations and logs them with their source', () => {
    const { workbench, view } = setup(modeled)
    const outcome = view.execute(
      { type: 'map.setMetric', input: { metric: 'baselineDemand' } },
      'agent',
    )
    expect(outcome.outcome.status).toBe('applied')
    expect(view.getState().map.metric).toBe('baselineDemand')
    expect(workbench.store.getState().log.at(-1)).toMatchObject({
      id: outcome.operationId,
      type: 'map.setMetric',
      source: 'agent',
      status: 'applied',
      summary: 'Map buildings are colored by Baseline demand.',
    })
  })

  it('rejects a metric without data and names the stage that produces it', () => {
    const { workbench, view } = setup()
    const outcome = view.execute({
      type: 'map.setMetric',
      input: { metric: 'pvYield' },
    })
    expect(outcome.outcome).toEqual({
      status: 'rejected',
      issues: [
        {
          path: 'metric',
          message:
            'PV yield has no data yet. Run "Shading calculation / PV yield estimation".',
        },
      ],
    })
    expect(view.getState().map.metric).toBe('floors')
    expect(workbench.store.getState().log.at(-1)?.status).toBe('rejected')
  })

  it('tracks compared scenarios and rejects unknown ones', () => {
    const { view } = setup(modeled)
    view.execute({
      type: 'dashboard.setScenarioCompared',
      input: { scenarioId: 'scenario-1', compared: false },
    })
    expect(view.getState().dashboard.hiddenScenarioIds).toEqual(['scenario-1'])
    view.execute({
      type: 'dashboard.setScenarioCompared',
      input: { scenarioId: 'scenario-1', compared: true },
    })
    expect(view.getState().dashboard.hiddenScenarioIds).toEqual([])
    expect(
      view.execute({
        type: 'dashboard.setScenarioCompared',
        input: { scenarioId: 'scenario-9', compared: true },
      }).outcome.status,
    ).toBe('rejected')
  })

  it('rejects table filters longer than 100 characters', () => {
    const { view } = setup()
    const outcome = view.execute({
      type: 'table.setQuickFilter',
      input: { text: 'x'.repeat(101) },
    })
    expect(outcome.outcome).toEqual({
      status: 'rejected',
      issues: [{ path: 'text', message: 'Use at most 100 characters.' }],
    })
  })

  it('requests a map zoom only when something is selected', () => {
    const { view, workbench } = setup(modeled)
    expect(
      view.execute({ type: 'map.focusSelection', input: {} }).outcome.status,
    ).toBe('rejected')
    workbench.execute({
      type: 'selection.set',
      input: { entityType: 'building', ids: ['B1'] },
    })
    view.execute({ type: 'map.focusSelection', input: {} })
    expect(view.getState().map.focusRequest).toBe(1)
  })

  it('switches the map between 2D and 3D and says when heights are missing', () => {
    const { view } = setup(modeled)
    expect(view.getState().map.view3d).toBe(false)
    const on = view.execute({ type: 'map.set3d', input: { enabled: true } })
    expect(on.outcome).toMatchObject({ status: 'applied' })
    expect(view.getState().map.view3d).toBe(true)
    const off = view.execute({ type: 'map.set3d', input: { enabled: false } })
    expect(off.outcome).toEqual({
      status: 'applied',
      summary: 'The map shows buildings in 2D.',
    })
    expect(view.getState().map.view3d).toBe(false)
    expect(
      view.execute({
        type: 'map.set3d',
        input: { enabled: 'yes' as unknown as boolean },
      }).outcome.status,
    ).toBe('rejected')
  })

  it('sets the scene lighting and validates its ranges', () => {
    const { view } = setup()
    expect(
      view.execute({
        type: 'map.setTimeOfDay',
        input: { minutesUtc: 9 * 60 },
      }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'Map lighting is set to 09:00 UTC.',
    })
    expect(view.getState().map.lighting.minutesUtc).toBe(9 * 60)

    expect(
      view.execute({ type: 'map.setSeason', input: { dayOfYear: 172 } })
        .outcome,
    ).toEqual({
      status: 'applied',
      summary: 'Map lighting is set to 21 June.',
    })

    // Out of range, and fractions, are refused rather than clamped.
    for (const operation of [
      { type: 'map.setSeason' as const, input: { dayOfYear: 400 } },
      { type: 'map.setTimeOfDay' as const, input: { minutesUtc: 1440 } },
      { type: 'map.setHaze' as const, input: { percent: 101 } },
      { type: 'map.setSunDiffusion' as const, input: { percent: 2.5 } },
    ]) {
      expect(view.execute(operation).outcome.status).toBe('rejected')
    }
  })

  it('shows terrain at true scale by default and validates exaggeration', () => {
    const { view } = setup(modeled)
    expect(view.getState().map).toMatchObject({
      terrain: false,
      terrainExaggeration: 1,
    })
    // Terrain belongs to the 3D scene, so a flat map refuses it.
    expect(
      view.execute({ type: 'map.setTerrain', input: { enabled: true } })
        .outcome,
    ).toMatchObject({ status: 'rejected' })
    expect(view.getState().map.terrain).toBe(false)

    view.execute({ type: 'map.set3d', input: { enabled: true } })
    const on = view.execute({
      type: 'map.setTerrain',
      input: { enabled: true },
    })
    expect(on.outcome).toMatchObject({ status: 'applied' })
    expect(view.getState().map.terrain).toBe(true)
    expect(
      view.execute({
        type: 'map.setTerrainExaggeration',
        input: { exaggeration: 4 },
      }).outcome,
    ).toEqual({
      status: 'applied',
      summary: 'Terrain is shown at 4× exaggerated.',
    })
    for (const exaggeration of [0, 11, 2.5]) {
      expect(
        view.execute({
          type: 'map.setTerrainExaggeration',
          input: { exaggeration },
        }).outcome,
      ).toMatchObject({
        status: 'rejected',
        issues: [
          { path: 'exaggeration', message: 'Use a whole number from 1 to 10.' },
        ],
      })
    }
    expect(view.getState().map.terrainExaggeration).toBe(4)
    expect(
      view.execute({ type: 'map.setTerrain', input: { enabled: false } })
        .outcome,
    ).toEqual({ status: 'applied', summary: 'The map hides terrain.' })
  })
})

describe('chart specifications', () => {
  it('rejects charts before the baseline exists', () => {
    const { view } = setup()
    expect(
      view.execute({
        type: 'dashboard.addChart',
        input: {
          title: 'Annual demand',
          kind: 'bar',
          measure: 'annualDemand',
          series: ['baseline'],
        },
      }).outcome,
    ).toEqual({
      status: 'rejected',
      issues: [
        {
          path: '',
          message: 'Charts need baseline results. Run "Baseline model setup".',
        },
      ],
    })
  })

  it('validates structure and project references before adding a chart', () => {
    const { view } = setup(modeled)
    expect(
      view.execute({
        type: 'dashboard.addChart',
        input: {
          title: 'Annual',
          kind: 'line',
          measure: 'annualDemand',
          series: ['baseline'],
        },
      }).outcome,
    ).toMatchObject({ status: 'rejected', issues: [{ path: 'measure' }] })
    expect(
      view.execute({
        type: 'dashboard.addChart',
        input: {
          title: 'Annual',
          kind: 'bar',
          measure: 'annualDemand',
          series: ['baseline', 'scenario-9'],
        },
      }).outcome,
    ).toEqual({
      status: 'rejected',
      issues: [{ path: 'series', message: 'Unknown scenario "scenario-9".' }],
    })

    const added = view.execute({
      type: 'dashboard.addChart',
      input: {
        title: ' Baseline and scenario ',
        kind: 'line',
        measure: 'monthlyDemand',
        series: ['baseline', 'scenario-1'],
      },
    })
    expect(added.outcome.status).toBe('applied')
    expect(view.getState().dashboard.charts).toEqual([
      {
        id: 'chart-1',
        title: 'Baseline and scenario',
        kind: 'line',
        measure: 'monthlyDemand',
        series: ['baseline', 'scenario-1'],
      },
    ])
    view.execute({
      type: 'dashboard.removeChart',
      input: { chartId: 'chart-1' },
    })
    expect(view.getState().dashboard.charts).toEqual([])
  })

  it('compiles a monthly line chart with a data table row per month', () => {
    const project = { ...createInitialState(), ...modeled }
    const compiled = compileChartSpec(
      {
        id: 'chart-1',
        title: 'Monthly',
        kind: 'line',
        measure: 'monthlyDemand',
        series: ['baseline', 'scenario-1'],
      },
      project,
      APPEARANCES.light.data,
      'Geist Variable',
    )
    expect(compiled.table.columns).toEqual([
      'Month',
      'Baseline (MWh)',
      'Half retrofitted (MWh)',
    ])
    expect(compiled.table.rows).toHaveLength(12)
    expect(compiled.option.series).toHaveLength(2)
    expect(compiled.missing).toEqual([])
  })

  it('lists series that lost their results instead of charting them', () => {
    const project = {
      ...createInitialState(),
      ...modeled,
      results: { baseline: result('baseline', 12000), scenarios: {} },
    }
    const compiled = compileChartSpec(
      {
        id: 'chart-1',
        title: 'Annual',
        kind: 'bar',
        measure: 'annualDemand',
        series: ['baseline', 'scenario-1'],
      },
      project,
      APPEARANCES.light.data,
      'Geist Variable',
    )
    expect(compiled.missing).toEqual(['Half retrofitted'])
    expect(compiled.table.rows).toEqual([['Baseline', '12']])
  })

  it('describes every view operation with a JSON Schema input', () => {
    const descriptions = describeViewOperations()
    expect(descriptions.map((item) => item.type)).toContain(
      'dashboard.addChart',
    )
    for (const description of descriptions) {
      expect(typeof description.inputSchema).toBe('object')
    }
  })
})
