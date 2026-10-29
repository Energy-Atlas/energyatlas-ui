import { useId } from 'react'
import { compareScenarios } from '../../domain/scenarios/comparison.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { useStageStates, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
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
    id: 'adoption',
    header: 'Aggregated at',
    value: (row) => row.adoption,
    wrap: true,
    empty: '—',
  },
  {
    id: 'currentness',
    header: 'Currentness',
    value: (row) => (row.current ? 'Current' : 'Outdated'),
    type: 'enum',
  },
]

/**
 * Baseline and modeled scenarios side by side, each labeled current or
 * outdated, with the adoption and seed each scenario was aggregated at.
 */
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
  // After a calibration Adopt the Baseline row is the new working baseline,
  // while reductions still compare with the baseline each scenario was
  // modeled against; say so, as Results, the CSV, and the Dashboard do.
  const notes = rows.filter((row) => row.baselineNote !== null)
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Modeled comparison</h3>
      {notes.length > 0 ? (
        <InlineAlert
          tone="warning"
          title="Reductions compare with an earlier baseline"
          live="off"
        >
          {notes.length === 1 ? (
            `${notes[0]?.name}: ${notes[0]?.baselineNote}`
          ) : (
            <ul>
              {notes.map((row) => (
                <li key={row.id}>
                  {row.name}: {row.baselineNote}
                </li>
              ))}
            </ul>
          )}
        </InlineAlert>
      ) : null}
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
