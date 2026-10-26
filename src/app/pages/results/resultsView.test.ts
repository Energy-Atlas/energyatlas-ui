import { describe, expect, test } from 'vitest'
import { finishJobNow } from '../../../domain/jobs/runNow.ts'
import { createWorkbench } from '../../../domain/workbench.ts'
import { STAGE_IDS, deriveStageStates } from '../../../domain/workflow.ts'
import { buildFixture } from '../../../server/fixtures.ts'
import {
  buildingRows,
  csvFileName,
  hourlyProfile,
  listResults,
  monthlySeries,
  resultCsv,
} from './resultsView.ts'

/** Splits one CSV line, honoring quoted fields. */
function fields(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out
}

function complete() {
  return createWorkbench({
    initialState: buildFixture('complete', () => new Date()),
  })
}

function entries(workbench: ReturnType<typeof complete>) {
  const state = workbench.getState()
  return listResults(state, deriveStageStates(state.workflow, state.tasks))
}

describe('results view', () => {
  test('lists the working baseline and each modeled scenario as current', () => {
    const list = entries(complete())
    expect(list.map((entry) => entry.label)).toEqual([
      'Baseline',
      'Envelope retrofit',
    ])
    expect(list.every((entry) => entry.current)).toBe(true)
    expect(list[1]?.compareTo).toBe(list[0]?.result)
  })

  test('the CSV names its result, run, and currentness, and its total equals the summary', () => {
    const workbench = complete()
    const [baseline] = entries(workbench)
    if (!baseline) throw new Error('Missing baseline')
    const csv = resultCsv(
      workbench.getState(),
      baseline,
      '2026-10-26T00:00:00.000Z',
    )
    const lines = csv.trim().split('\n')
    expect(lines).toContain(`# run: ${baseline.result.runId}`)
    expect(lines).toContain('# currentness: current')
    expect(lines[7]).toBe(
      'building_id,name,use,archetype,floor_area[m2],annual_demand[kWh],eui[kWh/m2]',
    )
    const rows = lines.slice(8, -1)
    const sum = rows.reduce((total, line) => total + Number(fields(line)[5]), 0)
    const totalLine = fields(lines.at(-1) ?? '')
    expect(totalLine[0]).toBe('total')
    expect(Number(totalLine[5])).toBe(baseline.result.totalKwh)
    expect(sum).toBe(baseline.result.totalKwh)
    expect(csvFileName(baseline)).toBe(
      `energyatlas-baseline-${baseline.result.runId}.csv`,
    )
  })

  test('outdated results stay exportable and say so', () => {
    const workbench = complete()
    workbench.execute({
      type: 'scenario.setAdoption',
      input: {
        scenarioId: Object.keys(workbench.getState().scenarios)[0] ?? '',
        adoptionPercent: 10,
      },
    })
    const scenario = entries(workbench)[1]
    if (!scenario) throw new Error('Missing scenario')
    expect(scenario.current).toBe(false)
    expect(resultCsv(workbench.getState(), scenario, 'now')).toContain(
      '# currentness: outdated; inputs changed after this run',
    )
  })

  test('held results never appear before publication', () => {
    const workbench = complete()
    const before = entries(workbench).map((entry) => entry.result)
    workbench.execute({
      type: 'workflow.runStage',
      input: { stageId: STAGE_IDS.scenarioModeling },
    })
    const taskId = workbench.getState().taskIds.at(-1) ?? ''
    const scenarioId = Object.keys(workbench.getState().scenarios)[0] ?? ''
    finishJobNow(workbench, taskId, { failures: { [scenarioId]: 'Fault.' } })
    expect(entries(workbench).map((entry) => entry.result)).toEqual(before)
  })

  test('building series share the district shape and hourly profiles follow schedules', () => {
    const workbench = complete()
    const state = workbench.getState()
    const [baseline] = entries(workbench)
    if (!baseline) throw new Error('Missing baseline')
    const top = buildingRows(state, baseline)[0]
    if (!top) throw new Error('Missing building')
    const monthly = monthlySeries(baseline.result, top.id)
    const total = monthly.reduce((sum, value) => sum + value, 0)
    expect(Math.abs(total - top.annualKwh)).toBeLessThan(12)
    const profile = hourlyProfile(state, baseline.result, top.id)
    expect(profile.kw).toHaveLength(24)
    expect(profile.basis).toMatch(/schedule/)
    expect(Math.max(...profile.kw)).toBeGreaterThan(0)
  })
})
