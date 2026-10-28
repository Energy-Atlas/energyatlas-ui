import { Layout, type ITabRenderValues, type TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/light.css'
import {
  Bell,
  LayoutTemplate,
  FileSpreadsheet,
  FolderTree,
  LayoutDashboard,
  Map as MapIcon,
  MessageSquare,
  SlidersHorizontal,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from 'zustand'
import {
  useClientSnapshot,
  useLayoutVersion,
  useServices,
} from '../app/WorkbenchContext.tsx'
import { useInvokeAction } from '../app/actions.ts'
import { cx } from '../app/cx.ts'
import componentStyles from '../app/components/components.module.css'
import {
  HandoverSummary,
  ViewOnlyBadge,
} from '../app/components/HandoverSummary.tsx'
import { InlineAlert } from '../app/components/InlineAlert.tsx'
import '../app/global.css'
import '../app/layout/flexlayout-theme.css'
import { LayoutsPanel } from '../app/layouts/LayoutsPanel.tsx'
import { DashboardPage } from '../app/pages/DashboardPage.tsx'
import { MapPage } from '../app/pages/MapPage.tsx'
import { TablePage } from '../app/pages/TablePage.tsx'
import { ResultsPage } from '../app/pages/results/ResultsPage.tsx'
import { AssetsPanel } from '../app/panels/AssetsPanel.tsx'
import { MessagesPanel } from '../app/panels/MessagesPanel.tsx'
import { PropertiesPanel } from '../app/panels/PropertiesPanel.tsx'
import { ReasoningPanel } from '../app/panels/ReasoningPanel.tsx'
import { openDemoPanel } from '../app/shell/demoSwitchStore.ts'
import { DialogFrame } from '../app/shell/HelpDialogs.tsx'
import { Ribbon } from '../app/shell/Ribbon.tsx'
import { ShellDialogHost } from '../app/shell/ShellDialogHost.tsx'
import shellStyles from '../app/shell/shell.module.css'
import { StatusBar } from '../app/shell/StatusBar.tsx'
import { ToastHost } from '../app/shell/ToastHost.tsx'
import { useShellDialogs } from '../app/shell/useShellDialogs.ts'
import { useShortcuts } from '../app/useShortcuts.ts'
import { useViewerActions } from './viewerActions.ts'
import { viewerStore } from './viewerStore.ts'
import styles from './viewer.module.css'

// The viewer's own shell (decision 0032, stage 5): the workbench's ribbon,
// docking, status bar, and dialogs, with only the pages and panels a
// view-only page shows. Pages that change the model are not in it at all.

const TAB_ICONS: Record<string, LucideIcon> = {
  'panel.assets': FolderTree,
  'panel.reasoning': MessageSquare,
  'panel.inspection': SlidersHorizontal,
  'panel.messages': Bell,
  'panel.layouts': LayoutTemplate,
  'page.map': MapIcon,
  'page.table': Table2,
  'page.dashboard': LayoutDashboard,
  'page.results': FileSpreadsheet,
}

const KEY_MAP = { focusNextTabset: 'F6', focusPreviousTabset: 'Shift+F6' }

const COMPACT_QUERY = '(max-width: 1099px)'

function renderTab(node: TabNode, values: ITabRenderValues) {
  const Icon = TAB_ICONS[node.getComponent() ?? '']
  if (!Icon) return
  values.leading = <Icon size={14} aria-hidden="true" />
  if (node.isInsideBorder()) values.content = node.getName()
}

const tabContent = new Map<string, { component: string; element: ReactNode }>()

function renderTabContent(node: TabNode) {
  const component = node.getComponent() ?? ''
  const cached = tabContent.get(node.getId())
  if (cached && cached.component === component) return cached.element
  const element = createTabContent(node)
  tabContent.set(node.getId(), { component, element })
  return element
}

function createTabContent(node: TabNode): ReactNode {
  switch (node.getComponent()) {
    case 'page.map':
      return <MapPage />
    case 'page.table':
      return <TablePage />
    case 'page.dashboard':
      return <DashboardPage />
    case 'page.results':
      return <ResultsPage />
    case 'panel.assets':
      return <AssetsPanel />
    case 'panel.reasoning':
      return <ReasoningPanel />
    case 'panel.inspection':
      return <PropertiesPanel />
    case 'panel.messages':
      return <MessagesPanel />
    case 'panel.layouts':
      return <LayoutsPanel />
    default:
      return (
        <p className={componentStyles.page}>
          &ldquo;{node.getName()}&rdquo; is not part of the viewer. Reset the
          layout from the View menu.
        </p>
      )
  }
}

/** File > About this handover: the package's provenance and warnings. */
function AboutHandoverDialog() {
  const isOpen = useStore(viewerStore, (state) => state.aboutOpen)
  const handover = useClientSnapshot((snapshot) => snapshot.meta.handover)
  if (!handover) return null
  return (
    <DialogFrame
      title={`About "${handover.name}"`}
      isOpen={isOpen}
      onOpenChange={(open) => viewerStore.setState({ aboutOpen: open })}
    >
      <HandoverSummary
        createdAt={handover.createdAt}
        provenance={handover.provenance}
        warnings={handover.warnings}
        fileName={handover.fileName}
      />
    </DialogFrame>
  )
}

/** The package's warnings under the ribbon until dismissed for this session. */
function HandoverWarnings() {
  const handover = useClientSnapshot((snapshot) => snapshot.meta.handover)
  const [dismissed, setDismissed] = useState(false)
  const shown = handover && !dismissed ? handover.warnings : []
  // Always present, so the shell's grid rows stay in place when empty.
  return (
    <div className={styles.warnings}>
      {shown.map((warning, index) => (
        <InlineAlert
          key={warning}
          tone="warning"
          actions={
            index === 0 ? (
              <>
                <Button
                  className={componentStyles.button}
                  onPress={() => viewerStore.setState({ aboutOpen: true })}
                >
                  About this handover
                </Button>
                <Button
                  className={componentStyles.button}
                  aria-label="Dismiss the handover warnings"
                  onPress={() => setDismissed(true)}
                >
                  Dismiss
                </Button>
              </>
            ) : null
          }
        >
          {warning}
        </InlineAlert>
      ))}
    </div>
  )
}

export function ViewerShell() {
  const { layout } = useServices()
  const name = useClientSnapshot(
    (snapshot) => snapshot.meta.handover?.name ?? '',
  )
  const { open, dialogs, onOpenChange } = useShellDialogs()
  const actions = useViewerActions(dialogs)
  const invoke = useInvokeAction()
  useShortcuts(actions, invoke)
  useLayoutVersion()

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const apply = () => layout.setCompact(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [layout])

  return (
    <div className={cx(shellStyles.shell, styles.shell)}>
      <Ribbon
        actions={actions}
        invoke={invoke}
        badge={
          <>
            <ViewOnlyBadge />
            <span className={styles.packageName} title={name}>
              {name}
            </span>
          </>
        }
      />
      <HandoverWarnings />
      <main className={shellStyles.main} aria-label="Workspace" tabIndex={-1}>
        <Layout
          model={layout.getModel()}
          factory={renderTabContent}
          onAction={layout.handleUserAction}
          onRenderTab={renderTab}
          keyMap={KEY_MAP}
        />
      </main>
      <ToastHost />
      <StatusBar
        onOpenPage={(page) => layout.openPage(page)}
        onOpenDemoConditions={openDemoPanel}
        onOpenMessages={() => {
          if (!layout.isPanelOpen('messages')) layout.togglePanel('messages')
        }}
      />
      <AboutHandoverDialog />
      <ShellDialogHost
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        invoke={invoke}
      />
    </div>
  )
}
