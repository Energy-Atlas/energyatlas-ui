import { Info, TriangleAlert, X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import {
  ARCHETYPE_LIBRARY,
  SCHEDULE_LIBRARY,
} from '../../domain/archetypes/library.ts'
import { MEASURE_LIBRARY } from '../../domain/scenarios/library.ts'
import type { SelectableEntity } from '../../domain/types.ts'
import { useServices, useWorkbenchSnapshot } from '../WorkbenchContext.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { CapabilityBadge } from '../components/CapabilityBadge.tsx'
import { PropertyList } from '../components/PropertyList.tsx'
import { ArchetypeProperties } from '../properties/ArchetypeProperties.tsx'
import { AssetProperties } from '../properties/AssetProperties.tsx'
import { MeasureProperties } from '../properties/MeasureProperties.tsx'
import { ScenarioProperties } from '../properties/ScenarioProperties.tsx'
import { ScheduleProperties } from '../properties/ScheduleProperties.tsx'
import { StageProperties } from '../properties/StageProperties.tsx'
import componentStyles from '../components/components.module.css'
import { cx } from '../cx.ts'
import { shownEdits } from '../properties/useEdits.ts'
import { DialogFrame } from '../shell/HelpDialogs.tsx'
import shellStyles from '../shell/shell.module.css'
import { MapProperties } from './MapProperties.tsx'
import styles from './inspection.module.css'
import {
  buildInspection,
  type Fact,
  type LinkedEntity,
  type MultipleInspection,
  type SingleInspection,
} from './inspection.ts'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h4 id={headingId}>{title}</h4>
      {children}
    </section>
  )
}

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <PropertyList
      items={facts.map((fact) => ({ label: fact.label, value: fact.value }))}
    />
  )
}

function EntityLinks({
  entities,
  more,
  emptyText,
  onInspect,
}: {
  entities: LinkedEntity[]
  more: number
  emptyText: string
  onInspect: (entity: LinkedEntity) => void
}) {
  if (entities.length === 0) {
    return <p className={styles.muted}>{emptyText}</p>
  }
  return (
    <>
      <ul className={styles.list}>
        {entities.map((entity) => (
          <li key={`${entity.entityType}:${entity.id}`}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onInspect(entity)}
            >
              {entity.label}
            </button>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className={styles.muted}>and {more.toLocaleString('en-US')} more</p>
      ) : null}
    </>
  )
}

function SingleView({
  inspection,
  onInspect,
}: {
  inspection: SingleInspection
  onInspect: (entity: LinkedEntity) => void
}) {
  return (
    <>
      <Section title="Attributes">
        <Facts facts={inspection.properties} />
      </Section>
      <Section title="Results">
        {inspection.results.length > 0 ? (
          <Facts facts={inspection.results} />
        ) : (
          <p className={styles.muted}>{inspection.resultsHint}</p>
        )}
      </Section>
      <Section title="Warnings">
        {inspection.warnings.length === 0 ? (
          <p className={styles.muted}>No warnings.</p>
        ) : (
          <ul className={styles.list}>
            {inspection.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`} className={styles.warning}>
                <TriangleAlert
                  size={14}
                  aria-hidden="true"
                  className={styles.icon}
                />
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Linked objects">
        <EntityLinks
          entities={inspection.linked}
          more={inspection.linkedMore}
          emptyText="No linked objects."
          onInspect={onInspect}
        />
      </Section>
      <Section title="Provenance">
        <p className={styles.provenanceNote}>
          <CapabilityBadge id="workflow.stageRuns" />
        </p>
        <ul className={styles.list}>
          {inspection.provenance.map((line) => (
            <li key={line} className={styles.muted}>
              {line}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function MultipleView({
  inspection,
  onInspect,
}: {
  inspection: MultipleInspection
  onInspect: (entity: LinkedEntity) => void
}) {
  return (
    <>
      <Section title="Summary">
        <Facts facts={inspection.summary} />
      </Section>
      <Section title="Selected">
        <EntityLinks
          entities={inspection.items}
          more={inspection.itemsMore}
          emptyText="Nothing selected."
          onInspect={onInspect}
        />
      </Section>
    </>
  )
}

/**
 * A definition chosen for editing, or one being created (decision 0028).
 * Returns null when the selection is not a definition.
 */
function DefinitionProperties() {
  const { workbench, properties } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const creating = useStore(properties.store, (snapshot) => snapshot.creating)
  const select = (entityType: SelectableEntity) => (id: string) =>
    workbench.execute({
      type: 'selection.set',
      input: { entityType, ids: [id] },
    })
  const cancel = () => properties.cancelCreate()
  const { entityType, ids } = state.selection
  const id = ids.length === 1 ? ids[0] : undefined
  // A key per definition gives each its own unsaved edits.
  if (creating === 'archetype' || (entityType === 'archetype' && id)) {
    const archetype = id && !creating ? (state.archetypes[id] ?? null) : null
    return (
      <ArchetypeProperties
        key={archetype?.id ?? 'new'}
        archetype={archetype}
        onCreated={select('archetype')}
        onCancelCreate={cancel}
      />
    )
  }
  if (creating === 'schedule' || (entityType === 'schedule' && id)) {
    const schedule = id && !creating ? (state.schedules[id] ?? null) : null
    return (
      <ScheduleProperties
        key={schedule?.id ?? 'new'}
        schedule={schedule}
        onCreated={select('schedule')}
        onCancelCreate={cancel}
      />
    )
  }
  if (creating === 'measure' || (entityType === 'measure' && id)) {
    const measure = id && !creating ? (state.measures[id] ?? null) : null
    return (
      <MeasureProperties
        key={measure?.id ?? 'new'}
        measure={measure}
        onCreated={select('measure')}
        onCancelCreate={cancel}
      />
    )
  }
  if (creating === 'scenario' || (entityType === 'scenario' && id)) {
    const scenario = id && !creating ? (state.scenarios[id] ?? null) : null
    return (
      <ScenarioProperties
        key={scenario?.id ?? 'new'}
        scenario={scenario}
        onCreated={select('scenario')}
        onCancelCreate={cancel}
      />
    )
  }
  if (entityType === 'asset' && id) {
    const asset = state.assets[id]
    return asset ? <AssetProperties asset={asset} /> : null
  }
  if (entityType === 'stage' && id) {
    return <StageProperties stageId={id} />
  }
  // Library entries are shown read-only, with Add to project where the
  // library offers it (decision 0028).
  if (entityType === 'libraryArchetype' && id) {
    const entry = ARCHETYPE_LIBRARY.find((item) => item.id === id)
    return entry ? (
      <ArchetypeProperties
        key={`library:${entry.id}`}
        archetype={entry}
        library
        onCreated={select('archetype')}
        onCancelCreate={cancel}
      />
    ) : null
  }
  if (entityType === 'librarySchedule' && id) {
    const entry = SCHEDULE_LIBRARY.find((item) => item.id === id)
    return entry ? (
      <ScheduleProperties
        key={`library:${entry.id}`}
        schedule={entry}
        library
        onCreated={select('schedule')}
        onCancelCreate={cancel}
      />
    ) : null
  }
  if (entityType === 'libraryMeasure' && id) {
    const entry = MEASURE_LIBRARY.find((item) => item.libraryId === id)
    return entry ? (
      <MeasureProperties
        key={`library:${entry.libraryId}`}
        measure={{
          id: entry.libraryId,
          name: entry.name,
          kind: entry.kind,
          savingsPercent: entry.savingsPercent,
          appliesTo: entry.appliesTo,
          source: { kind: 'library', libraryId: entry.libraryId },
        }}
        library={entry}
        onCreated={select('measure')}
        onCancelCreate={cancel}
      />
    ) : null
  }
  return null
}

/**
 * The Properties panel (decision 0028, formerly Inspection): the shared
 * selection's properties. Buildings and grid elements read their values,
 * results, and provenance; definitions (archetypes, schedules, measures,
 * scenarios) are edited here, and a new one is created here too. Its own
 * dockable panel since decision 0016.
 */
export function PropertiesPanel() {
  const { workbench, layout, workedSurface, properties } = useServices()
  const state = useWorkbenchSnapshot((snapshot) => snapshot.state)
  const creating = useStore(properties.store, (snapshot) => snapshot.creating)
  const inspection = useMemo(() => buildInspection(state), [state])

  const inspect = (entity: LinkedEntity) => {
    workbench.execute({
      type: 'selection.set',
      input: { entityType: entity.entityType, ids: [entity.id] },
    })
  }

  const definition = state.selection.entityType
  if (
    creating !== null ||
    (definition !== null &&
      definition !== 'building' &&
      definition !== 'gridElement')
  ) {
    return (
      // The panel scrolls itself, so it takes focus for keyboard scrolling
      // (axe scrollable-region-focusable).
      <section className={styles.panel} aria-label="Properties" tabIndex={0}>
        <CloseSelection />
        <DefinitionProperties />
      </section>
    )
  }

  const pageActions = (
    <>
      <ActionButton
        label="Open Map for the inspected selection"
        disabledReason={null}
        onPress={() => layout.openPage('map')}
      >
        Open Map
      </ActionButton>
      <ActionButton
        label="Open Table for the inspected selection"
        disabledReason={null}
        onPress={() => layout.openPage('table')}
      >
        Open Table
      </ActionButton>
    </>
  )

  // With nothing selected, Properties shows the properties of whatever the
  // user is working in (decision 0018).
  if (inspection.kind === 'empty' && workedSurface === 'map') {
    return <MapProperties />
  }

  if (inspection.kind === 'empty') {
    return (
      // The panel scrolls itself, so it takes focus for keyboard scrolling
      // (axe scrollable-region-focusable).
      <section className={styles.panel} aria-label="Properties" tabIndex={0}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            <Info size={16} aria-hidden="true" /> Nothing selected
          </p>
          <p className={styles.muted}>
            Select buildings or grid elements on the Map or Table page, an
            asset, or an archetype, schedule, measure, or scenario to see its
            properties here. Definitions are edited here too.
          </p>
          <div className={styles.actions}>{pageActions}</div>
        </div>
      </section>
    )
  }

  return (
    // The panel scrolls itself, so it takes focus for keyboard scrolling
    // (axe scrollable-region-focusable).
    <section className={styles.panel} aria-label="Properties" tabIndex={0}>
      <CloseSelection />
      <header className={styles.header}>
        <p className={styles.eyebrow}>{inspection.eyebrow}</p>
        <h3 className={styles.title}>{inspection.title}</h3>
      </header>
      {inspection.kind === 'single' ? (
        <SingleView inspection={inspection} onInspect={inspect} />
      ) : (
        <MultipleView inspection={inspection} onInspect={inspect} />
      )}
      <div className={styles.actions}>{pageActions}</div>
    </section>
  )
}

/**
 * Closes what Properties shows (decision 0028): an ? at the panel's top
 * right, in the same place for every kind of content, that clears the
 * selection or leaves a new definition. With unsaved edits it asks first.
 */
function CloseSelection() {
  const { workbench, properties } = useServices()
  const [confirming, setConfirming] = useState(false)
  const [count, setCount] = useState(0)
  const close = () => {
    properties.cancelCreate()
    if (workbench.getState().selection.entityType !== null) {
      workbench.execute({ type: 'selection.clear', input: {} })
    }
  }
  return (
    <>
      <Button
        className={styles.close}
        aria-label="Clear selection from Properties"
        onPress={() => {
          const edits = shownEdits()
          if (edits.count === 0) {
            close()
            return
          }
          setCount(edits.count)
          setConfirming(true)
        }}
      >
        <X size={16} aria-hidden="true" />
      </Button>
      <DialogFrame
        title="Leave with unsaved edits?"
        role="alertdialog"
        isOpen={confirming}
        onOpenChange={setConfirming}
      >
        <p>
          {count === 1 ? '1 field is' : `${count} fields are`} edited and not
          saved. Leaving discards {count === 1 ? 'it' : 'them'}.
        </p>
        <div className={shellStyles.dialogActions}>
          <Button slot="close" className={componentStyles.button}>
            Keep editing
          </Button>
          <Button
            className={cx(componentStyles.button, componentStyles.primary)}
            onPress={() => {
              shownEdits().discard()
              setConfirming(false)
              close()
            }}
          >
            Discard and leave
          </Button>
        </div>
      </DialogFrame>
    </>
  )
}
