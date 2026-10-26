import { useId } from 'react'
import { compareScenarios } from '../../domain/scenarios/comparison.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import { useStageStates, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'

const MWH = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

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
        <table
          className={componentStyles.table}
          aria-label="Modeled comparison"
        >
          <thead>
            <tr>
              <th scope="col">Result</th>
              <th scope="col">Annual demand (MWh)</th>
              <th scope="col">Peak (kW)</th>
              <th scope="col">Reduction</th>
              <th scope="col">Currentness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                <td>{MWH.format(row.totalKwh / 1000)}</td>
                <td>{MWH.format(row.peakKw)}</td>
                <td>
                  {row.id === 'baseline' ? '—' : `${row.reductionPercent}%`}
                </td>
                <td>{row.current ? 'Current' : 'Outdated'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
