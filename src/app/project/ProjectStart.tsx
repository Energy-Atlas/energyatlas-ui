import { useEffect, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import {
  APPEARANCE_LIST,
  type AppearancePreference,
} from '../appearance/appearances.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import componentStyles from '../components/components.module.css'
import formStyles from '../components/forms.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { cx } from '../cx.ts'
import { DemoConditionsDialog } from '../shell/DemoConditionsDialog.tsx'
import shellStyles from '../shell/shell.module.css'
import markUrl from '../../assets/brand/energyatlas-mark.svg'
import { ProjectList } from './ProjectList.tsx'
import { describeConditions } from '../../server/conditions.ts'
import styles from './project.module.css'

export function ProjectStart() {
  const { client, lifecycle, appearancePreference, setAppearance } =
    useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const conditionLabels = useClientSnapshot((snapshot) =>
    describeConditions(snapshot.conditions).join(', '),
  )
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const lifecycleSnapshot = useStore(lifecycle.store, (snapshot) => snapshot)
  const error =
    lifecycleSnapshot.dialog === null && lifecycleSnapshot.guard === null
      ? lifecycleSnapshot.issues.map((issue) => issue.message).join(' ')
      : ''
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (!started.current && !client.store.getState().meta.catalogReady) {
      started.current = true
      void client.listProjects()
    }
  }, [client])
  const waiting =
    !meta.catalogReady ||
    pending.some((request) => request.type === 'project.list')
  const unavailable = lifecycleSnapshot.busy || pending.length > 0
  return (
    <div className={styles.start}>
      <header className={styles.header}>
        <img
          className={shellStyles.brandMark}
          src={markUrl}
          alt="EnergyAtlas"
        />
        <label className={styles.appearance}>
          Appearance{' '}
          <select
            className={formStyles.input}
            aria-label="Appearance"
            value={appearancePreference}
            onChange={(event) =>
              setAppearance(event.target.value as AppearancePreference)
            }
          >
            <option value="system">System</option>
            {APPEARANCE_LIST.map((appearance) => (
              <option key={appearance.id} value={appearance.id}>
                {appearance.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main
        className={styles.content}
        aria-labelledby="projects-heading"
        tabIndex={-1}
      >
        <div className={styles.titleRow}>
          <h1 id="projects-heading" tabIndex={-1}>
            Projects
          </h1>
          <span className={styles.metadata}>
            Synthetic demo · browser storage
          </span>
        </div>
        <p>
          Choose a saved project or create a new project to enter the workbench.
        </p>
        <div className={styles.actions}>
          <Button
            className={cx(componentStyles.button, componentStyles.primary)}
            isDisabled={unavailable}
            onPress={() => lifecycle.openCreate()}
          >
            Create project
          </Button>
          <Button
            className={componentStyles.button}
            isDisabled={unavailable}
            onPress={() => lifecycle.openCatalog()}
          >
            Open project
          </Button>
        </div>
        {error ? (
          <InlineAlert tone="danger">
            {`${error} Choose the project again to retry, or change Demo conditions.`}
          </InlineAlert>
        ) : null}
        <section className={styles.section} aria-labelledby="recent-heading">
          <h2 id="recent-heading" className={styles.sectionHeading}>
            Recent projects
          </h2>
          {waiting ? (
            <p role="status">Loading projects…</p>
          ) : (
            <>
              {meta.catalogError ? (
                <InlineAlert
                  tone="danger"
                  actions={
                    <Button
                      className={componentStyles.button}
                      onPress={() => void client.listProjects()}
                    >
                      Try loading projects again
                    </Button>
                  }
                >
                  {meta.catalogError}
                </InlineAlert>
              ) : null}
              {meta.projects.length ? (
                <ProjectList
                  projects={meta.projects.slice(0, 8)}
                  disabled={unavailable}
                />
              ) : !meta.catalogError ? (
                <p>
                  No saved projects in this browser yet. Create a project, then
                  save it to find it here.
                </p>
              ) : null}
            </>
          )}
        </section>
      </main>
      <footer className={styles.footer}>
        <span>
          Projects stay in this browser. No real backend or filesystem is
          connected.
          {conditionLabels ? ` Demo: ${conditionLabels}.` : ''}
        </span>
        <Button
          className={componentStyles.button}
          onPress={() => setConditionsOpen(true)}
        >
          Demo conditions…
        </Button>
      </footer>
      <DemoConditionsDialog
        isOpen={conditionsOpen}
        onOpenChange={setConditionsOpen}
      />
    </div>
  )
}
