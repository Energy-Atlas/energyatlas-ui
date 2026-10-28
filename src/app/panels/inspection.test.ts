import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../domain/initialState.ts'
import type { Building, WorkbenchState } from '../../domain/types.ts'
import { emptyParts } from '../../domain/archetypes/parts.ts'
import { buildInspection, LIST_LIMIT } from './inspection.ts'

function building(id: string, patch: Partial<Building> = {}): Building {
  return {
    id,
    name: `Building ${id}`,
    footprint: [],
    footprintAreaM2: 100,
    sourceRef: null,
    use: 'office',
    yearBuilt: 1990,
    floors: 3,
    heightM: 9.5,
    floorAreaM2: 300,
    zoneCount: 2,
    shadingFactor: 0.8,
    pvYieldKwh: 12000,
    parts: {
      construction: { partId: 'C1', ruleId: 'R1', ruleName: 'Offices' },
      systems: { partId: 'S1', ruleId: 'R1', ruleName: 'Offices' },
      spaceLoads: { partId: 'L1', ruleId: 'R1', ruleName: 'Offices' },
      externalLoads: { partId: 'E1', ruleId: 'R1', ruleName: 'Offices' },
    },
    ...patch,
  }
}

function stateWith(patch: Partial<WorkbenchState>): WorkbenchState {
  return { ...createInitialState(), ...patch }
}

const archetypes: WorkbenchState['archetypes'] = {
  'ARC-1': {
    id: 'ARC-1',
    name: 'Office 1990s',
    use: 'office',
    yearFrom: 1990,
    yearTo: 1999,
    parts: {
      construction: 'C1',
      systems: 'S1',
      spaceLoads: 'L1',
      externalLoads: 'E1',
    },
    source: { kind: 'project', operationId: 'op-1' },
  },
}

const source = { kind: 'project', operationId: 'op-1' } as const
const parts: WorkbenchState['parts'] = {
  C1: {
    id: 'C1',
    name: 'Curtain wall',
    kind: 'construction',
    wallU: 0.7,
    roofU: 0.4,
    windowU: 2.6,
    windowRatio: 0.5,
    infiltrationAch: 0.5,
    source,
  },
  S1: {
    id: 'S1',
    name: 'VAV',
    kind: 'systems',
    fuel: 'gas',
    heatingEfficiency: 0.85,
    coolingCop: 3.2,
    hotWaterKwhPerM2: 6,
    source,
  },
  S2: {
    id: 'S2',
    name: 'Heat pump',
    kind: 'systems',
    fuel: 'electric',
    heatingEfficiency: 3,
    coolingCop: 3.5,
    hotWaterKwhPerM2: 6,
    source,
  },
  L1: {
    id: 'L1',
    name: 'Office loads',
    kind: 'spaceLoads',
    lightingWPerM2: 10,
    equipmentWPerM2: 12,
    m2PerPerson: 15,
    scheduleId: null,
    source,
  },
  E1: {
    id: 'E1',
    name: 'Exterior',
    kind: 'externalLoads',
    exteriorLightingKwhPerM2: 3,
    processKwhPerM2: 8,
    source,
  },
}
const rules: WorkbenchState['rules'] = {
  R1: {
    id: 'R1',
    name: 'Offices',
    enabled: true,
    logic: 'all',
    conditions: [],
    parts: archetypes['ARC-1']!.parts,
    origin: 'project',
  },
}

describe('buildInspection', () => {
  it('is empty when nothing is selected', () => {
    expect(buildInspection(createInitialState())).toEqual({ kind: 'empty' })
  })

  it('describes one building with results, warnings, links, and provenance', () => {
    const state = stateWith({
      buildings: { B1: building('B1', { use: null }) },
      buildingIds: ['B1'],
      archetypes,
      parts,
      rules,
      ruleIds: ['R1'],
      results: {
        baseline: {
          id: 'baseline',
          label: 'Baseline',
          runId: 'run-1',
          totalKwh: 50000,
          peakKw: 20,
          monthlyKwh: [],
          byBuildingKwh: { B1: 40000 },
        },
        scenarios: {},
        scenarioVersions: {},
      },
      gridElements: {
        T1: {
          id: 'T1',
          kind: 'transformer',
          name: 'Transformer T1',
          coordinates: [],
          ratingKva: 400,
          buildingIds: ['B1'],
        },
      },
      pendingEdits: {
        'B1:floors': { entityId: 'B1', field: 'floors', from: 3, to: 5 },
      },
      overrides: {
        'B1:systems': {
          entityId: 'B1',
          field: 'systems',
          value: 'S2',
          operationId: 'op-7',
          source: 'manual',
        },
      },
      selection: { entityType: 'building', ids: ['B1'] },
    })

    const inspection = buildInspection(state)
    expect(inspection.kind).toBe('single')
    if (inspection.kind !== 'single') return
    expect(inspection.title).toBe('Building B1')
    // A manual part makes the combination no archetype's.
    expect(inspection.properties).toContainEqual({
      label: 'Archetype',
      value: 'Mixed parts',
    })
    expect(inspection.properties).toContainEqual({
      label: 'Construction',
      value: 'Curtain wall (rule "Offices")',
    })
    expect(inspection.properties).toContainEqual({
      label: 'Systems',
      value: 'Heat pump (manual)',
    })
    expect(inspection.properties).toContainEqual({
      label: 'Use',
      value: 'No data',
    })
    expect(inspection.results).toEqual([
      { label: 'Baseline demand', value: '40 MWh/yr' },
    ])
    expect(inspection.warnings).toEqual([
      'No data for use.',
      'Pending edit, not applied: Floors 3 to 5.',
    ])
    expect(inspection.linked).toEqual([
      {
        entityType: 'archetypePart',
        id: 'C1',
        label: 'Construction: Curtain wall',
      },
      { entityType: 'archetypePart', id: 'S2', label: 'Systems: Heat pump' },
      {
        entityType: 'archetypePart',
        id: 'L1',
        label: 'Space loads: Office loads',
      },
      {
        entityType: 'archetypePart',
        id: 'E1',
        label: 'External loads: Exterior',
      },
      { entityType: 'assignmentRule', id: 'R1', label: 'Rule: Offices' },
      { entityType: 'gridElement', id: 'T1', label: 'Transformer T1' },
    ])
    expect(inspection.provenance[0]).toContain(
      'Systems part set to Heat pump by a manual edit (operation op-7); it wins over the assignment rules.',
    )
  })

  it('explains why the baseline has no result for a building', () => {
    const state = stateWith({
      buildings: { B1: building('B1', { parts: emptyParts() }) },
      buildingIds: ['B1'],
      results: {
        baseline: {
          id: 'baseline',
          label: 'Baseline',
          runId: 'run-1',
          totalKwh: 1,
          peakKw: 1,
          monthlyKwh: [],
          byBuildingKwh: {},
        },
        scenarios: {},
        scenarioVersions: {},
      },
      selection: { entityType: 'building', ids: ['B1'] },
    })

    const inspection = buildInspection(state)
    if (inspection.kind !== 'single') {
      throw new Error('Expected a single inspection.')
    }
    expect(inspection.results).toEqual([])
    expect(inspection.resultsHint).toBe(
      'The baseline model skipped this building: it has no construction, systems, space loads, or external loads part.',
    )
    expect(inspection.warnings).toEqual([
      'No data for construction part, systems part, space loads part, external loads part.',
    ])
  })

  it('summarizes several buildings and limits the listed items', () => {
    const ids = Array.from(
      { length: LIST_LIMIT + 2 },
      (_, index) => `B${index}`,
    )
    const state = stateWith({
      buildings: Object.fromEntries(
        ids.map((id, index) => [id, building(id, { floors: index + 1 })]),
      ),
      buildingIds: ids,
      selection: { entityType: 'building', ids },
    })

    const inspection = buildInspection(state)
    expect(inspection.kind).toBe('multiple')
    if (inspection.kind !== 'multiple') return
    expect(inspection.summary).toContainEqual({
      label: 'Buildings',
      value: '12',
    })
    expect(inspection.summary).toContainEqual({
      label: 'Floors',
      value: '1 to 12',
    })
    expect(inspection.items).toHaveLength(LIST_LIMIT)
    expect(inspection.itemsMore).toBe(2)
  })

  it('warns when a selected transformer is over its rating', () => {
    const state = stateWith({
      buildings: { B1: building('B1') },
      buildingIds: ['B1'],
      gridElements: {
        T1: {
          id: 'T1',
          kind: 'transformer',
          name: 'Transformer T1',
          coordinates: [],
          ratingKva: 400,
          buildingIds: ['B1'],
        },
      },
      gridResult: { runId: 'grid-1', transformerLoadingPercent: { T1: 131 } },
      selection: { entityType: 'gridElement', ids: ['T1'] },
    })

    const inspection = buildInspection(state)
    expect(inspection.kind).toBe('single')
    if (inspection.kind !== 'single') return
    expect(inspection.results).toEqual([
      { label: 'Peak loading', value: '131% of rating' },
    ])
    expect(inspection.warnings).toEqual(['Over rating at peak load.'])
    expect(inspection.linked).toEqual([
      { entityType: 'building', id: 'B1', label: 'Building B1' },
    ])
  })
})
