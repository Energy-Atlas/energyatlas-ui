import { useMemo, useState } from 'react'
import { CONDITION_FIELDS } from '../../domain/rules/conditions.ts'
import {
  KIND_LABELS,
  kindNoun,
  previewScenarioRules,
  scenarioRules,
} from '../../domain/scenarios/rules.ts'
import type {
  MeasureKind,
  RuleCondition,
  RuleLogic,
  Scenario,
  ScenarioRule,
} from '../../domain/types.ts'
import { MEASURE_KINDS } from '../../domain/types.ts'
import {
  useClientSnapshot,
  useServices,
  useWorkbenchSnapshot,
} from '../WorkbenchContext.tsx'
import { splitIssues } from '../commandErrors.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { ConditionBuilder } from '../components/ConditionBuilder.tsx'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { waitingReason } from '../service/usePendingReason.ts'
import { PropertyForm, SelectProperty, TextProperty } from './PropertyForm.tsx'
import { useEdits } from './useEdits.ts'

type RuleFields = {
  name: string
  logic: RuleLogic
  conditions: RuleCondition[]
} & Record<MeasureKind, string>

function toFields(rule: ScenarioRule | null): RuleFields {
  return {
    name: rule?.name ?? '',
    logic: rule?.logic ?? 'all',
    conditions: rule?.conditions.map((condition) => ({ ...condition })) ?? [],
    envelope: rule?.measures.envelope ?? '',
    heating: rule?.measures.heating ?? '',
    lighting: rule?.measures.lighting ?? '',
    pv: rule?.measures.pv ?? '',
  }
}

/** Paths the form shows on a field; other messages go to the whole form. */
function shownPath(path: string): boolean {
  return (
    path === 'name' ||
    path === 'logic' ||
    path === 'measures' ||
    path.startsWith('measures.') ||
    path.startsWith('conditions')
  )
}

/**
 * A scenario rule in Properties (decision 0032, stage 3), on the same
 * condition builder as archetype rules: its name, its conditions, and the
 * measure of each category it assigns. A saved rule shows what it takes now
 * and can select the buildings it matches. New rules go to the top of their
 * scenario; saving outdates Scenario definitions and results.
 */
export function ScenarioRuleProperties({
  scenario,
  rule,
  onCreated,
  onCancelCreate,
}: {
  scenario: Scenario
  /** Null creates a new rule in the scenario. */
  rule: ScenarioRule | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const saved = useMemo(() => toFields(rule), [rule])
  const edits = useEdits(
    saved,
    rule ? `scenarioRule:${rule.id}` : `new:scenarioRule:${scenario.id}`,
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const draft = edits.value
  const creating = rule === null
  const highlight = (field: keyof RuleFields) =>
    !creating && edits.isEdited(field)
  const clear = (...paths: string[]) =>
    setErrors((current) => {
      const next = { ...current }
      let changed = false
      for (const key of Object.keys(next)) {
        if (paths.some((path) => key === path || key.startsWith(`${path}.`))) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : current
    })

  const preview = useMemo(
    () =>
      rule
        ? previewScenarioRules(state, {
            id: scenario.id,
            rules: scenarioRules(state, scenario),
            adoptionPercent: scenario.adoptionPercent,
            adoptionSeed: scenario.adoptionSeed,
          })
        : null,
    [rule, scenario, state],
  )
  const own = preview?.rules.find((each) => each.ruleId === rule?.id)
  const warnings =
    preview?.warnings.filter((warning) => warning.ruleId === rule?.id) ?? []
  const measuresOf = (kind: MeasureKind) =>
    Object.values(state.measures).filter((measure) => measure.kind === kind)

  const submit = () => {
    const before = new Set(Object.keys(workbench.getState().scenarioRules))
    void client
      .execute({
        type: 'scenarioRule.save',
        input: {
          name: draft.name,
          scenarioId: scenario.id,
          ...(rule ? { id: rule.id, enabled: rule.enabled } : {}),
          logic: draft.logic,
          conditions: draft.conditions,
          measures: Object.fromEntries(
            MEASURE_KINDS.map((kind) => [kind, draft[kind] || null]),
          ) as Record<MeasureKind, string | null>,
        },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setError(null)
          edits.reset()
          if (creating) {
            // The new rule is the one id the project did not have before.
            const created = Object.keys(
              workbench.getState().scenarioRules,
            ).find((ruleId) => !before.has(ruleId))
            if (created) onCreated(created)
          }
          return
        }
        const { fieldErrors, general } = splitIssues(result.outcome.issues)
        const shown = Object.fromEntries(
          Object.entries(fieldErrors).filter(([path]) => shownPath(path)),
        )
        const other = Object.entries(fieldErrors)
          .filter(([path]) => !shownPath(path))
          .map(([, message]) => message)
        setErrors(shown)
        setError([general, ...other].filter(Boolean).join(' ') || null)
      })
  }

  const position = rule ? scenario.ruleIds.indexOf(rule.id) + 1 : 1
  const most = own
    ? MEASURE_KINDS.reduce((max, kind) => Math.max(max, own.takes[kind]), 0)
    : 0
  return (
    <PropertyForm
      eyebrow={creating ? 'New scenario rule' : 'Scenario rule'}
      title={rule ? rule.name : 'New rule'}
      provenance={
        rule
          ? `In "${scenario.name}"; tried ${position} of ${scenario.ruleIds.length}${rule.enabled ? '' : ', off'}.`
          : `A new rule goes to the top of "${scenario.name}", so it is tried first.`
      }
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={waitingReason(
        pending,
        'scenarioRule.save',
        'the rule is being saved',
      )}
      submitLabel={creating ? 'Create rule' : 'Save rule'}
      onSubmit={submit}
      onCancel={() => {
        if (creating) {
          onCancelCreate()
          return
        }
        edits.reset()
        setErrors({})
        setError(null)
      }}
    >
      <TextProperty
        label="Rule name"
        value={draft.name}
        edited={highlight('name')}
        error={errors.name}
        onChange={(value) => {
          edits.set('name', value)
          clear('name')
        }}
      />
      <ConditionBuilder
        fields={CONDITION_FIELDS}
        logic={draft.logic}
        onLogicChange={(logic) => {
          edits.set('logic', logic)
          clear('logic')
        }}
        conditions={draft.conditions}
        onChange={(conditions) => {
          edits.set('conditions', conditions)
          clear('conditions')
        }}
        errors={errors}
        edited={highlight('conditions') || highlight('logic')}
      />
      {MEASURE_KINDS.map((kind) => {
        const options = measuresOf(kind)
        return (
          <SelectProperty
            key={kind}
            label={`${KIND_LABELS[kind]} measure`}
            value={draft[kind]}
            edited={highlight(kind)}
            error={
              errors[`measures.${kind}`] ??
              (kind === 'envelope' ? errors.measures : undefined)
            }
            options={[
              {
                value: '',
                label:
                  options.length === 0
                    ? `Not set (no ${kindNoun(kind)} measure yet)`
                    : 'Not set (later rules decide)',
              },
              ...options.map((measure) => ({
                value: measure.id,
                label: measure.name,
              })),
            ]}
            onChange={(value) => {
              edits.set(kind, value)
              clear(`measures.${kind}`, 'measures')
            }}
          />
        )
      })}
      {rule && preview && own ? (
        <section aria-label="What the rule takes">
          <PropertyList
            items={[
              {
                label: 'Matches',
                value: rule.enabled
                  ? `${own.matched} of ${preview.buildings} buildings`
                  : 'Nothing: the rule is off',
              },
              ...MEASURE_KINDS.filter(
                (kind) => rule.measures[kind] !== null,
              ).map((kind) => ({
                label: `Takes ${kindNoun(kind)}`,
                value: `${own.takes[kind]} buildings`,
              })),
            ]}
          />
          {warnings.map((warning) => (
            <InlineAlert key={warning.code} tone="warning">
              {warning.message}
            </InlineAlert>
          ))}
          {rule.enabled && own.matched > most ? (
            <p>
              Rules above it already set some of its measures for{' '}
              {own.matched - most} of the buildings it matches.
            </p>
          ) : null}
          <ActionButton
            label={`Select the ${own.matched} buildings ${rule.name} matches`}
            disabledReason={
              own.matched === 0 ? 'The rule matches no building.' : null
            }
            onPress={() =>
              workbench.execute({
                type: 'selection.set',
                input: { entityType: 'building', ids: own.buildingIds },
              })
            }
          >
            Select matched buildings
          </ActionButton>
        </section>
      ) : null}
    </PropertyForm>
  )
}
