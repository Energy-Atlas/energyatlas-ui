import { useEffect, useRef } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import { FIXTURES, FIXTURE_IDS } from '../../server/fixtures.ts'
import { useClientSnapshot, useServices } from '../WorkbenchContext.tsx'
import { forStartScreen, useAppActions, useInvokeAction } from '../actions.ts'
import componentStyles from '../components/components.module.css'
import { InlineAlert } from '../components/InlineAlert.tsx'
import { SelectableList } from '../components/SelectableList.tsx'
import { cx } from '../cx.ts'
import { Ribbon } from '../shell/Ribbon.tsx'
import { ShellDialogHost } from '../shell/ShellDialogHost.tsx'
import { useShellDialogs } from '../shell/useShellDialogs.ts'
import { useShortcuts } from '../useShortcuts.ts'
import { ProjectList } from './ProjectList.tsx'
import styles from './project.module.css'

/**
 * The start screen (decision 0024; menu bar and demos, decision 0028): the
 * workbench's menu bar, with what needs a project unavailable, then Create
 * and Open, the prebuilt demo projects, and the projects saved in this
 * browser.
 */
export function ProjectStart() {
  const { client, lifecycle } = useServices()
  const meta = useClientSnapshot((snapshot) => snapshot.meta)
  const pending = useClientSnapshot((snapshot) => snapshot.pending)
  const lifecycleSnapshot = useStore(lifecycle.store, (snapshot) => snapshot)
  const { open, dialogs, onOpenChange } = useShellDialogs()
  const actions = forStartScreen(useAppActions(dialogs))
  const invoke = useInvokeAction()
  useShortcuts(actions, invoke)
  const error =
    lifecycleSnapshot.dialog === null && lifecycleSnapshot.guard === null
      ? lifecycleSnapshot.issues.map((issue) => issue.message).join(' ')
      : ''
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
  const busyReason = lifecycleSnapshot.busy
    ? 'Wait for the current project change to finish.'
    : pending.length > 0
      ? 'Wait for the server to answer first.'
      : null

  return (
    <div className={styles.start}>
      <Ribbon actions={actions} invoke={invoke} projectHeading={false} />
      <main
        className={styles.content}
        aria-labelledby="projects-heading"
        tabIndex={-1}
      >
        <h1 id="projects-heading" tabIndex={-1}>
          Projects
        </h1>
        <p>
          Choose a saved project or a demo, or create a new project to enter the
          workbench.
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
        <div className={styles.lists}>
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
                    No saved projects in this browser yet. Create a project,
                    then save it to find it here.
                  </p>
                ) : null}
              </>
            )}
          </section>
          <section className={styles.section} aria-labelledby="demos-heading">
            <h2 id="demos-heading" className={styles.sectionHeading}>
              Demo projects
            </h2>
            <SelectableList
              aria-label="Demo projects"
              className={styles.projects}
              selectionMode="none"
              items={FIXTURE_IDS.map((id) => ({
                id,
                title: FIXTURES[id].label,
                meta: FIXTURES[id].description,
                description: FIXTURES[id].description,
              }))}
              onAction={(id) => {
                const fixture = FIXTURE_IDS.find(
                  (candidate) => candidate === id,
                )
                if (fixture)
                  void lifecycle.request({ type: 'fixture', fixture })
              }}
              disabledReason={busyReason}
            />
          </section>
        </div>
      </main>
      <ShellDialogHost
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        invoke={invoke}
      />
    </div>
  )
}
