import { useMemo, useState } from 'react'
import { previewAssignment } from '../../domain/archetypes/assignment.ts'
import { PART_LABELS } from '../../domain/archetypes/parts.ts'
import { CONDITION_FIELDS } from '../../domain/rules/conditions.ts'
import type {
  AssignmentRule,
  PartKind,
  RuleCondition,
  RuleLogic,
} from '../../domain/types.ts'
import { PART_KINDS } from '../../domain/types.ts'
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
} & Record<PartKind, string>

function toFields(rule: AssignmentRule | null): RuleFields {
  return {
    name: rule?.name ?? '',
    logic: rule?.logic ?? 'all',
    conditions: rule?.conditions.map((condition) => ({ ...condition })) ?? [],
    construction: rule?.parts.construction ?? '',
    systems: rule?.parts.systems ?? '',
    spaceLoads: rule?.parts.spaceLoads ?? '',
    externalLoads: rule?.parts.externalLoads ?? '',
  }
}

/** Paths the form shows on a field; other messages go to the whole form. */
function shownPath(path: string): boolean {
  return (
    path === 'name' ||
    path === 'logic' ||
    path === 'parts' ||
    path.startsWith('parts.') ||
    path.startsWith('conditions')
  )
}

/**
 * An archetype assignment rule in Properties (decision 0032): its name, its
 * conditions, and the part of each kind it sets. A saved rule shows what it
 * takes now and can select the buildings it matches. New rules go to the
 * top of the list; saving outdates Archetype modeling.
 */
export function RuleProperties({
  rule,
  onCreated,
  onCancelCreate,
}: {
  /** Null creates a new rule. */
  rule: AssignmentRule | null
  onCreated: (id: string) => void
  onCancelCreate: () => void
}) {
  const { client, workbench } = useServices()
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const saved = useMemo(() => toFields(rule), [rule])
  const edits = useEdits(saved, rule ? `rule:${rule.id}` : 'new:rule')
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
    () => (rule ? previewAssignment(state) : null),
    [rule, state],
  )
  const own = preview?.rules.find((each) => each.ruleId === rule?.id)
  const warnings =
    preview?.warnings.filter((warning) => warning.ruleId === rule?.id) ?? []
  const partsByKind = (kind: PartKind) =>
    Object.values(state.parts).filter((part) => part.kind === kind)

  const submit = () => {
    const before = new Set(workbench.getState().ruleIds)
    void client
      .execute({
        type: 'rule.save',
        input: {
          name: draft.name,
          // Left out, the rule keeps its switch, even one still being changed.
          ...(rule ? { id: rule.id } : {}),
          logic: draft.logic,
          conditions: draft.conditions,
          parts: Object.fromEntries(
            PART_KINDS.map((kind) => [kind, draft[kind] || null]),
          ) as Record<PartKind, string | null>,
        },
      })
      .then((result) => {
        if (result.outcome.status === 'applied') {
          setErrors({})
          setError(null)
          edits.reset()
          if (creating) {
            // The new rule is the one id the list did not have before.
            const created = workbench
              .getState()
              .ruleIds.find((ruleId) => !before.has(ruleId))
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

  const position = rule ? state.ruleIds.indexOf(rule.id) + 1 : 1
  return (
    <PropertyForm
      eyebrow={creating ? 'New rule' : 'Assignment rule'}
      title={rule ? rule.name : 'New rule'}
      provenance={
        rule
          ? `${rule.origin === 'default' ? 'Generated from an archetype' : 'Written in this project'}; tried ${position} of ${state.ruleIds.length}${rule.enabled ? '' : ', off'}.`
          : 'A new rule goes to the top of the list, so it is tried first.'
      }
      creating={creating}
      editedCount={edits.editedCount}
      error={error}
      waiting={waitingReason(pending, 'rule.save', 'the rule is being saved')}
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
      {PART_KINDS.map((kind) => (
        <SelectProperty
          key={kind}
          label={`${PART_LABELS[kind]} part`}
          value={draft[kind]}
          edited={highlight(kind)}
          error={
            errors[`parts.${kind}`] ??
            (kind === 'construction' ? errors.parts : undefined)
          }
          options={[
            { value: '', label: 'Not set (later rules decide)' },
            ...partsByKind(kind).map((part) => ({
              value: part.id,
              label: part.name,
            })),
          ]}
          onChange={(value) => {
            edits.set(kind, value)
            clear(`parts.${kind}`, 'parts')
          }}
        />
      ))}
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
              ...PART_KINDS.filter((kind) => rule.parts[kind] !== null).map(
                (kind) => ({
                  label: `Takes ${PART_LABELS[kind].toLowerCase()}`,
                  value: `${own.takes[kind]} buildings`,
                }),
              ),
            ]}
          />
          {warnings.map((warning) => (
            <InlineAlert key={warning.code} tone="warning">
              {warning.message}
            </InlineAlert>
          ))}
          {rule.enabled &&
          own.matched > 0 &&
          own.matched >
            PART_KINDS.reduce(
              (max, kind) => Math.max(max, own.takes[kind]),
              0,
            ) ? (
            <p>
              Rules above it already set some of its parts for{' '}
              {own.matched -
                PART_KINDS.reduce(
                  (max, kind) => Math.max(max, own.takes[kind]),
                  0,
                )}{' '}
              of the buildings it matches, or they have manual parts.
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
