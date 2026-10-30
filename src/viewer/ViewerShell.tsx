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
import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  useClientSnapshot,
  useLayoutVersion,
  useServices,
} from '../app/WorkbenchContext.tsx'
import { useInvokeAction } from '../app/actions.ts'
import componentStyles from '../app/components/components.module.css'
import { HandoverSummary } from '../app/components/HandoverSummary.tsx'
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

// The viewer's own shell (decision 0032, stage 5; decision 0036): the
// editor's ribbon, menus, toolbar, docking, status bar, and dialogs, with
// everything a view cannot do unavailable and saying why. Its pages and
// panels are those a view shows; pages that change the model are not in it.

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

/** File > About this view: the view's provenance and warnings. */
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

export function ViewerShell() {
  const { layout } = useServices()
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
    <div className={shellStyles.shell}>
      {/* As in the editor: no title in the top bar; the view's name and its
          View only tag sit in the status bar, and its warnings are messages
          (decision 0036). */}
      <Ribbon actions={actions} invoke={invoke} />
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
