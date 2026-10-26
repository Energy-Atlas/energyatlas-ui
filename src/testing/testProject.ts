import type { WorkbenchState } from '../domain/types.ts'
import { createInitialState } from '../domain/initialState.ts'
import { createWorkbench } from '../domain/workbench.ts'
import {
  DRAFT_COMMANDS,
  createProjectClient,
  refuseServerCommand,
} from '../app/service/projectClient.ts'
import {
  DEFAULT_CONDITIONS,
  type DemoConditions,
} from '../server/conditions.ts'
import type { FixtureId } from '../server/fixtures.ts'
import { createMockServer } from '../server/server.ts'
import { createTransport } from '../server/transport.ts'
import { manualScheduler } from './manualScheduler.ts'

/**
 * The app's project services for tests: the mock server, a transport without
 * delay by default, and the UI's workbench and client, all on one manual
 * scheduler. Step it with `manual.settle()`.
 */
export function createTestProject(
  options: {
    conditions?: Partial<DemoConditions>
    fixture?: FixtureId
    storage?: Storage | null
    initialState?: WorkbenchState
    startClosed?: boolean
  } = {},
) {
  const manual = manualScheduler()
  const server = createMockServer({
    storage: options.storage ?? null,
    scheduler: manual.scheduler,
    fixture: options.fixture ?? null,
    startClosed: options.startClosed,
  })
  const transport = createTransport(server, {
    scheduler: manual.scheduler,
    conditions: {
      ...DEFAULT_CONDITIONS,
      latency: 'none',
      ...options.conditions,
    },
  })
  const initial = server.current()
  const workbench = createWorkbench({
    operationIdPrefix: 'ui-op',
    initialState: initial.state ?? createInitialState(),
    isUndoable: (type) => DRAFT_COMMANDS.has(type),
    refuse: (type) =>
      refuseServerCommand(
        type,
        client.store.getState().pending,
        client.store.getState().meta.currentProject !== null,
        client.store.getState().transitioning,
      ),
  })
  const client = createProjectClient({
    workbench,
    transport,
    session: null,
    initial,
  })
  return { manual, server, transport, workbench, client }
}
