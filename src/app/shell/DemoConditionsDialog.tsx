import { useState } from 'react'
import {
  Button,
  Checkbox,
  Label,
  Radio,
  RadioGroup,
} from 'react-aria-components'
import {
  DEFAULT_CONDITIONS,
  FAULT_OPTIONS,
  JOB_OPTIONS,
  LATENCY_OPTIONS,
  type DemoConditions,
} from '../../server/conditions.ts'
import { FIXTURES, FIXTURE_IDS, type FixtureId } from '../../server/fixtures.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { cx } from '../cx.ts'
import pageStyles from '../pages/pages.module.css'
import { usePendingReason } from '../service/usePendingReason.ts'
import { DialogFrame } from './HelpDialogs.tsx'
import styles from './shell.module.css'

type Option<Value extends string> = {
  value: Value
  label: string
  description: string
}

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

/**
 * Demo conditions (decision 0023): causes the mock server acts on, never
 * displayed states. Conditions apply at once and last for the session; a
 * fixture replaces the project through the server, like any request.
 */
export function DemoConditionsDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}) {
  const { client } = useServices()
  const conditions = useClientSnapshot((snapshot) => snapshot.conditions)
  const dirty = useClientSnapshot((snapshot) => snapshot.meta.dirty)
  const [fixture, setFixture] = useState<FixtureId>('partway')
  const loading = usePendingReason('project.replace', 'a project is loading')

  const change = (patch: Partial<DemoConditions>) =>
    client.setConditions({ ...conditions, ...patch })
  const isDefault =
    JSON.stringify(conditions) === JSON.stringify(DEFAULT_CONDITIONS)

  return (
    <DialogFrame
      title="Demo conditions"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <p className={componentStyles.muted}>
        These set what the mock server does, not what the screen shows. Any
        condition other than normal is shown in the status bar. They last until
        this browser tab is closed.
      </p>

      <h3 className={styles.dialogSection}>Project fixture</h3>
      <OptionGroup
        label="Fixture"
        options={FIXTURE_IDS.map((id) => ({ value: id, ...FIXTURES[id] }))}
        value={fixture}
        onChange={setFixture}
      />
      {dirty ? (
        <p className={componentStyles.notice}>
          The project has unsaved changes. Loading a fixture replaces it; the
          copy saved in this browser is unchanged.
        </p>
      ) : null}
      <div className={styles.dialogActions}>
        <Button
          className={componentStyles.button}
          isDisabled={loading !== null}
          onPress={() => void client.replaceProject(fixture)}
        >
          {loading ? 'Loading…' : `Load "${FIXTURES[fixture].label}"`}
        </Button>
      </div>

      <h3 className={styles.dialogSection}>Server</h3>
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

      <div className={styles.dialogActions}>
        <Button
          className={cx(componentStyles.button)}
          isDisabled={isDefault}
          onPress={() => client.setConditions(DEFAULT_CONDITIONS)}
        >
          Back to normal
        </Button>
        <Button
          slot="close"
          className={cx(componentStyles.button, componentStyles.primary)}
        >
          Done
        </Button>
      </div>
    </DialogFrame>
  )
}
