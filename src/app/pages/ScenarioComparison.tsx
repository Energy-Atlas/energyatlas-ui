import { useId } from 'react'
import { compareScenarios } from '../../domain/scenarios/comparison.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { useStageStates, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import { WorkbenchTable } from '../components/WorkbenchTable.tsx'
import type { DataColumn } from '../tables/tableModel.ts'

type ComparisonRow = ReturnType<typeof compareScenarios>[number]

const COLUMNS: DataColumn<ComparisonRow>[] = [
  {
    id: 'result',
    header: 'Result',
    value: (row) => row.name,
    rowHeader: true,
  },
  {
    id: 'annual',
    header: 'Annual demand',
    value: (row) => row.totalKwh / 1000,
    type: 'number',
    unit: 'MWh',
  },
  {
    id: 'peak',
    header: 'Peak',
    value: (row) => row.peakKw,
    type: 'number',
    unit: 'kW',
  },
  {
    id: 'reduction',
    header: 'Reduction',
    value: (row) => (row.id === 'baseline' ? null : row.reductionPercent),
    type: 'number',
    unit: '%',
    decimals: 1,
    empty: '—',
  },
  {
    id: 'currentness',
    header: 'Currentness',
    value: (row) => (row.current ? 'Current' : 'Outdated'),
    type: 'enum',
  },
]

/** Baseline and modeled scenarios side by side, each labeled current or outdated. */
export function ScenarioComparison() {
  const headingId = useId()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const states = useStageStates()
  const rows = compareScenarios(
    state,
    states,
    STAGE_IDS.scenarioModeling,
    STAGE_IDS.baseline,
  )
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Modeled comparison</h3>
      {rows.length === 0 ? (
        <p className={componentStyles.empty}>
          No modeled results yet. Run Baseline model setup, then Scenario
          definitions and Scenario modeling.
        </p>
      ) : (
        <WorkbenchTable
          id="creator.comparison"
          aria-label="Modeled comparison"
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
        />
      )}
    </section>
  )
}
