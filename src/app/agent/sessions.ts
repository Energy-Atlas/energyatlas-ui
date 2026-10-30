import { previewAssignment } from '../../domain/archetypes/assignment.ts'
import { MEASURE_LIBRARY } from '../../domain/scenarios/library.ts'
import {
  previewScenarioRules,
  scenarioRules,
} from '../../domain/scenarios/rules.ts'
import { reviewSchema } from '../../domain/schema/matching.ts'
import type { Requirement } from '../../domain/stagePlan.ts'
import type { StageState, WorkbenchState } from '../../domain/types.ts'
import { STAGE_IDS } from '../../domain/workflow.ts'
import {
  MAX_CHARTED_SCENARIOS,
  chartedScenarioOrder,
} from '../pages/dashboardData.ts'
import { formatCount, formatEnergy } from '../format.ts'
import {
  BUILDING_ZONING_LABELS,
  DEFAULT_PERIMETER_DEPTH_M,
  ZONING_FALLBACK_CODES,
  buildingZoning,
  describeAppliedZoning,
  describeZoning,
  type BuildingZoning,
  type BuildingZoningMode,
} from '../../domain/zoning/zoning.ts'
import { zonesLayer } from '../pages/mapLayers.ts'
import type { ViewState } from '../view/viewOperations.ts'
import {
  command,
  layoutCall,
  layoutsCall,
  viewCall,
  type ToolCall,
} from './tools.ts'
import type { ReferenceTarget } from './types.ts'

// Scripted agent sessions (decision 0006). Each replays realistic tool calls
// over the synthetic project. Steps can be functions evaluated when reached, so
// a session adapts to the project as it is at that moment.

export type ScriptContext = {
  state: () => WorkbenchState
  /** The view state, for view operations that name a layer (decision 0034). */
  view: () => ViewState
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

/** Reduction of a published scenario against the baseline, in percent, or null. */
function publishedReduction(
  state: WorkbenchState,
  scenarioId: string,
): number | null {
  const baseline = state.results.baseline
  const result = state.results.scenarios[scenarioId]
  if (!baseline || !result || baseline.totalKwh <= 0) return null
  return Math.round((1 - result.totalKwh / baseline.totalKwh) * 1000) / 10
}

const modelChangeSession: ScriptedSession = {
  id: 'modelChange',
  label: 'Propose a scenario change',
  prompt:
    'Propose a higher adoption for a scenario and show how the results change.',
  description:
    'Proposes a model change that waits for approval, then shows what it outdates; adoption is applied when results are aggregated, so a modeled scenario updates without a new run.',
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
        context.memory.created = true
        return [
          reason(
            'The project has no scenario yet, so the smallest useful model change is to create one, with one rule that gives every building the measure.',
          ),
          propose(
            measure ? 'Create a scenario' : 'Create a measure and a scenario',
            measure
              ? `Create the scenario "${NEW_SCENARIO}" with the rule "All buildings", which gives every building the existing measure "${measure.name}".`
              : `Create the measure "${NEW_MEASURE}" (envelope, 15% savings) and the scenario "${NEW_SCENARIO}" with the rule "All buildings", which gives every building that measure.`,
            calls,
          ),
        ]
      }
      const next =
        scenario.adoptionPercent <= 80
          ? scenario.adoptionPercent + 20
          : scenario.adoptionPercent - 20
      context.memory.scenarioName = scenario.name
      context.memory.reductionBefore = publishedReduction(state, scenario.id)
      const modeled = Boolean(state.results.scenarioVersions[scenario.id])
      // A result saved before scenario rules has no versions to re-aggregate.
      const legacy = !modeled && Boolean(state.results.scenarios[scenario.id])
      const states = context.stageStates()
      context.memory.modeled = modeled
      context.memory.staleBefore = state.workflow.stageIds.filter(
        (id) => states[id] === 'stale',
      )
      const title = `Set "${scenario.name}" adoption to ${next}%`
      return [
        reason(
          `"${scenario.name}" uses ${scenario.adoptionPercent}% adoption with seed ${scenario.adoptionSeed}. Adoption samples which affected buildings adopt when results are aggregated, so it is not an input of Scenario modeling.`,
        ),
        propose(
          title,
          `Change adoption from ${scenario.adoptionPercent}% to ${next}%. ${modeled ? 'Its published result is re-aggregated at once from the modeled alternative versions; no stage becomes outdated.' : legacy ? 'Its result was saved before scenario rules and has no versions to re-aggregate, so "Scenario definitions" and the stages after it become outdated until they run again.' : 'It has no modeled versions yet, so the new adoption applies when Scenario modeling publishes.'}`,
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
      const scenario = Object.values(state.scenarios).find(
        (item) => item.name === context.memory.scenarioName,
      )
      const after = scenario ? publishedReduction(state, scenario.id) : null
      const before = context.memory.reductionBefore
      const staleBefore = Array.isArray(context.memory.staleBefore)
        ? (context.memory.staleBefore as string[])
        : []
      const newlyOutdated = outdated.filter((id) => !staleBefore.includes(id))
      if (
        context.memory.modeled === true &&
        newlyOutdated.length === 0 &&
        scenario &&
        after !== null
      ) {
        return say(
          `No stage became outdated: adoption is applied when results are aggregated. **${scenario.name}** now reduces annual demand by ${after}% against the baseline${typeof before === 'number' ? ` (${before}% before)` : ''}, from the same modeled versions (synthetic numbers).`,
        )
      }
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
      const reduction = scenario ? publishedReduction(state, scenario.id) : null
      if (!scenario || reduction === null) {
        return say(
          'Scenario results are not available, so I cannot report the effect.',
        )
      }
      return [
        say(
          `Scenario modeling is current. **${scenario.name}** reduces annual demand by ${reduction}% against the baseline at ${scenario.adoptionPercent}% adoption, seed ${scenario.adoptionSeed} (synthetic numbers).`,
        ),
        reference('Open the Dashboard', { type: 'page', page: 'dashboard' }),
      ]
    },
  ],
}

const OLDER_HOMES_RULE = 'Older homes: heat pumps'
const HEAT_PUMP_LIBRARY_ID = 'measure:heat-pumps'
const HEAT_PUMP_SCENARIO = 'Heat pumps for older homes'

/** The library heat pump measure in the project, if it is there. */
function heatPumpMeasureId(state: WorkbenchState): string | null {
  const entry = MEASURE_LIBRARY.find(
    (item) => item.libraryId === HEAT_PUMP_LIBRARY_ID,
  )
  return (
    Object.values(state.measures).find(
      (measure) => measure.kind === 'heating' && measure.name === entry?.name,
    )?.id ?? null
  )
}

/** The scenario the rule session adds its rule to: an included one, or the one it creates. */
function ruleSessionScenario(state: WorkbenchState) {
  const scenarios = Object.values(state.scenarios)
  return (
    scenarios.find((item) => item.name === HEAT_PUMP_SCENARIO) ??
    scenarios.find((item) => item.included) ??
    null
  )
}

const scenarioRulesSession: ScriptedSession = {
  id: 'scenarioRules',
  label: 'Add a scenario rule',
  prompt: 'Give older homes heat pumps with a scenario rule.',
  description:
    'Previews a scenario, proposes a rule that gives residential buildings built before 1980 heat pumps (it waits for approval), and models the scenario.',
  keywords: [
    /\bscenario rules?\b/,
    /\bmeasure rules?\b/,
    /\bolder (homes|houses|residential)\b/,
  ],
  steps: [
    reason(
      'Scenario rules choose buildings by their attributes and give each at most one measure per category, tried top first. A rule that sets only heating leaves envelope, lighting, and PV to the rules below it. Estimates need baseline results.',
    ),
    ensure(
      [STAGE_IDS.baseline],
      'Estimating the scenario against the baseline',
    ),
    tool(
      'Open the Scenarios page',
      layoutCall({ type: 'layout.openPage', input: { page: 'creator' } }),
    ),
    (context) => {
      const state = context.state()
      const scenario = ruleSessionScenario(state)
      const calls: TitledCall[] = []
      if (!heatPumpMeasureId(state)) {
        calls.push({
          title: 'Add "Air-source heat pumps" from the measure library',
          call: command({
            type: 'measure.addFromLibrary',
            input: { libraryId: HEAT_PUMP_LIBRARY_ID },
          }),
        })
      }
      if (!scenario) {
        calls.push({
          title: `Create the scenario "${HEAT_PUMP_SCENARIO}"`,
          call: command({
            type: 'scenario.create',
            input: { name: HEAT_PUMP_SCENARIO, adoptionPercent: 50 },
          }),
        })
      }
      const existing = scenario
        ? scenario.ruleIds
            .map((id) => state.scenarioRules[id])
            .find((rule) => rule?.name === OLDER_HOMES_RULE)
        : undefined
      calls.push({
        title: existing
          ? `Update the rule "${OLDER_HOMES_RULE}" and move it to the top`
          : `Add the rule "${OLDER_HOMES_RULE}" at the top`,
        call: (current) => {
          const now = current.state()
          const target = ruleSessionScenario(now)
          return command({
            type: 'scenarioRule.save',
            input: {
              scenarioId: target?.id ?? '',
              name: OLDER_HOMES_RULE,
              ...(existing ? { id: existing.id, enabled: true } : {}),
              logic: 'all',
              conditions: [
                { field: 'use', operator: 'equals', value: 'residential' },
                { field: 'yearBuilt', operator: 'smaller', value: '1980' },
              ],
              measures: {
                envelope: null,
                heating: heatPumpMeasureId(now),
                lighting: null,
                pv: null,
              },
              position: 0,
            },
          })
        },
      })
      const older = state.buildingIds.filter((id) => {
        const building = state.buildings[id]
        return (
          building?.use === 'residential' &&
          building.yearBuilt !== null &&
          building.yearBuilt < 1980
        )
      }).length
      return [
        reason(
          `${older} residential buildings were built before 1980. A rule at the top of ${scenario ? `"${scenario.name}"` : 'a new scenario'} that sets only their heating measure keeps the other categories from the rules below.`,
        ),
        propose(
          'Give older homes heat pumps',
          `${heatPumpMeasureId(state) ? '' : 'Add "Air-source heat pumps" from the library, '}${scenario ? '' : `create the scenario "${HEAT_PUMP_SCENARIO}" at 50% adoption, `}${existing ? `update the rule "${OLDER_HOMES_RULE}" (use equals residential and year built smaller than 1980, sets heating) and move it to the top${existing.enabled ? '' : ', switched on'}` : `add the rule "${OLDER_HOMES_RULE}" (use equals residential and year built smaller than 1980, sets heating) at the top${scenario ? ` of "${scenario.name}"` : ''}`}. Scenario definitions and results become outdated until they run again.`,
          calls,
        ),
      ]
    },
    (context) => {
      const scenario = ruleSessionScenario(context.state())
      if (!scenario) {
        return say(
          'The scenario was not created, so there is nothing to preview.',
        )
      }
      context.memory.scenarioName = scenario.name
      return tool(
        `Preview "${scenario.name}"`,
        viewCall({
          type: 'scenarios.setPreviewScenario',
          input: { scenarioId: scenario.id },
        }),
      )
    },
    (context) => {
      const state = context.state()
      const scenario = ruleSessionScenario(state)
      const rule = scenario
        ? scenarioRules(state, scenario).find(
            (each) => each.name === OLDER_HOMES_RULE,
          )
        : undefined
      if (!scenario || !rule) {
        return say('The rule was not added, so there is nothing to preview.')
      }
      const preview = previewScenarioRules(state, {
        id: scenario.id,
        rules: scenarioRules(state, scenario),
        adoptionPercent: scenario.adoptionPercent,
        adoptionSeed: scenario.adoptionSeed,
      })
      const own = preview.rules.find((each) => each.ruleId === rule.id)
      return [
        say(
          `The preview shows **${OLDER_HOMES_RULE}** taking the heating measure of ${own?.takes.heating ?? 0} buildings. ${preview.affectedIds.length} buildings take a measure in **${scenario.name}**, and ${preview.adoptedIds.length} adopt at ${scenario.adoptionPercent}%, seed ${scenario.adoptionSeed}.${preview.estimate ? ` Estimated ${preview.estimate.reductionPercent}% lower annual demand than the baseline (synthetic).` : ''}`,
        ),
        reference('Show the rules on the Scenarios page', {
          type: 'page',
          page: 'creator',
        }),
      ]
    },
    ensure(
      [STAGE_IDS.scenarioModeling],
      'Modeling the scenario with the new rule',
      'current',
    ),
    (context) => {
      const state = context.state()
      const scenario = ruleSessionScenario(state)
      const reduction = scenario ? publishedReduction(state, scenario.id) : null
      if (!scenario || reduction === null) {
        return say(
          'The scenario has no published result, so I cannot report the effect.',
        )
      }
      return [
        say(
          `Scenario modeling published **${scenario.name}**: ${reduction}% lower annual demand than the baseline at ${scenario.adoptionPercent}% adoption (synthetic numbers). Changing its adoption later re-aggregates the result without another run.`,
        ),
        reference('Open the Dashboard', { type: 'page', page: 'dashboard' }),
      ]
    },
  ],
}

const HEAT_PUMP = 'Air-source heat pump'
const TALL_RULE = 'Tall buildings: heat pumps'

/** The heat pump part the rules session adds, if the project has it. */
function heatPumpId(state: WorkbenchState): string | null {
  return (
    Object.values(state.parts).find(
      (part) => part.kind === 'systems' && part.name === HEAT_PUMP,
    )?.id ?? null
  )
}

const rulesSession: ScriptedSession = {
  id: 'assignmentRules',
  label: 'Add an assignment rule',
  prompt: 'Give tall buildings heat pumps with an archetype assignment rule.',
  description:
    'Previews the archetype assignment rules, proposes a rule that sets one part for tall buildings (it waits for approval), and reassigns.',
  keywords: [
    /\bassignment rules?\b/,
    /\barchetype rules?\b/,
    /\bheat pumps?\b/,
  ],
  steps: [
    reason(
      'Assignment rules give each building four archetype parts, tried top first; a rule that sets only the systems part leaves the other parts to the rules below it.',
    ),
    ensure([STAGE_IDS.archetypes], 'Assigning archetype parts'),
    tool(
      'Open Archetypes',
      layoutCall({ type: 'layout.openPage', input: { page: 'archetypes' } }),
    ),
    tool(
      'Preview the systems part',
      viewCall({
        type: 'archetypes.setPreviewPart',
        input: { part: 'systems' },
      }),
    ),
    (context) => {
      const state = context.state()
      const calls: TitledCall[] = []
      if (!heatPumpId(state)) {
        calls.push({
          title: `Create the systems part "${HEAT_PUMP}"`,
          call: command({
            type: 'part.save',
            input: {
              name: HEAT_PUMP,
              kind: 'systems',
              fuel: 'electric',
              heatingEfficiency: 2.8,
              coolingCop: 3.4,
              hotWaterKwhPerM2: 20,
            },
          }),
        })
      }
      const existing = Object.values(state.rules).find(
        (rule) => rule.name === TALL_RULE,
      )
      calls.push({
        title: existing
          ? `Update the rule "${TALL_RULE}" and move it to the top`
          : `Add the rule "${TALL_RULE}" at the top`,
        call: (current) =>
          command({
            type: 'rule.save',
            input: {
              name: TALL_RULE,
              // An existing rule is switched on explicitly, as the proposal says.
              ...(existing ? { id: existing.id, enabled: true } : {}),
              logic: 'all',
              conditions: [{ field: 'floors', operator: 'larger', value: '6' }],
              parts: {
                construction: null,
                systems: heatPumpId(current.state()),
                spaceLoads: null,
                externalLoads: null,
              },
              position: 0,
            },
          }),
      })
      const tall = state.buildingIds.filter(
        (id) => (state.buildings[id]?.floors ?? 0) > 6,
      ).length
      return [
        reason(
          `${tall} buildings have more than six floors. A rule at the top that sets only their systems part keeps their construction and loads from the rules below.`,
        ),
        propose(
          'Give tall buildings heat pumps',
          `${heatPumpId(state) ? '' : `Create the systems part "${HEAT_PUMP}" (electric, COP 2.8 heating, 3.4 cooling), then `}${existing ? `update the rule "${TALL_RULE}" (floors larger than 6, sets systems), move it to the top${existing.enabled ? '' : ', and switch it on'}` : `add the rule "${TALL_RULE}" (floors larger than 6, sets systems) at the top`}. Archetype modeling becomes outdated until it runs again.`,
          calls,
        ),
      ]
    },
    (context) => {
      const state = context.state()
      const rule = Object.values(state.rules).find(
        (each) => each.name === TALL_RULE,
      )
      const preview = previewAssignment(state)
      const own = preview.rules.find((each) => each.ruleId === rule?.id)
      if (!rule || !own) {
        return say('The rule was not added, so there is nothing to preview.')
      }
      return [
        say(
          `The preview shows **${TALL_RULE}** taking the systems part of ${own.takes.systems} buildings; their other parts still come from the rules below. ${preview.changes} buildings would change.`,
        ),
        reference('Show the rules on the Archetypes page', {
          type: 'page',
          page: 'archetypes',
        }),
      ]
    },
    ensure([STAGE_IDS.archetypes], 'Publishing the new parts', 'current'),
    (context) => {
      const state = context.state()
      const id = heatPumpId(state)
      const count = state.buildingIds.filter(
        (buildingId) =>
          state.buildings[buildingId]?.parts.systems?.partId === id,
      ).length
      return say(
        `Archetype modeling published the parts: ${count} buildings now use the heat pump. Stages that use the parts, such as Baseline model setup, are outdated until they run again.`,
      )
    },
  ],
}

const schemaSession: ScriptedSession = {
  id: 'schemaMatching',
  label: 'Review the schema mapping',
  prompt: 'Review the schema matching suggestions and apply the mapping.',
  description:
    'Opens Schema matching, shows a source attribute, proposes accepting the pending suggestions and reading the building value "yes" as mixed use (it waits for approval), and applies the mapping.',
  keywords: [/\bschema\b/, /\bmapping\b/, /\bunrecogni[sz]ed\b/],
  steps: [
    reason(
      'Schema matching maps the captured footprint attributes to the model fields. Suggestions are only used once accepted, and the mapping reaches the buildings when the stage runs.',
    ),
    ensure([STAGE_IDS.enrichment], 'Capturing and enriching footprints'),
    tool(
      'Open Schema matching',
      layoutCall({ type: 'layout.openPage', input: { page: 'schema' } }),
    ),
    tool(
      'Show the values of "building"',
      viewCall({ type: 'schema.inspectSource', input: { source: 'building' } }),
    ),
    (context) => {
      const state = context.state()
      const review = reviewSchema(state)
      const pending = Object.entries(state.schemaMatching.suggestions)
      const yes = review.checks.use?.unrecognised.find(
        (entry) => entry.value === 'yes',
      )
      // "yes" is generic: reading it as mixed use changes every building
      // carrying it that is not mixed already, and says so.
      const yesSource = state.schemaMatching.mapping.use
      const changes = yesSource
        ? review.collection.records.filter(
            (record) =>
              record.tags?.[yesSource] === 'yes' &&
              state.buildings[record.buildingId]?.use !== 'mixed',
          ).length
        : 0
      const calls: TitledCall[] = []
      if (pending.length > 0) {
        calls.push({
          title: `Accept ${pending.length} suggestion${pending.length === 1 ? '' : 's'}`,
          call: command({
            type: 'schema.reviewSuggestions',
            input: { targets: [], decision: 'accept' },
          }),
        })
      }
      if (yes) {
        calls.push({
          title: 'Read the building value "yes" as mixed use',
          call: command({
            type: 'schema.mapValue',
            input: { target: 'use', value: 'yes', to: 'mixed' },
          }),
        })
      }
      if (calls.length === 0) {
        return say(
          'There are no suggestions to review and every use value is recognised, so the mapping needs no change.',
        )
      }
      return [
        reason(
          `${pending.map(([target, suggestion]) => `${target} from "${suggestion.source}"`).join(', ') || 'No suggestions'} ${pending.length === 1 ? 'is' : 'are'} pending.${yes ? ` ${yes.count} buildings carry the generic building value "yes", which is not a recognised use, so they keep their enriched use for now. Reading "yes" as mixed use makes all of them mixed: ${changes} of them have another use today (mostly retail), so their archetypes and results will change.` : ''}`,
        ),
        propose(
          'Update the attribute mapping',
          `${calls.map((call) => call.title).join(', then ')}.${yes ? ` ${changes} buildings change to mixed use when the mapping is applied.` : ''} Schema matching and every later stage become outdated until Schema matching runs again.`,
          calls,
        ),
      ]
    },
    ensure([STAGE_IDS.schema], 'Applying the mapping', 'current'),
    (context) => {
      const published = context.state().schemaMatching.published
      if (!published) return say('The mapping has not been applied.')
      return [
        say(
          `Schema matching applied the mapping (run ${published.runId}) with ${published.warnings.length} warnings; each building's Properties show where its values come from, and the original attributes are kept.`,
        ),
        reference('Show the mapping on the Schema matching page', {
          type: 'page',
          page: 'schema',
        }),
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
          `Results now show ${top[0]} with ${Math.round(top[1]).toLocaleString('en-US')} kWh a year and its typical weekday from its space-loads schedule. Export CSV on that page downloads the published baseline with its run named in the header.`,
        ),
      ]
    },
  ],
}

/**
 * The building whose zones show the zoning best: the largest footprint that
 * kept its zoning (no fallback), else the largest with zones at all.
 */
function showcaseZoning(state: WorkbenchState): BuildingZoning | null {
  let best: BuildingZoning | null = null
  let bestArea = -1
  let bestKept = false
  for (const id of state.buildingIds) {
    const zoning = buildingZoning(state, id)
    const area = state.buildings[id]?.footprintAreaM2 ?? 0
    if (!zoning) continue
    const kept = zoning.fallback === null
    if ((kept && !bestKept) || (kept === bestKept && area > bestArea)) {
      best = zoning
      bestArea = area
      bestKept = kept
    }
  }
  return best
}

/**
 * The buildings the last run zoned their own way (decision 0034), as a
 * clause after the project's zoning, or nothing when there are none.
 */
function overridesClause(state: WorkbenchState): string {
  const overrides = state.zoning.published?.overrides ?? {}
  const ids = Object.keys(overrides)
    .filter((id) => state.buildings[id])
    .sort()
  if (ids.length === 0) return ''
  const named = ids.map((id) => {
    const mode = overrides[id]
    return mode ? `${id} (${BUILDING_ZONING_LABELS[mode].toLowerCase()})` : id
  })
  return `, except ${ids.length === 1 ? 'one building' : `${ids.length} buildings`} zoned ${ids.length === 1 ? 'its' : 'their'} own way: ${named.join(', ')}`
}

/** What a building's floors and zones are, for the agent's answers. */
function describeBuildingZones(
  state: WorkbenchState,
  zoning: BuildingZoning,
): string {
  const name = state.buildings[zoning.buildingId]?.name ?? zoning.buildingId
  const cores = zoning.zones.filter((zone) => zone.kind === 'core').length
  const perimeters = zoning.zones.filter(
    (zone) => zone.kind === 'perimeter',
  ).length
  const drawn = zoning.zones.filter((zone) => zone.kind === 'drawn').length
  const parts =
    drawn > 0
      ? `${formatCount(drawn, 'drawn zone')} (synthetic outlines stored with the project)`
      : cores > 0
        ? `${formatCount(cores, 'core')} and ${formatCount(perimeters, 'perimeter zone')}, ${perimeters / Math.max(1, cores)} a floor`
        : formatCount(zoning.zones.length, 'zone')
  return `**${name}** (${zoning.buildingId}) has ${formatCount(zoning.floors.length, 'floor')} of ${zoning.floorHeightM} m (its height over its storeys) and ${formatCount(zoning.zones.length, 'zone')}, ${describeAppliedZoning(zoning).toLowerCase()}: ${parts}.${zoning.fallback ? ` ${zoning.fallback.message}` : ''}`
}

/** Fallback warnings of the last Geospatial preprocessing run, in a sentence. */
function fallbackSentence(state: WorkbenchState): string {
  const warnings = state.issues.filter(
    (issue) =>
      issue.stageId === STAGE_IDS.preprocessing &&
      ZONING_FALLBACK_CODES.some((code) =>
        issue.message.startsWith(`${code}:`),
      ),
  )
  return warnings.length === 0
    ? 'No building fell back to one zone per floor.'
    : `Some buildings fell back to one zone per floor, as the preprocessing warnings say: ${warnings.map((issue) => issue.message.split(' (')[0]).join('; ')}.`
}

const zoningSession: ScriptedSession = {
  id: 'zoning',
  label: 'Zone by perimeter and core',
  prompt:
    'Zone the buildings by perimeter and core, then show me the floors and zones of the largest building.',
  description:
    "Proposes RC's perimeter-and-core zoning with a 4.5 m perimeter (it waits for approval), reruns Geospatial preprocessing (approval), then selects the largest zoned building and shows its floor slabs and zones on the 3D map.",
  keywords: [
    /\bzon(e|es|ed|ing)\b/,
    /\bperimeter\b/,
    /\bfloors? and zones?\b/,
    /\bslabs?\b/,
  ],
  steps: [
    reason(
      "Zoning is an input of Geospatial preprocessing: changing it outdates that stage and every later one until it runs again. Floors are each building's height over its storeys; zones are display only.",
    ),
    ensure([STAGE_IDS.enrichment], 'Finding floor counts to zone'),
    (context) => {
      const zoning = context.state().zoning
      if (zoning.mode === 'perimeterCore') {
        return reason(
          `The zoning is already ${describeZoning(zoning).toLowerCase()}.`,
        )
      }
      return propose(
        'Zone by perimeter and core',
        `Set the zoning to ${describeZoning({ mode: 'perimeterCore', perimeterDepthM: DEFAULT_PERIMETER_DEPTH_M }).toLowerCase()} (RC's PerimeterCore). Geospatial preprocessing and every later stage become outdated until preprocessing runs again.`,
        [
          {
            title: 'Set the zoning to perimeter and core, 4.5 m deep',
            call: command({
              type: 'zoning.set',
              input: {
                mode: 'perimeterCore',
                perimeterDepthM: DEFAULT_PERIMETER_DEPTH_M,
              },
            }),
          },
        ],
      )
    },
    ensure([STAGE_IDS.preprocessing], 'Zoning the buildings', 'current'),
    (context) => {
      const state = context.state()
      const zoning = showcaseZoning(state)
      if (!zoning) {
        return say(
          'No building has zones yet: Geospatial preprocessing has not zoned them by the setting.',
        )
      }
      return [
        tool(
          `Select ${zoning.buildingId}, the largest zoned building`,
          command({
            type: 'selection.set',
            input: { entityType: 'building', ids: [zoning.buildingId] },
          }),
        ),
        tool(
          'Open the Map',
          layoutCall({ type: 'layout.openPage', input: { page: 'map' } }),
        ),
        tool(
          'Show the map in 3D',
          viewCall({ type: 'map.set3d', input: { enabled: true } }),
        ),
        tool(
          'Zoom the map to it',
          viewCall({ type: 'map.focusSelection', input: {} }),
        ),
        say(
          `${describeBuildingZones(state, zoning)} The map draws its zones, one colour per zone with the core in grey, and every other building as floor slabs. ${fallbackSentence(state)} Choose a floor or zone in Properties, or on the Table page's Floors and Zones views, to highlight it.`,
        ),
        reference('Show its floors and zones', { type: 'inspection' }),
        reference('Show the zoning Geospatial preprocessing applied', {
          type: 'stage',
          stageId: STAGE_IDS.preprocessing,
        }),
      ]
    },
  ],
}

/** One building per mode the published overrides use, drawn zones first. */
function zoningCases(state: WorkbenchState): string[] {
  const order: BuildingZoningMode[] = [
    'drawn',
    'floors',
    'perimeterCore',
    'single',
  ]
  const overrides = state.zoning.published?.overrides ?? {}
  return order.flatMap((mode) => {
    const id = Object.keys(overrides)
      .sort()
      .find((each) => overrides[each] === mode && state.buildings[each])
    return id ? [id] : []
  })
}

/**
 * The selection levels of decision 0035, one at a time through selection.set:
 * a building, its floor 2 (the first floor above the ground, else floor 1),
 * then the first zone on that floor that is not its core.
 */
function levelSteps(
  state: WorkbenchState,
  buildingId: string | undefined,
): Step[] {
  const zoning = buildingId ? buildingZoning(state, buildingId) : null
  if (!buildingId || !zoning) return []
  const floor =
    zoning.floors.find((each) => each.number === 2) ?? zoning.floors[0]
  if (!floor) return []
  const onFloor = zoning.zones.filter(
    (zone) => zone.floor === floor.number || zone.floor === null,
  )
  const zone =
    onFloor.find((each) => each.kind !== 'core' && each.use !== 'core') ??
    onFloor[0]
  const name = state.buildings[buildingId]?.name ?? buildingId
  return [
    tool(
      `Select ${buildingId}`,
      command({
        type: 'selection.set',
        input: { entityType: 'building', ids: [buildingId] },
      }),
    ),
    tool(
      `Select floor ${floor.number} of ${buildingId}`,
      command({
        type: 'selection.set',
        input: { entityType: 'floor', ids: [floor.id] },
      }),
    ),
    ...(zone
      ? [
          tool(
            `Select ${zone.name}`,
            command({
              type: 'selection.set',
              input: { entityType: 'zone', ids: [zone.id] },
            }),
          ),
        ]
      : []),
    say(
      `Then one level at a time in **${name}**: the building with all its zones, floor ${floor.number} drawn solid with its other floors hollow around it, and ${zone ? `**${zone.name}** highlighted, the floor's other zones muted` : 'its zones'}. On the map a click goes the same way, building, then floor, then zone; Escape goes back up a level, and Page Up and Page Down move to the floor above or below.`,
    ),
  ]
}

const zoningCasesSession: ScriptedSession = {
  id: 'zoningCases',
  label: 'Zoning cases in 3D',
  prompt:
    'Show me the buildings zoned their own way in 3D, then one floor and one zone of the drawn building.',
  description:
    "Each building can override the project's zoning (decision 0034). Proposes drawn zones for a building that has drawn outlines but does not use them (it waits for approval), reruns Geospatial preprocessing if needed (approval), selects one building per zoning case and shows their zones in 3D, then goes down the selection levels of decision 0035: the drawn building, its floor 2 (the other floors hollow), and a zone on it.",
  keywords: [
    /\bdrawn zones?\b/,
    /\bzoning cases?\b/,
    /\bper[- ]building zoning\b/,
    /\bzoned (its|their) own way\b/,
    /\bhollow\b/,
  ],
  steps: [
    reason(
      "A building's zoning override is an input of Geospatial preprocessing, like the project's zoning: changing it outdates that stage and every later one until it runs again. Drawn zones are synthetic outlines stored with the project; zones are display only.",
    ),
    ensure([STAGE_IDS.enrichment], 'Finding floor counts to zone'),
    (context) => {
      const state = context.state()
      const candidate = Object.keys(state.zoning.drawn)
        .sort()
        .find(
          (id) => state.buildings[id] && state.zoning.overrides[id] !== 'drawn',
        )
      if (!candidate) {
        return reason(
          'Every building with drawn outlines is already zoned by them.',
        )
      }
      const name = state.buildings[candidate]?.name ?? candidate
      return propose(
        `Zone ${candidate} by its drawn zones`,
        `Set ${name} (${candidate}) to ${BUILDING_ZONING_LABELS.drawn.toLowerCase()}, overriding the project's ${describeZoning(state.zoning).toLowerCase()}. Geospatial preprocessing and every later stage become outdated until preprocessing runs again.`,
        [
          {
            title: `Zone ${candidate} by its drawn zones`,
            call: command({
              type: 'zoning.setBuilding',
              input: { buildingId: candidate, mode: 'drawn' },
            }),
          },
        ],
      )
    },
    ensure([STAGE_IDS.preprocessing], 'Zoning the buildings', 'current'),
    (context) => {
      const state = context.state()
      const ids = zoningCases(state)
      if (ids.length === 0) {
        return say(
          "No building is zoned its own way yet. Choose a building's zoning in its Properties, then run Geospatial preprocessing.",
        )
      }
      const layer = zonesLayer(context.view().map.layers)
      const zonings = ids.flatMap((id) => {
        const zoning = buildingZoning(state, id)
        return zoning ? [zoning] : []
      })
      return [
        tool(
          `Select ${ids.join(', ')}`,
          command({
            type: 'selection.set',
            input: { entityType: 'building', ids },
          }),
        ),
        tool(
          'Open the Map',
          layoutCall({ type: 'layout.openPage', input: { page: 'map' } }),
        ),
        tool(
          'Show the map in 3D',
          viewCall({ type: 'map.set3d', input: { enabled: true } }),
        ),
        tool(
          'Zoom the map to them',
          viewCall({ type: 'map.focusSelection', input: {} }),
        ),
        say(
          `${zonings.map((zoning) => describeBuildingZones(state, zoning)).join(' ')} ${layer ? 'Lines on the zone edges let neighbouring zones read apart without colour.' : "No shown building layer extrudes, so the zones are drawn flat; turn on Extrude to height in the map's Properties."} ${fallbackSentence(state)}`,
        ),
        ...levelSteps(state, ids[0]),
        reference('Show its floors and zones', { type: 'inspection' }),
      ]
    },
  ],
}

export const SESSIONS: ScriptedSession[] = [
  layoutSession,
  representationSession,
  modelChangeSession,
  calibrationSession,
  rulesSession,
  scenarioRulesSession,
  schemaSession,
  zoningSession,
  zoningCasesSession,
  restoreSession,
]

// Restoring is checked first: its phrases also mention the layout.
const MATCH_ORDER = [
  restoreSession,
  calibrationSession,
  zoningCasesSession,
  zoningSession,
  layoutSession,
  representationSession,
  scenarioRulesSession,
  rulesSession,
  schemaSession,
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

// The viewer page's agent (decision 0032, stage 5) answers questions,
// interprets the handed-over results, and changes views; it never offers a
// model change, so its sessions call no server command.

const RESULT_STAGES = [
  STAGE_IDS.baseline,
  STAGE_IDS.scenarioModeling,
  STAGE_IDS.gridModeling,
]

const viewerResultsSession: ScriptedSession = {
  id: 'viewerResults',
  label: 'Explain the published results',
  prompt:
    'Which building uses the most energy, and how current are these results?',
  description:
    "Reads the view's results and their stage states, then shows the highest-demand building through view operations and the shared selection.",
  keywords: [
    /\bmost energy\b/,
    /\bhighest\b/,
    /\bexplain/,
    /\bresults?\b/,
    /\bcurrent\b/,
    /\binterpret/,
  ],
  steps: [
    reason(
      'The view holds the results as they were published when it was saved. I read them and their stage states; nothing in the view changes.',
    ),
    (context) => {
      const state = context.state()
      const states = context.stageStates()
      const baseline = state.results.baseline
      if (!baseline) {
        return say(
          'This view has no published results to explain: Baseline model setup had not published a baseline when it was saved. Ask the modeller for a new view once the baseline has run.',
        )
      }
      const outdated = RESULT_STAGES.filter((id) => states[id] === 'stale').map(
        (id) => state.workflow.stages[id]?.name ?? id,
      )
      const top = Object.entries(baseline.byBuildingKwh).sort(
        ([a, x], [b, y]) => y - x || (a < b ? -1 : 1),
      )[0]
      const scenarios = Object.values(state.results.scenarios)
      const currency =
        outdated.length > 0
          ? `They are **outdated** relative to the model: ${outdated.join(', ')} changed after the last run, so the numbers are from before those changes.`
          : 'They were current when the view was saved.'
      const steps: Step[] = [
        say(
          `The published baseline totals **${formatEnergy(baseline.totalKwh)}** a year with a peak of ${Math.round(baseline.peakKw).toLocaleString('en-US')} kW, from run ${baseline.runId}.${scenarios.length > 0 ? ` ${scenarios.length} scenario result${scenarios.length === 1 ? ' is' : 's are'} published beside it.` : ''} ${currency} All numbers are synthetic.`,
        ),
        tool(
          'Open Results',
          layoutCall({ type: 'layout.openPage', input: { page: 'results' } }),
        ),
        tool(
          'Show the published baseline',
          viewCall({ type: 'results.select', input: { resultId: 'baseline' } }),
        ),
      ]
      if (!top) return steps
      return [
        ...steps,
        tool(
          `Drill into ${top[0]}, the highest-demand building`,
          viewCall({
            type: 'results.showBuilding',
            input: { buildingId: top[0] },
          }),
        ),
        tool(
          `Select ${top[0]} on the map and table`,
          command({
            type: 'selection.set',
            input: { entityType: 'building', ids: [top[0]] },
          }),
        ),
        say(
          `**${top[0]}** uses the most: ${formatEnergy(top[1])} a year. Results now show it, and the map and table highlight it because the selection is shared. Export CSV on the Results page downloads the published baseline with its run named in the header.`,
        ),
        reference('Show its properties', { type: 'inspection' }),
      ]
    },
  ],
}

const viewerRestoreSession: ScriptedSession = {
  id: 'viewerRestore',
  label: "Reset to the view's layout",
  prompt: "Reset to the view's layout.",
  description:
    'Returns the panels and views to the layout the view was saved with.',
  keywords: [
    /\brestore\b/,
    /\breset\b/,
    /\bhanded.over\b/,
    /\bdefault layout\b/,
  ],
  steps: [
    reason(
      "Resetting changes only how this viewer arranges the view; the view's layouts and the model stay as they are.",
    ),
    tool(
      "Reset to the view's layout",
      layoutsCall({ type: 'layouts.resetToHandover', input: {} }),
    ),
    say(
      "The panels and views are back as the view was saved. The view's layouts are still in the Layouts panel.",
    ),
  ],
}

const viewerZonesSession: ScriptedSession = {
  id: 'viewerZones',
  label: 'Floors and zones of a building',
  prompt: 'Show me the floors and zones of a building.',
  description:
    'Reads the handed-over zoning, selects a building zoned its own way (else the largest zoned building), and shows its floor slabs and zones on the 3D map through view operations.',
  keywords: [/\bzones?\b/, /\bfloors and zones\b/, /\bslabs?\b/],
  steps: [
    reason(
      "The package holds the zoning the last Geospatial preprocessing run applied; floors and zones are derived from it and every building's height and storeys. Nothing in the package changes.",
    ),
    (context) => {
      const state = context.state()
      // A building zoned its own way shows more than one zone per building.
      const [overridden] = zoningCases(state)
      const own = overridden ? buildingZoning(state, overridden) : null
      const zoning = own ?? showcaseZoning(state)
      if (!zoning) {
        return say(
          'This package has no zones to show: Geospatial preprocessing had not zoned the buildings by a zoning setting when it was handed over. Ask the modeller for a new handover.',
        )
      }
      const published = state.zoning.published
      return [
        tool(
          `Select ${zoning.buildingId}, ${own ? 'a building zoned its own way' : 'the largest zoned building'}`,
          command({
            type: 'selection.set',
            input: { entityType: 'building', ids: [zoning.buildingId] },
          }),
        ),
        tool(
          'Open the Map',
          layoutCall({ type: 'layout.openPage', input: { page: 'map' } }),
        ),
        tool(
          'Show the map in 3D',
          viewCall({ type: 'map.set3d', input: { enabled: true } }),
        ),
        tool(
          'Zoom the map to it',
          viewCall({ type: 'map.focusSelection', input: {} }),
        ),
        say(
          `The buildings were zoned ${published ? describeZoning(published).toLowerCase() : 'by a setting'} when the project was handed over${overridesClause(state)}. ${describeBuildingZones(state, zoning)} ${fallbackSentence(state)} Zones are display only, and per-zone results are a synthetic split of the building's demand by floor area.`,
        ),
        reference('Show its floors and zones', { type: 'inspection' }),
        reference('Show the zoning Geospatial preprocessing applied', {
          type: 'stage',
          stageId: STAGE_IDS.preprocessing,
        }),
      ]
    },
  ],
}

/** The viewer's sessions: questions, interpretation, and view changes only. */
export const VIEWER_SESSIONS: ScriptedSession[] = [
  viewerResultsSession,
  layoutSession,
  viewerZonesSession,
  viewerRestoreSession,
]

const VIEWER_MATCH_ORDER = [
  viewerRestoreSession,
  layoutSession,
  viewerZonesSession,
  viewerResultsSession,
]

export function matchViewerSession(text: string): ScriptedSession | null {
  // A model change is refused even when it names a session's subject, as in
  // "reset the baseline results" or "remove the zones from building b-1".
  if (asksForModelChange(text)) return null
  const normalized = text.toLowerCase()
  return (
    VIEWER_MATCH_ORDER.find((session) =>
      session.keywords.some((keyword) => keyword.test(normalized)),
    ) ?? null
  )
}

/** Work only the modeller can start. */
const MODEL_ACTIONS =
  /\b(rerun|re-run|adopt|calibrate|recalibrate|retry|import|fuse)\b/
const CHANGE_VERBS =
  /\b(run|change|edit|modify|add|create|delete|remove|set|save|apply|assign|update|fit|cancel|reset|restore|clear|rename|duplicate|replace)\b/
/** What the model is made of, as people name it. */
const MODEL_OBJECTS =
  /\b(stages?|baseline|measures?|scenarios?|archetypes?|parts?|rules?|schedules?|adoption|floors?|buildings?|datasets?|mapping|model|project|calibration|jobs?|zoning|zones?)\b/
/** What a viewer may change: how things are shown. */
const VIEW_WORDS =
  /\b(layers?|map|colou?rs?|styles?|layouts?|table|columns?|filters?|sort|season|camera|zoom|charts?|view|panels?|light|lighting|terrain|3d|basemap|search)\b/

/**
 * Whether a message asks the viewer for a model change (decision 0032, stage
 * 5): work only the modeller starts, or a change verb on a model object that
 * is not about how things are shown. A keyword heuristic of the scripted
 * agent; "add a layer" or "save my layout" are view changes and pass.
 */
export function asksForModelChange(text: string): boolean {
  const normalized = text.toLowerCase()
  if (MODEL_ACTIONS.test(normalized)) return true
  return (
    CHANGE_VERBS.test(normalized) &&
    MODEL_OBJECTS.test(normalized) &&
    !VIEW_WORDS.test(normalized)
  )
}

export const VIEW_ONLY_ANSWER =
  "This is a **view**, so I cannot change the model, run or cancel stages, or change the view's layouts; the server refuses model changes from the viewer. I can explain the published results, select and point out buildings, change how the map, table, dashboard, and results are shown, apply the view's layouts in the Layouts panel, and reset to the view's layout. For model changes, ask the modeller for a new view."

/** The viewer's answer when no prepared session matches a message. */
export const VIEWER_UNMATCHED_ANSWER =
  "I am a **scripted agent** in this prototype and can only run the prepared sessions offered below, so I did not act on this message. You can change views yourself: map layers, colours, seasons, and lighting in the map's Properties, table columns and filters on the Table page, and the view's layouts in the Layouts panel (View > Layouts), with Reset to the view's layout to go back."
