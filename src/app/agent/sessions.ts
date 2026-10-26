import type { Requirement } from '../../domain/stagePlan.ts'
import type { StageState, WorkbenchState } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  MAX_CHARTED_SCENARIOS,
  chartedScenarioOrder,
} from '../pages/dashboardData.ts'
import { command, layoutCall, viewCall, type ToolCall } from './tools.ts'
import type { ReferenceTarget } from './types.ts'

// Scripted agent sessions (decision 0006). Each replays realistic tool calls
// over the synthetic project. Steps can be functions evaluated when reached, so
// a session adapts to the project as it is at that moment.

export type ScriptContext = {
  state: () => WorkbenchState
  stageStates: () => Record<string, StageState>
  /** Values a session carries between its steps. */
  memory: Record<string, unknown>
}

export type TitledCall = {
  title: string
  /** A function builds the call when it runs, for inputs created by earlier calls. */
  call: ToolCall | ((context: ScriptContext) => ToolCall)
}

export type Step =
  | { kind: 'say'; markdown: string }
  | { kind: 'reason'; text: string }
  | { kind: 'reference'; label: string; target: ReferenceTarget }
  | { kind: 'tool'; title: string; call: ToolCall }
  | {
      kind: 'propose'
      title: string
      description: string
      calls: TitledCall[]
    }
  | {
      kind: 'ensure'
      targets: string[]
      purpose: string
      requirement: Requirement
    }

export type StepSource =
  Step | ((context: ScriptContext) => Step | Step[] | null)

export type ScriptedSession = {
  id: string
  label: string
  prompt: string
  description: string
  /** Free text matching any of these starts the session. */
  keywords: RegExp[]
  steps: StepSource[]
}

const say = (markdown: string): Step => ({ kind: 'say', markdown })
const reason = (text: string): Step => ({ kind: 'reason', text })
const reference = (label: string, target: ReferenceTarget): Step => ({
  kind: 'reference',
  label,
  target,
})
const tool = (title: string, call: ToolCall): Step => ({
  kind: 'tool',
  title,
  call,
})
const propose = (
  title: string,
  description: string,
  calls: TitledCall[],
): Step => ({ kind: 'propose', title, description, calls })
const ensure = (
  targets: string[],
  purpose: string,
  requirement: Requirement = 'data',
): Step => ({ kind: 'ensure', targets, purpose, requirement })

function outdatedStageNames(context: ScriptContext): string[] {
  const state = context.state()
  const states = context.stageStates()
  return state.workflow.stageIds
    .filter((id) => states[id] === 'stale')
    .map((id) => state.workflow.stages[id]?.name ?? id)
}

const layoutSession: ScriptedSession = {
  id: 'layout',
  label: 'Map beside Table, tallest buildings',
  prompt: 'Put the map beside the table and point out the tallest buildings.',
  description:
    'Rearranges pages, selects buildings, and zooms the map through logged layout, view, and selection operations.',
  keywords: [/\bbeside\b/, /\bside by side\b/, /\btallest\b/, /\barrange/],
  steps: [
    reason(
      'This request changes how the workbench is arranged and points at specific buildings. Floor counts come from "Geospatial data enriching", so that stage must have run.',
    ),
    ensure([STAGE_IDS.enrichment], 'Finding the tallest buildings'),
    tool(
      'Place Map beside Table',
      layoutCall({
        type: 'layout.placePage',
        input: { page: 'map', beside: 'table', side: 'right' },
      }),
    ),
    tool(
      'Show buildings in the table',
      viewCall({ type: 'table.setView', input: { view: 'buildings' } }),
    ),
    (context) => {
      const state = context.state()
      const tallest = state.buildingIds
        .flatMap((id) => {
          const building = state.buildings[id]
          return building && building.floors !== null ? [building] : []
        })
        .sort(
          (a, b) =>
            (b.floors ?? 0) - (a.floors ?? 0) || a.id.localeCompare(b.id),
        )
        .slice(0, 5)
      const ids = tallest.map((building) => building.id)
      context.memory.tallestIds = ids
      if (ids.length === 0) {
        return say(
          'No building has a floor count yet, so there is nothing to point out.',
        )
      }
      return [
        reason(
          `Sorting by floors gives ${ids.join(', ')}, with ${tallest.at(-1)?.floors ?? 0} to ${tallest[0]?.floors ?? 0} floors.`,
        ),
        tool(
          `Select the ${ids.length} tallest buildings`,
          command({
            type: 'selection.set',
            input: { entityType: 'building', ids },
          }),
        ),
      ]
    },
    tool(
      'Color the map by floors',
      viewCall({ type: 'map.setMetric', input: { metric: 'floors' } }),
    ),
    tool(
      'Zoom the map to the selection',
      viewCall({ type: 'map.focusSelection', input: {} }),
    ),
    (context) => {
      const ids = (context.memory.tallestIds as string[] | undefined) ?? []
      return [
        say(
          `I placed **Map** beside **Table**, selected the ${ids.length} tallest buildings (${ids.join(', ')}), colored the map by floors, and zoomed to them. The table highlights the same rows because the selection is shared.\n\nWhen you are done, ask me to *restore the default layout*.`,
        ),
        reference('Inspect the selected buildings', { type: 'inspection' }),
      ]
    },
  ],
}

const representationSession: ScriptedSession = {
  id: 'representation',
  label: 'PV yield map and demand chart',
  prompt:
    'Color the map by PV yield and chart baseline against scenario demand.',
  description:
    'Colors the map by a metric and adds a Dashboard chart from a validated view specification.',
  keywords: [/\bpv\b/, /\bchart/, /\bcolou?r the map\b/, /\bvisuali[sz]/],
  steps: [
    reason(
      'PV yield comes from "Shading calculation / PV yield estimation" and demand from "Baseline model setup". A comparison also needs modeled scenarios; without them the chart can show the baseline only.',
    ),
    ensure(
      [STAGE_IDS.shading, STAGE_IDS.baseline],
      'Coloring by PV yield and charting demand',
    ),
    tool(
      'Open the Map',
      layoutCall({ type: 'layout.openPage', input: { page: 'map' } }),
    ),
    tool(
      'Color the map by PV yield',
      viewCall({ type: 'map.setMetric', input: { metric: 'pvYield' } }),
    ),
    (context) => {
      const state = context.state()
      const modeled = chartedScenarioOrder(state)
        .slice(0, MAX_CHARTED_SCENARIOS)
        .filter((scenario) => state.results.scenarios[scenario.id])
        .slice(0, MAX_CHARTED_SCENARIOS - 1)
      const title =
        modeled.length > 0
          ? 'Baseline and scenario monthly demand'
          : 'Baseline monthly demand'
      context.memory.chartTitle = title
      const steps: Step[] = []
      if (modeled.length === 0) {
        steps.push(
          reason(
            'No scenario has results yet, so the chart shows the baseline alone instead of implying a comparison.',
          ),
        )
      }
      steps.push(
        tool(
          'Add a monthly demand chart to the Dashboard',
          viewCall({
            type: 'dashboard.addChart',
            input: {
              title,
              kind: 'line',
              measure: 'monthlyDemand',
              series: ['baseline', ...modeled.map((scenario) => scenario.id)],
            },
          }),
        ),
      )
      return steps
    },
    tool(
      'Place the Dashboard beside the Map',
      layoutCall({
        type: 'layout.placePage',
        input: { page: 'dashboard', beside: 'map', side: 'right' },
      }),
    ),
    (context) => {
      const title =
        typeof context.memory.chartTitle === 'string'
          ? context.memory.chartTitle
          : 'a new chart'
      const outdated = outdatedStageNames(context)
      return [
        say(
          `The map colors buildings by PV yield, and the Dashboard has a new chart, **${title}**, built from a validated view specification. Its data table lists every value. All numbers are synthetic.${outdated.length > 0 ? `\n\nThese stages are outdated: ${outdated.join(', ')}. Rerun them from the Workflow panel when you want current results.` : ''}`,
        ),
        reference('Open the Dashboard', { type: 'page', page: 'dashboard' }),
      ]
    },
  ],
}

const NEW_MEASURE = 'Envelope retrofit'
const NEW_SCENARIO = 'Envelope retrofit at 50%'

const modelChangeSession: ScriptedSession = {
  id: 'modelChange',
  label: 'Propose a scenario change',
  prompt:
    'Propose a higher adoption for a scenario and show what becomes outdated.',
  description:
    'Proposes a model change that waits for approval, then shows outdated stages and offers to rerun them.',
  keywords: [
    /\badoption\b/,
    /\bpropose\b/,
    /\bmodel change\b/,
    /\boutdated\b/,
    /\bmeasure\b/,
    /\bscenario\b/,
  ],
  steps: [
    reason(
      'A scenario change alters the project model, so each change waits for your approval. Afterwards I check which stages depend on the changed inputs.',
    ),
    (context) => {
      const state = context.state()
      const scenarios = Object.values(state.scenarios)
      const scenario = scenarios.find((item) => item.included) ?? scenarios[0]
      if (!scenario) {
        const measure = Object.values(state.measures)[0]
        const calls: TitledCall[] = []
        if (!measure) {
          calls.push({
            title: `Create measure "${NEW_MEASURE}"`,
            call: command({
              type: 'measure.create',
              input: {
                name: NEW_MEASURE,
                kind: 'envelope',
                savingsPercent: 15,
                appliesTo: 'all',
              },
            }),
          })
        }
        calls.push({
          title: `Create scenario "${NEW_SCENARIO}"`,
          call: (current) => {
            const first = Object.values(current.state().measures)[0]
            return command({
              type: 'scenario.create',
              input: {
                name: NEW_SCENARIO,
                measureIds: first ? [first.id] : [],
                adoptionPercent: 50,
              },
            })
          },
        })
        context.memory.scenarioName = NEW_SCENARIO
        return [
          reason(
            'The project has no scenario yet, so the smallest useful model change is to create one.',
          ),
          propose(
            measure ? 'Create a scenario' : 'Create a measure and a scenario',
            measure
              ? `Create the scenario "${NEW_SCENARIO}" from the existing measure "${measure.name}".`
              : `Create the measure "${NEW_MEASURE}" (envelope, 15% savings, all buildings) and the scenario "${NEW_SCENARIO}" that uses it.`,
            calls,
          ),
        ]
      }
      const next =
        scenario.adoptionPercent <= 80
          ? scenario.adoptionPercent + 20
          : scenario.adoptionPercent - 20
      context.memory.scenarioName = scenario.name
      const title = `Set "${scenario.name}" adoption to ${next}%`
      return [
        reason(
          `"${scenario.name}" uses ${scenario.adoptionPercent}% adoption. Changing it to ${next}% shows how a model change propagates.`,
        ),
        propose(
          title,
          `Change adoption from ${scenario.adoptionPercent}% to ${next}%. "Scenario definitions" and the stages after it become outdated until they run again.`,
          [
            {
              title,
              call: command({
                type: 'scenario.setAdoption',
                input: { scenarioId: scenario.id, adoptionPercent: next },
              }),
            },
          ],
        ),
      ]
    },
    (context) => {
      const state = context.state()
      const states = context.stageStates()
      const outdated = state.workflow.stageIds.filter(
        (id) => states[id] === 'stale',
      )
      if (outdated.length === 0) {
        return say(
          'No stage became outdated, because the scenario stages had not run on the previous inputs.',
        )
      }
      return [
        say(
          `These stages are now **outdated** because they ran on the previous scenario inputs:\n\n${outdated.map((id) => `- ${state.workflow.stages[id]?.name ?? id}`).join('\n')}`,
        ),
        ...outdated
          .slice(0, 3)
          .map((id) =>
            reference(
              `Show "${state.workflow.stages[id]?.name ?? id}" on the Roadmap`,
              { type: 'stage', stageId: id },
            ),
          ),
      ]
    },
    ensure(
      [STAGE_IDS.scenarioModeling],
      'Updating scenario results',
      'current',
    ),
    (context) => {
      const state = context.state()
      const scenario =
        Object.values(state.scenarios).find(
          (item) => item.name === context.memory.scenarioName,
        ) ??
        Object.values(state.scenarios).find((item) => item.included) ??
        Object.values(state.scenarios)[0]
      const baseline = state.results.baseline
      const result = scenario ? state.results.scenarios[scenario.id] : undefined
      if (!scenario || !baseline || !result || baseline.totalKwh <= 0) {
        return say(
          'Scenario results are not available, so I cannot report the effect.',
        )
      }
      const reduction =
        Math.round((1 - result.totalKwh / baseline.totalKwh) * 1000) / 10
      return [
        say(
          `Scenario modeling is current. **${scenario.name}** reduces annual demand by ${reduction}% against the baseline (synthetic numbers).`,
        ),
        reference('Open the Dashboard', { type: 'page', page: 'dashboard' }),
      ]
    },
  ],
}

const restoreSession: ScriptedSession = {
  id: 'restore',
  label: 'Restore the default layout',
  prompt: 'Restore the default layout.',
  description: 'Resets the workbench layout through the layout controller.',
  keywords: [/\brestore\b/, /\bdefault layout\b/, /\breset\b/],
  steps: [
    reason(
      'Resetting the layout only changes how tabs and panels are arranged; project data, selection, and results stay as they are.',
    ),
    tool(
      'Restore the default layout',
      layoutCall({ type: 'layout.reset', input: {} }),
    ),
    say(
      'The default layout is back: Assets and Workflow on the left, pages in one tab group, and this panel on the right.',
    ),
  ],
}

const CALIBRATION_METER = 'meter:district-2025'

const calibrationSession: ScriptedSession = {
  id: 'calibration',
  label: 'Calibrate and explore results',
  prompt:
    'Fit the baseline to the 2025 meters, then show me the highest-demand building.',
  description:
    'Runs a calibration fit job, reports its residuals without adopting it, and drills into published results through view operations.',
  keywords: [/\bcalibrat/, /\bmeters?\b/, /\bdrill/],
  steps: [
    reason(
      'A calibration fit compares the modeled baseline with metered months, so the baseline must be current. The fit publishes a separate variant; adopting it would change the working baseline, so that stays your decision.',
    ),
    ensure([STAGE_IDS.baseline], 'Calibrating the baseline', 'current'),
    propose(
      'Fit the baseline to the 2025 meters',
      'The fit runs as one job and publishes a calibrated variant; the working baseline does not change.',
      [
        {
          title:
            'Fit the modeled baseline to "District utility meters, 2025" in kWh',
          call: command({
            type: 'calibration.fit',
            input: { meterId: CALIBRATION_METER, unit: 'kWh' },
          }),
        },
      ],
    ),
    (context) => {
      const state = context.state()
      const id = state.calibration.variantIds.at(-1)
      const variant = id ? state.calibration.variants[id] : undefined
      if (!variant) return say('The fit published no variant.')
      return say(
        `**${variant.label}** fits with factor ${variant.factor}: CV(RMSE) ${variant.before.cvrmsePercent}% to ${variant.after.cvrmsePercent}%, NMBE ${variant.before.nmbePercent}% to ${variant.after.nmbePercent}%. I did not adopt it; Adopt on the Calibration page makes it the working baseline and outdates scenario results.`,
      )
    },
    tool(
      'Open Results',
      layoutCall({ type: 'layout.openPage', input: { page: 'results' } }),
    ),
    tool(
      'Show the published baseline',
      viewCall({ type: 'results.select', input: { resultId: 'baseline' } }),
    ),
    (context) => {
      const baseline = context.state().results.baseline
      const top = Object.entries(baseline?.byBuildingKwh ?? {}).sort(
        ([a, x], [b, y]) => y - x || (a < b ? -1 : 1),
      )[0]
      if (!top) return say('The baseline has no building results to show.')
      context.memory.topBuilding = top[0]
      return [
        tool(
          `Drill into ${top[0]}, the highest-demand building`,
          viewCall({
            type: 'results.showBuilding',
            input: { buildingId: top[0] },
          }),
        ),
        tool(
          'Show its typical weekday by hour',
          viewCall({
            type: 'results.setResolution',
            input: { resolution: 'hourly' },
          }),
        ),
        say(
          `Results now show ${top[0]} with ${Math.round(top[1]).toLocaleString('en-US')} kWh a year and its typical weekday from its archetype schedule. Export CSV on that page downloads the published baseline with its run named in the header.`,
        ),
      ]
    },
  ],
}

export const SESSIONS: ScriptedSession[] = [
  layoutSession,
  representationSession,
  modelChangeSession,
  calibrationSession,
  restoreSession,
]

// Restoring is checked first: its phrases also mention the layout.
const MATCH_ORDER = [
  restoreSession,
  calibrationSession,
  layoutSession,
  representationSession,
  modelChangeSession,
]

export function matchSession(text: string): ScriptedSession | null {
  const normalized = text.toLowerCase()
  return (
    MATCH_ORDER.find((session) =>
      session.keywords.some((keyword) => keyword.test(normalized)),
    ) ?? null
  )
}
