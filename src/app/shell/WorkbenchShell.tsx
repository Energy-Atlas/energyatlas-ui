import { Layout, type ITabRenderValues, type TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/light.css'
import {
  Bell,
  DatabaseZap,
  FileSpreadsheet,
  Gauge,
  Shapes,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  MessageSquare,
  Route,
  SlidersHorizontal,
  Settings,
  SquarePlus,
  Table2,
  TriangleAlert,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useLayoutVersion, useServices } from '../WorkbenchContext.tsx'
import { useAppActions, useInvokeAction } from '../actions.ts'
import componentStyles from '../components/components.module.css'
import '../global.css'
import '../layout/flexlayout-theme.css'
import { AccountPage } from '../pages/AccountPage.tsx'
import { MeasuresPage } from '../pages/MeasuresPage.tsx'
import { DashboardPage } from '../pages/DashboardPage.tsx'
import { IssuesPage } from '../pages/IssuesPage.tsx'
import { MapPage } from '../pages/MapPage.tsx'
import { RoadmapPage } from '../pages/RoadmapPage.tsx'
import { SettingsPage } from '../pages/SettingsPage.tsx'
import { TablePage } from '../pages/TablePage.tsx'
import { TasksPage } from '../pages/TasksPage.tsx'
import { IntakePage } from '../pages/intake/IntakePage.tsx'
import { ArchetypesPage } from '../pages/archetypes/ArchetypesPage.tsx'
import { CalibrationPage } from '../pages/calibration/CalibrationPage.tsx'
import { ResultsPage } from '../pages/results/ResultsPage.tsx'
import { AssetsPanel } from '../panels/AssetsPanel.tsx'
import { PropertiesPanel } from '../panels/PropertiesPanel.tsx'
import { MessagesPanel } from '../panels/MessagesPanel.tsx'
import { ReasoningPanel } from '../panels/ReasoningPanel.tsx'
import { WorkflowPanel } from '../panels/WorkflowPanel.tsx'
import { useShortcuts } from '../useShortcuts.ts'
import { openDemoPanel } from './demoSwitchStore.ts'
import { Ribbon } from './Ribbon.tsx'
import { ShellDialogHost } from './ShellDialogHost.tsx'
import { StatusBar } from './StatusBar.tsx'
import { ToastHost } from './ToastHost.tsx'
import { useShellDialogs } from './useShellDialogs.ts'
import styles from './shell.module.css'

const TAB_ICONS: Record<string, LucideIcon> = {
  'panel.assets': FolderTree,
  'panel.workflow': Workflow,
  'panel.reasoning': MessageSquare,
  'panel.inspection': SlidersHorizontal,
  'panel.messages': Bell,
  'page.map': MapIcon,
  'page.table': Table2,
  'page.dashboard': LayoutDashboard,
  'page.roadmap': Route,
  'page.creator': SquarePlus,
  'page.settings': Settings,
  'page.issues': TriangleAlert,
  'page.tasks': ListChecks,
  'page.intake': DatabaseZap,
  'page.archetypes': Shapes,
  'page.calibration': Gauge,
  'page.results': FileSpreadsheet,
  'page.account': UserRound,
}

const KEY_MAP = { focusNextTabset: 'F6', focusPreviousTabset: 'Shift+F6' }

// Below this width side panels open as overlays (decision 0004).
const COMPACT_QUERY = '(max-width: 1099px)'

// Border tabs form the icon side bar of decision 0004; the tab name stays the
// accessible label, so only the visible content changes.
function renderTab(node: TabNode, values: ITabRenderValues) {
  const Icon = TAB_ICONS[node.getComponent() ?? '']
  if (!Icon) return
  // Ribbon tabs mirror center tabs, rotated: icon, name, and close.
  values.leading = <Icon size={14} aria-hidden="true" />
  if (node.isInsideBorder()) values.content = node.getName()
}

// FlexLayout calls the factory for every tab whenever its model changes, which
// a splitter drag does on each pointer move. Returning the same element for a
// tab lets React skip re-rendering pages whose own state did not change.
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
    case 'panel.workflow':
      return <WorkflowPanel />
    case 'page.tasks':
      return <TasksPage />
    case 'page.intake':
      return <IntakePage />
    case 'page.archetypes':
      return <ArchetypesPage />
    case 'page.calibration':
      return <CalibrationPage />
    case 'page.results':
      return <ResultsPage />
    case 'page.account':
      return <AccountPage />
    case 'page.issues':
      return <IssuesPage />
    case 'page.settings':
      return <SettingsPage />
    case 'panel.assets':
      return <AssetsPanel />
    case 'panel.reasoning':
      return <ReasoningPanel />
    case 'panel.inspection':
      return <PropertiesPanel />
    case 'panel.messages':
      return <MessagesPanel />
    case 'page.map':
      return <MapPage />
    case 'page.table':
      return <TablePage />
    case 'page.dashboard':
      return <DashboardPage />
    case 'page.roadmap':
      return <RoadmapPage />
    case 'page.creator':
      return <MeasuresPage />
    default:
      return (
        <p className={componentStyles.page}>
          Unknown tab &ldquo;{node.getName()}&rdquo;. Reset the layout from the
          View menu.
        </p>
      )
  }
}

export function WorkbenchShell() {
  const { layout } = useServices()
  const { open, dialogs, onOpenChange } = useShellDialogs()
  const actions = useAppActions(dialogs)
  const invoke = useInvokeAction()
  useShortcuts(actions, invoke)
  useLayoutVersion()

  // Decision 0004 narrow-width behavior: side panels become overlays.
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const apply = () => layout.setCompact(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [layout])

  return (
    <div className={styles.shell}>
      <Ribbon actions={actions} invoke={invoke} />
      <main className={styles.main} aria-label="Workspace" tabIndex={-1}>
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
      <ShellDialogHost
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        invoke={invoke}
      />
    </div>
  )
}
