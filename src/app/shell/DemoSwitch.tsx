import {
  ChevronDown,
  ChevronUp,
  FlaskConical,
  GripVertical,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  Button,
  Checkbox,
  Label,
  Radio,
  RadioGroup,
  Switch,
} from 'react-aria-components'
import { useStore } from 'zustand'
import {
  DEFAULT_CONDITIONS,
  FAULT_OPTIONS,
  JOB_OPTIONS,
  LATENCY_OPTIONS,
  describeConditions,
  type DemoConditions,
} from '../../server/conditions.ts'
import { FIXTURES, FIXTURE_IDS, type FixtureId } from '../../server/fixtures.ts'
import {
  useClientSnapshot,
  useServices,
  useUnsavedChanges,
} from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { cx } from '../cx.ts'
import pageStyles from '../pages/pages.module.css'
import { usePendingReason } from '../service/usePendingReason.ts'
import {
  demoSwitchStore,
  moveDemoSwitch,
  setDemoPanelOpen,
  type DemoSwitchPosition,
} from './demoSwitchStore.ts'
import styles from './demoSwitch.module.css'

type Option<Value extends string> = {
  value: Value
  label: string
  description: string
}

/** How far the arrow keys move the switch; Shift moves it further. */
const KEY_STEP = 16
const KEY_STEP_LARGE = 64
/** Space kept between the switch and the window edge. */
const MARGIN = 4

function OptionGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Option<Value>[]
  value: Value
  onChange: (value: Value) => void
}) {
  return (
    <RadioGroup
      className={pageStyles.radioGroup}
      value={value}
      onChange={(next) => {
        const option = options.find((candidate) => candidate.value === next)
        if (option) onChange(option.value)
      }}
    >
      <Label className={pageStyles.label}>{label}</Label>
      <div className={pageStyles.appearanceOptions}>
        {options.map((option) => (
          <Radio
            key={option.value}
            className={pageStyles.appearanceOption}
            value={option.value}
          >
            <span className={pageStyles.optionText}>
              <span className={pageStyles.optionLabel}>{option.label}</span>
              <span className={pageStyles.optionDescription}>
                {option.description}
              </span>
            </span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  )
}

/** Keeps a box of this size inside the window. */
function clamp(
  position: DemoSwitchPosition,
  width: number,
  height: number,
): DemoSwitchPosition {
  return {
    x: Math.round(
      Math.min(
        Math.max(MARGIN, position.x),
        window.innerWidth - width - MARGIN,
      ),
    ),
    y: Math.round(
      Math.min(
        Math.max(MARGIN, position.y),
        window.innerHeight - height - MARGIN,
      ),
    ),
  }
}

/**
 * The demo switch (decision 0028): a small control floating over every
 * screen, the start screen included, that the viewer can drag anywhere. Its
 * switch turns the demo conditions on and off as a whole (off is normal; on
 * brings back the last conditions chosen), and it opens the panel where
 * conditions are chosen and fixtures loaded. Conditions are causes the mock
 * server acts on (decision 0023), never displayed states.
 */
export function DemoSwitch() {
  const { client, lifecycle } = useServices()
  const conditions = useClientSnapshot((snapshot) => snapshot.conditions)
  const currentProject = useClientSnapshot(
    (snapshot) => snapshot.meta.currentProject,
  )
  const dirty = useUnsavedChanges()
  const expanded = useStore(demoSwitchStore, (state) => state.expanded)
  const stored = useStore(demoSwitchStore, (state) => state.position)
  const [fixture, setFixture] = useState<FixtureId>('partway')
  const loading = usePendingReason('project.replace', 'a project is loading')
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const panelId = useId()
  // The last conditions other than normal, which switching on brings back.
  const remembered = useRef<DemoConditions | null>(null)

  const labels = describeConditions(conditions)
  const active = labels.length > 0
  useEffect(() => {
    if (active) remembered.current = conditions
  }, [active, conditions])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const box = root.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  // The default place: the empty end of the menu bar, left of the account
  // button, so it covers no content until the viewer moves it.
  const fallback = {
    x: window.innerWidth - size.width - 48,
    y: 4,
  }
  const position = clamp(stored ?? fallback, size.width, size.height)

  useEffect(() => {
    const keepInside = () => {
      const current = demoSwitchStore.getState().position
      const root = rootRef.current
      if (!current || !root) return
      const box = root.getBoundingClientRect()
      const next = clamp(current, box.width, box.height)
      if (next.x !== current.x || next.y !== current.y) moveDemoSwitch(next)
    }
    window.addEventListener('resize', keepInside)
    return () => window.removeEventListener('resize', keepInside)
  }, [])

  const change = (patch: Partial<DemoConditions>) =>
    client.setConditions({ ...conditions, ...patch })
  const setActive = (on: boolean) => {
    if (!on) {
      client.setConditions(DEFAULT_CONDITIONS)
      return
    }
    if (remembered.current) client.setConditions(remembered.current)
    else setDemoPanelOpen(true)
  }

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    }
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    moveDemoSwitch(
      clamp(
        {
          x: event.clientX - drag.current.dx,
          y: event.clientY - drag.current.dy,
        },
        size.width,
        size.height,
      ),
    )
  }
  const keyMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (event.key === 'Home') {
      event.preventDefault()
      moveDemoSwitch(null)
      return
    }
    if (!move) return
    event.preventDefault()
    moveDemoSwitch(
      clamp(
        { x: position.x + move[0], y: position.y + move[1] },
        size.width,
        size.height,
      ),
    )
  }

  // The panel opens toward the middle of the window.
  const opensUp = position.y > window.innerHeight / 2
  const alignsRight = position.x > window.innerWidth / 2

  return (
    <div
      ref={rootRef}
      className={cx(styles.switch, active && styles.active)}
      style={{ left: position.x, top: position.y }}
      data-testid="demo-switch"
      // Stays usable while a modal dialog is open, such as "Changing
      // project", whose recovery is to change the conditions.
      data-react-aria-top-layer="true"
    >
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.grip}
          aria-label="Move the demo switch: drag, or use the arrow keys; Home puts it back"
          title="Drag to move"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onKeyDown={keyMove}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <Switch
          className={styles.toggle}
          isSelected={active}
          onChange={setActive}
          aria-label="Demo conditions on"
        >
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
          <FlaskConical size={14} aria-hidden="true" />
          {/* Compact while normal; the conditions are named when on. */}
          {active ? (
            <span className={styles.label}>{labels.join(', ')}</span>
          ) : null}
        </Switch>
        <Button
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          aria-label="Demo conditions…"
          onPress={() => setDemoPanelOpen(!expanded)}
        >
          {expanded === opensUp ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} aria-hidden="true" />
          )}
        </Button>
      </div>
      {expanded ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Demo conditions"
          className={cx(
            styles.panel,
            opensUp ? styles.panelUp : styles.panelDown,
            alignsRight && styles.panelRight,
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDemoPanelOpen(false)
          }}
        >
          <h2 className={styles.title}>Demo conditions</h2>
          <p className={componentStyles.muted}>
            These set what the mock server does, not what the screen shows. They
            last until this browser tab is closed.
          </p>

          <h3 className={styles.section}>Project fixture</h3>
          <OptionGroup
            label="Fixture"
            options={FIXTURE_IDS.map((id) => ({ value: id, ...FIXTURES[id] }))}
            value={fixture}
            onChange={setFixture}
          />
          {currentProject && dirty ? (
            <InlineAlert tone="warning">
              The project has unsaved changes. Loading a fixture replaces it;
              the copy saved in this browser is unchanged.
            </InlineAlert>
          ) : null}
          <div className={styles.actions}>
            <Button
              className={componentStyles.button}
              isDisabled={loading !== null}
              onPress={() =>
                void lifecycle.request({ type: 'fixture', fixture })
              }
            >
              {loading ? 'Loading…' : `Load "${FIXTURES[fixture].label}"`}
            </Button>
          </div>

          <h3 className={styles.section}>Server</h3>
          <OptionGroup
            label="Delay"
            options={LATENCY_OPTIONS}
            value={conditions.latency}
            onChange={(latency) => change({ latency })}
          />
          <OptionGroup
            label="Faults"
            options={FAULT_OPTIONS}
            value={conditions.fault}
            onChange={(fault) => change({ fault })}
          />
          <OptionGroup
            label="Jobs"
            options={JOB_OPTIONS}
            value={conditions.jobs}
            onChange={(jobs) => change({ jobs })}
          />
          <Checkbox
            className={formStyles.checkbox}
            isSelected={conditions.hold}
            onChange={(hold) => change({ hold })}
          >
            Hold requests: no reply arrives until this is turned off
          </Checkbox>

          <div className={styles.actions}>
            <Button
              className={componentStyles.button}
              isDisabled={!active}
              onPress={() => client.setConditions(DEFAULT_CONDITIONS)}
            >
              Back to normal
            </Button>
            <Button
              className={cx(componentStyles.button, componentStyles.primary)}
              onPress={() => setDemoPanelOpen(false)}
            >
              Done
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
