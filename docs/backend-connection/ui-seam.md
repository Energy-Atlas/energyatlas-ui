# This app's mock-server seam

Date: 2026-11-08. `master` at `c49dcff`, read only. Paths are relative to this repository; line numbers are at that
commit. Part of the [backend connection evidence index](README.md).

## 1. Wiring

`src/app/WorkbenchContext.tsx:149-186`: `createMockServer` (`src/server/server.ts:272`) → `createTransport`
(`src/server/transport.ts:44`) → `createProjectClient` (`src/app/service/projectClient.ts:210`), which drives the UI's
own copy, `createWorkbench` (`src/domain/workbench.ts:98`). The UI workbench is created with `isUndoable:
DRAFT_COMMANDS` and a `refuse` hook (`refuseServerCommand`), so it never runs server commands itself. Tests swap only
`src/testing/testProject.ts` (same wiring, manual scheduler, latency `none`). `projectClient.ts:29-32` states "In RC
this talks HTTP and SignalR instead".

## 2. Request, reply, update

`src/server/server.ts`:

```ts
// :141
type ServerRequest =
  | { type: 'command'; command: Command; source; drafts?: Record<string, PendingEdit> } // drafts only for edits.apply
  | { type: 'project.save' | 'project.saveAs'; name?; source; view?: SavedView }
  | { type: 'project.openFile'; file: { name; text } } | { type: 'project.replace'; fixture: FixtureId }
  | { type: 'project.list' | 'project.close' } | { type: 'project.create'; name } | { type: 'project.open'; projectId }
  | { type: 'project.handover'; viewUnsaved?; drafts: number }
  | { type: 'handover.list' } | { type: 'handover.open'; packageId? | file? } | { type: 'handover.remove'; packageId }
// :249
type ServerReply = { ok: true; summary; sequence; projectGeneration; data?: unknown } | ({ ok: false } & ApiFailure)
// :241, pushed: a full snapshot plus the operations that produced it
type ServerUpdate = { sequence; projectGeneration; state: WorkbenchState | null; operations: ExternalOperation[]; meta: ServerMeta }
```

`MockServer` (`:260-267`): `handle(request, expectedGeneration)` (synchronous), `current()`, `subscribe`,
`setJobBehaviour`, `dispose`.

Transport (`src/server/transport.ts:21-36`): `NetworkFailure = {ok:false; network:true; message}`;
`request(request, projectGeneration): Promise<TransportReply>`; `subscribe(listener)`; conditions getters and setters.
`push()` (`:90-102`) delivers updates in order after the delay. Offline drops updates; on reconnect one
`server.current()` snapshot is pushed (`:121-125`) and the client logs `service.resync`
(`projectClient.ts:247-255`).

**Snapshots, not patches.** `emit()` (`server.ts:330-340`) runs on every applied engine operation and catalog change
and sends the whole `WorkbenchState`, the operations, and `meta`. `forward()` (`:343-381`) drops rejected and draft
operations. The client's `adopt()` (`projectClient.ts:231-267`) ignores old sequences, replaces state on a new
`projectGeneration` (clearing history), otherwise calls `mergeServerState` (`:178-208`), which keeps the UI's
`selection` (filtered to ids that exist), `pendingEdits` (filtered to buildings that exist), and
`workflow.currentStageId`. Immer patches exist only inside `workbench.ts` for local draft undo.

**Ordering contract.** `send()` (`:283-355`) awaits `transport.request`, then `caughtUpTo(reply.sequence)`: the
promise resolves only after the pushed update with that sequence is adopted, then the operation id is looked up in the
log. A real backend must give replies a sequence or version that matches the push channel, or this changes.

**Stale project guard.** Requests carry `projectGeneration`; a mismatch gets 409 `project_changed`
(`server.ts:696-707`).

**Idempotency.** `withRequestId` (`projectClient.ts:73-84`) adds `requestId: crypto.randomUUID()` to
`workflow.runStage` and `job.retry` only; `repeatedSubmission` (`src/domain/commands.ts:349-362`) handles repeats.
`intake.applyDataset` and `calibration.fit` accept `requestId` but the client does not send one.

**Requests in flight.** `ClientSnapshot` (`projectClient.ts:104-111`) is `{projectGeneration, transitioning,
saveError, pending: PendingRequest[], meta, conditions}`; `PendingRequest` (`:86-94`) is `{id, projectGeneration,
type, title, input, source}`. Read through `useClientSnapshot`. Consumers: `src/app/service/usePendingReason.ts`, the
status bar (`StatusBar.tsx:219-222`), `refuseServerCommand` (`projectClient.ts:45-67`, blocks draft changes and undo
while `edits.apply` is pending), and about 20 pages and properties panels.

## 3. Error model (`src/server/apiError.ts`)

```ts
type ApiErrorBody = { success: false; message; code; error?; title?; status?; errors?: Record<string, string[]>;
  traceId?; jobId?: string | null; kind?: string | null } // :8-19
type ApiFailure = { status: number; body: ApiErrorBody } // :21
```

| Function | Status and code |
| --- | --- |
| `invalidRequest` (`:25-56`) | 400 `invalid_request`, per-field `errors`, `traceId` `mock-trace-N` |
| `runInProgress` (`:59-74`) | 409 `run_in_progress` with `jobId`, `kind` |
| `serverError` (`:76-81`) | 500 by default, also 409/404/503, `code: server_error` |
| `viewOnlySession` (`:104-114`) | 403 `view_only` |

Display path: `issuesFromError` (`:84-95`) turns the body into `ValidationIssue[]` from `errors` keys or `message`;
**`jobId`, `kind`, `code`, and the HTTP status are dropped**, and nothing in the UI branches on `code`. Network failures
become `[{path:'', message}]` (`projectClient.ts:314-317`). Rejections are logged with `workbench.record({status:
'rejected'})`; `messageForOperation` (`src/app/messages/messageCenter.ts:144-188`) toasts general issues or non-manual
sources and keeps field errors beside fields; `splitIssues` (`src/app/commandErrors.ts`) splits per field. A failed
save sets `saveError` (`projectClient.ts:582-591`), shown in the status bar.

## 4. Server commands

`SERVER_COMMANDS` holds 40 commands (`server.ts:59-100`); `MODEL_COMMANDS` 35 of them (`:103-139`), refused with 409
`run_in_progress` while a job is queued or running (`:426-429`). Not locked: `workflow.runStage`, `job.retry`,
`intake.applyDataset`, `calibration.fit`, `task.cancel`. Each runs through `engine.execute`: zod validation, an Immer
recipe, a summary or 400 issues (`server.ts:436-444`). Definitions in `src/domain/commands.ts` (line in brackets).
Issued by: P page, Pr properties panel, A agent session, Wf workflow panel.

| Command [line] | Payload (main fields) | Mock behaviour | Issued by |
| --- | --- | --- | --- |
| workflow.runStage [1153] | stageId, requestId? | Supersedes open groups; new `stage` run group with signature and queued task; first archetype run adds library defaults and rules | actions.ts, Wf, StageProperties, several P, jobActions, A |
| job.retry [1214] | taskId, requestId? | Gated by `retryBlocker`; new attempt for outstanding items | jobActions, Wf, A |
| intake.applyDataset [1248] | datasetId, mapping, requestId? | `fusion` run group over valid records | IntakePage, A |
| schema.mapTarget [1313] | target, source\|null | Edit mapping | SchemaMatchingPage |
| schema.reviewSuggestions [1362] | targets[], decision | Accept or reject suggestions | SchemaMatchingPage, A |
| schema.suggest [1409] | {} | Fuzzy suggestions | SchemaMatchingPage |
| schema.mapValue [1433] | target, value, to\|null | Value maps | SchemaMatchingPage, A |
| schema.addCustomTarget / removeCustomTarget [1484/1514] | name, source / name | Custom targets | SchemaMatchingPage |
| schema.saveRuleSet / loadRuleSet / deleteRuleSet [1535/1580/1655] | name / ruleSetId or file (RC shape) / ruleSetId | Rule sets | SchemaMatchingPage |
| archetype.save [1674] | id?, name, use, yearFrom, yearTo, parts{4} | Create or update | ArchetypeProperties |
| archetype.addFromLibrary [1734] | libraryId | Copy with parts and schedules | ArchetypesPage, ArchetypeProperties |
| part.save [1770] | discriminated by `kind` (4) | Create or update part | PartProperties, A |
| schedule.save [1817] | id?, name, days[{hours[24]}], week[7] | Create or update | ScheduleProperties |
| rule.save [1900] | id?, name, enabled?, logic, conditions[], parts, position? | Assignment rule | RuleProperties, ArchetypesPage, A |
| rule.move / setEnabled / duplicate / remove / generateDefaults [2004-2113] | ruleId (+position or enabled) / {} | Rule list operations | ArchetypesPage |
| calibration.fit [2133] | meterId, unit, requestId? | `calibration` run group | CalibrationPage, A |
| calibration.adopt / revert [2180/2204] | variantId / {} | Swap the baseline result | CalibrationPage, A |
| workflow.setStageSkipped [2227] | stageId, skipped | Skip or restore | Wf, StageProperties, A |
| workflow.insertStage [2264] | afterStageId, name, description | Custom stage | StageProperties |
| task.cancel [2691] | taskId | Cancel; nothing published | JobDetail, actions.ts, projectLifecycle |
| edits.apply [2821] | {} plus `request.drafts` | Server adopts drafts as overrides, then clears them (`server.ts:430-440`) | TablePage, actions.ts, projectLifecycle |
| measure.create / update / addFromLibrary [2885/2906/2946] | name, kind, savingsPercent (+id) / libraryId | Measures | MeasureProperties, MeasuresPage, A |
| scenario.create / update / setAdoption [2981/3025/3068] | name, adoptionPercent, seed, included, measureIds (+id) / scenarioId, adoptionPercent | Scenarios; adoption re-aggregates | ScenarioProperties, DashboardPage, A |
| scenarioRule.save / move / setEnabled / duplicate / remove [3102-3265] | scenarioId, id?, name, logic, conditions, measures{4}, position? | Scenario rules | ScenarioRuleProperties, MeasuresPage, A |

Lifecycle and catalog requests (`server.ts` `handle()` `:695-1056`, client methods `projectClient.ts:462-612`):
`project.save` (503 on storage failure), `project.saveAs` (returns `data.file`), `project.openFile` (400; 409 while
running), `project.replace` (fixture; 409 while running), `project.list` (503), `project.create`, `project.open` (404),
`project.close`, `project.handover` (409 if never saved or jobs running; returns `data.package`), `handover.list`,
`handover.open`, `handover.remove` (404/503; the modeller refuses `open` with 400).

Local only: `workflow.setCurrentStage`, `selection.set`, `selection.clear`, `edits.propose`, `edits.discard`. Runner
only, on the server engine: `task.start`, `task.reportProgress`, `task.processItems`, `task.complete`, `task.fail` (not
in `SERVER_COMMANDS`; agent tools exclude them, `tools.ts:143`). View operations (37 types,
`src/app/view/viewOperations.ts`), layout operations, and demo conditions are local.

## 5. State model

`WorkbenchState` (`src/domain/types.ts:769-824`; empty project in `src/domain/initialState.ts`): `project{id,name,
location}`, `assets`, `rootAssetIds`, `buildings`, `buildingIds`, `archetypes`, `parts`, `rules`, `ruleIds`,
`schedules`, `measures`, `scenarios`, `scenarioRules`, `results{baseline, scenarios, scenarioVersions}`,
`gridElements`, `gridResult`, `overrides`, `workflow{stageIds, stages, edges, currentStageId}`, `tasks`, `taskIds`,
`runGroups`, `runGroupIds`, `sourceRecords`, `sourceRecordIds`, `datasets`, `schemaMatching`, `zoning`, `calibration`,
`issues`, `selection` and `pendingEdits` (UI only, reset on restore, `projectCatalog.ts:192-197`), `nextId`.

`zoning` (`src/domain/zoning/zoning.ts:113-121`) is `{geometry: Record<buildingId, BuildingZoneGeometry>, published:
{runId, storeys} | null}`; `projectSchema.ts:214-221` strips legacy `mode`, `perimeterDepthM`, `overrides`, `drawn`.

`ServerMeta` (`server.ts:211-238`): `dirty`, `savedAt`, `currentProject`, `projects[]`, `catalogReady`,
`catalogError`, `view: SavedView|null`, `viewOnly`, `handover`, `packages[]`, `packagesReady`, `packagesError`,
`unreadablePackages`.

Saved view (`SavedView`, `src/server/projectCatalog.ts:20-27`): `{tables, layers?, layouts?, defaultLayoutId?,
camera?}`, stored opaquely by the server, attached at save time by `client.attachView`
(`WorkbenchContext.tsx:239-244`), validated by `savedViewSchema` (`projectSchema.ts:866`). Other `ViewState` fields are
not saved except through layouts (`ViewSnapshot`, `src/app/layouts/savedLayout.ts:43-68`).

## 6. Persistence, schema, fixtures

- localStorage: `eaui.projects.v1` (`{version:1, projects}`), legacy `eaui.project.v2` (read-only import),
  `eaui.project.v1` (unsupported), `eaui.handovers.v1`, `eaui.layout.v2`, `eaui.viewer.layout.v1`, `eaui.theme`,
  `eaui.basemap`, `eaui.demoSwitch.v1`; sessionStorage `eaui.demoConditions` (`src/server/conditions.ts:165`).
- `projectStateSchema` (`projectSchema.ts:850-855`, 881 lines) runs `migrateArchetypeParts`,
  `migrateScenarioRules`, `migrateSchemaMatching` (`src/server/migrate*.ts`), then zod validation; later fields have
  defaults. `restoreProject` (`projectCatalog.ts:176-198`) cancels tasks that were queued or running.
- Project file `energyatlas-ui.project` v1 and handover package `energyatlas-ui.handover` v1, 20 MB each
  (`src/server/projectFile.ts:11-14`, `src/server/handover.ts:17-25`).
- Fixtures `new`, `partway`, `failed`, `complete` (`src/server/fixtures.ts`), built at runtime by running real commands
  through `runStageNow` (`src/domain/jobs/runNow.ts`) and seeded with `fixtureZoneGeometry()`. `?fixture=`,
  `?latency=`, `?fault=`, `?jobs=`, `?hold=` are parsed by `initialConditions` (`conditions.ts:172-191`). Viewer deep
  link `viewer.html?package=<id>`.
- OSM footprints `src/domain/fixtures/back-bay-buildings.geo.json` (116,620 bytes, 464 footprints, ODbL), statically
  imported by `src/domain/simulation.ts:10`, so bundled. Zone geometry `src/domain/fixtures/zone-geometry.json`
  (11,115 bytes) from `scripts/generate-zone-geometry.mjs`: synthetic plans for B0439, B0427, B0426.

## 7. Jobs

- `RunGroup` (`types.ts:671-689`): kinds `stage`, `fusion`, `calibration`; statuses `open`, `published`, `cancelled`,
  `invalidated`, `superseded`; successful item outputs held in `held`. `ITEM_STAGES` (`runGroups.ts:22-26`):
  preprocessing, archetypes, scenarioModeling.
- `captureSignature` (`:83-118`) and `signatureMismatch` (`:121-183`) check ancestor revisions, edit revisions,
  membership, options at `task.start`, retry, and publish. `retryBlocker` (`:242-277`) is shared by command and UI.
- `startTaskSimulator` (`src/domain/simulator.ts:67-195`) runs one job at a time, FIFO (`stepMs` 400, 4 steps;
  behaviours `normal`, `failPartway`, `stall`, `itemFailures`, `publishFails`), started per session in
  `server.ts:386-393`, never in viewer mode.
- `TaskStatus`: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `invalidated`; labels in
  `src/app/pages/jobs/jobView.ts:25-32` map to RC's Created, Running, Completed, Failed, Cancelled, plus "Not run".
  `Task.log: {at, message}[]` is saved in full.
- Progress path: runner step → `task.*` on the server engine → full-state `ServerUpdate` → transport push → `adopt`
  → render; `watchJobCompletions` (`src/app/jobs/jobNotices.ts`) raises notices. There is no separate progress channel.

## 8. Services, viewer, agent

- `services.lifecycle` (`src/app/service/projectLifecycle.ts`): intents `list`, `create`, `open`, `openFile`, `close`,
  `save`, `fixture`; guards unsaved changes, drafts, and active jobs; `perform` runs inside `client.withTransition`.
- `services.messages` (`src/app/messages/messageCenter.ts`): sources `project`, `workspace`, `job`, `agent`, `server`.
- Demo conditions (`conditions.ts:17-30`): latency, faults `nextRequest`, `everyRequest`, `offline`, `rejectInput`,
  `editLock` (`transport.ts:130-161`), hold (`:173-175`); UI in `src/app/shell/DemoSwitch.tsx`.
- Viewer: `viewer.html` → `src/viewer/main.tsx` → `WorkbenchProvider mode="viewer"`; same server code in
  `mode:'viewer'`; commands get 403 `view_only` before the run lock (`server.ts:425`); packages are built from the
  saved catalog copy (`server.ts:530-541`) by `buildHandoverPackage` and `freezeModel` (`handover.ts`).
- Agent tools (`src/app/agent/tools.ts`): `kind:'command'` calls `client.execute(command,'agent')` (`:299-302`);
  `kind:'project'` calls `lifecycle.request`; `kind:'handover'` sends `project.handover`; view, layout, and layouts
  tools are local. `requiresApproval` at `:212-224`; viewer filter `isViewerToolCall` at `:184-209`.

## 9. Marked as mocked or deferred in code

No TODO or FIXME in `src/`. Markers: `projectClient.ts:29-32`, `transport.ts:17-19`, `server.ts:54-56`,
`apiError.ts:3-6` (cites RC's `ApiErrors.cs`); capability `service.mockServer` simulated
(`src/domain/capabilities.ts:239-244`; registry: 15 simulated, 15 planned, 13 working); intake upload deferred
(`IntakePage.tsx:316`); zone geometry a synthetic stand-in (`zoning.ts:3-11`); synthetic libraries
(`archetypes/library.ts:4`); calibration per-building input deferred (`calibration.ts:218`); "Storage is mocked"
(`tools.ts:628`).

## 10. Build and hosting

- `basePath.ts`: `BASE_PATH = process.env.EAUI_BASE_PATH ?? '/energyatlas-ui/'`, applied when building or previewing;
  dev serves at `/`. Two entries via `build.rolldownOptions.input`: `index.html` (`src/main.tsx`, also `?spike=`,
  `?gallery`) and `viewer.html` (`src/viewer/main.tsx`). A plugin emits `maplibre-gl-worker.mjs` and
  `maplibre-gl-shared.mjs`.
- `.env.example` holds two reserved, unread variables for a model provider. The build reads only `EAUI_BASE_PATH`.
- External network: the OpenFreeMap style (`basemapStyle.ts:13`) and Mapterhorn tiles (`terrain.ts:7`).
- Key dependencies: react 19.3.0, vite 8.3.0, typescript 6.0.3, zod 4.6.5, zustand 5.0.15, immer 11.1.18, maplibre-gl
  6.9.1, flexlayout-react 0.11.0, ag-grid 36.1.0, echarts 6.1.0, react-aria-components 1.21.1, vitest 5.0.0,
  @playwright/test 1.63.0. No HTTP or SignalR client.
- `dist/` (built 2026-11-04, match with HEAD unconfirmed) is about 6.0 MB raw; the largest chunk
  `DemoSwitch-*.js` is 3.29 MB raw, 0.95 MB gzip (contents unconfirmed); `maplibre-gl-*.js` 1.06 MB; `viewer-*.js`
  11 KB.

## 11. Tests over the seam

56 unit test files, 31 e2e specs. Through `src/testing/testProject.ts`: `src/app/service/projectClient.test.ts` (local
vs server commands, `project_changed`, run lock, field rejection, faults, offline catch-up, hold, job behaviours,
drafts-only undo, save and restore, fixtures, URL conditions), `src/server/jobs.test.ts` (held items, retry, publish,
edit lock, idempotency, cancel race, FIFO), `projectSession.test.ts`, `projectLifecycle.test.ts`, `handover.test.ts`
(403 `view_only`), catalog, schema, file, and fixture tests, agent and service tests. E2E over the seam:
`demo-conditions`, `robustness`, `project-lifecycle`, `jobs`, `viewer`, `save-as`, and `production` (built bundle
under the base path). `e2e/test.ts` forces latency `none`.
