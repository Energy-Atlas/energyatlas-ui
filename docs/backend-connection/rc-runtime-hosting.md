# RC `EnergyAtlasWeb` runtime, hosting, and existing clients

Date: 2026-11-08. RC at `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`, `feature/archetype-library-schedule-registry`
= `main26` = `7464c140`; `D:/energyatlas-mcp` at `main` `1b7e598` (2026-11-01). Both read only; nothing built, run,
or copied. Paths are relative to the RC root unless they start with `D:/`. Credentials found are named by location
only. Part of the [backend connection evidence index](README.md).

## 1. Startup and configuration

- `EnergyAtlasWeb/Program.cs:12-23` calls `WebAppFactory.Build(args, urls, localExecutionMode:false)` then `Run()`.
  `EnergyAtlasWeb/WebAppFactory.cs:40-208` is the one builder, shared with the desktop host. .NET 8 Sdk.Web; packages
  Newtonsoft MVC 8.0.0, Swashbuckle 6.5.0, DuckDB.NET, NTS GeoJSON and VectorTiles.
- Ports (`Program.cs:8-54`, `PortUtils.cs:19-81`): HTTP 5094 and HTTPS 7200, sweep of 10; `ASPNETCORE_URLS` is
  honoured but each port still moves silently to +1..+10 if busy. The only signal of the bound URL is the stdout line
  `[EnergyAtlasWeb] Listening on {u}`. `launchSettings.json` profiles set `ASPNETCORE_ENVIRONMENT=Development`.
- Middleware (`WebAppFactory.cs:151-182`): `UseSwagger` and `UseSwaggerUI` (`/api-docs`,
  `/swagger/v1/swagger.json`, not gated by environment) → `UseDefaultFiles` (`/` serves `wwwroot/index.html`) →
  `UseStaticFiles` (no-cache headers in Development) → `MapControllers` → `MapHub<JobHub>("/jobHub")`,
  `MapHub<WorkflowProgressHub>("/workflowProgressHub")`.
- Absent (grep over `EnergyAtlasWeb/**/*.cs`): CORS, authentication and authorization, SPA fallback (`MapFallback*`,
  `UseSpa`), HTTPS redirection, HSTS, exception handler, `AddProblemDetails`. `AllowedHosts` is `*`.
- JSON: MVC uses `AddNewtonsoftJson` plus `StringEnumConverter` (`:76-80`); camelCase property names inferred from the
  framework default (not observed); enums as declared PascalCase names. SignalR uses `AddSignalR()` only (`:90`), so
  System.Text.Json defaults: camelCase and **numeric** enums (the JS tests `signal.type === 4`,
  `wwwroot/js/jobConsole.js:136-178`). The REST job route returns `type` as a string
  (`SimulationController.cs:262`). `Project.json` uses its own serializer (`Models/ProjectData.cs:98-111`). `NaN` is
  serialised as `"NaN"` (MCP issue B11).
- Request limits 2 GB (`:84-88`).
- `ExecutionMode`: `appsettings.json` `"browser"`; `localExecutionMode:true` forces `"local"` (`:59-62`). Read in
  `GUIJobRunnerController.cs:64,168,454`. `GET /api/config` returns `{executionMode, mapboxToken, libraryVersion,
  libraryInformationalVersion}`; pages bootstrap it through `wwwroot/js/config.js` (`window.APP_CONFIG`,
  `window.appConfigReady`). It decides whether files are server paths (local) or uploads (browser).
- Configuration key names: `Logging:LogLevel:*`, `AllowedHosts`, `ExecutionMode`, `Results:AggregateRowLimit`,
  `Mapbox:Token` (a literal value is in `EnergyAtlasWeb/appsettings.json` and is served by `/api/config`). Environment
  variables: `ASPNETCORE_URLS`, `ASPNETCORE_ENVIRONMENT`, `ENERGYATLAS_SKIP_SAMPLE_PRELOAD`,
  `ENERGYATLAS_PROJECT_SAVE_CRASH_AT` (test seam), `ENERGYATLAS_CAP_*`, tiled-preprocess roots,
  `ENERGYATLAS_LIBRARY_DIR`. A background `SampleDataLoader` fetches from GitHub at startup unless skipped
  (`:186-205`).

## 2. Error model

- `Runtime/ApiErrors.cs`: `Body(code, message, extra)` → `{success:false, message, code, …extra}` (`:17-29`);
  `WithError` adds `error` (`:32-37`); `ApiRequestException(code, message)` (`:68-73`); `InvalidModelState` (`:49-64`,
  wired at `WebAppFactory.cs:74-75`) → 400 `{success:false, message, code:"invalid_request", error, title, status,
  errors, traceId}` as `application/json`, not `application/problem+json`.
- `Runtime/ProjectEditGate.cs`: 409 `{success:false, message, code:"run_in_progress", jobId, kind}` with `kind` in
  `population`, `zone`, `zone-batch` (`:25-26`); global `ProjectEditFilter` (`:98-184`) with mutation routes
  (`:107-141`) and run routes (`:147-148`); `create`, `open`, `close` are not blocked by the holder (`:146,167`); 409
  `project_changed` if the session swapped while waiting (`:168-171`). `GET /api/project/editStatus` →
  `{blocked, reason, code, jobId, kind}` (`ProjectController.cs:54-68`).
- Other codes (sample): `project_exists` (409), `project_not_found` (404), `no_project`, `missing_folder`,
  `unknown_job`, `job_terminal`, `job_running`, `weather_required`, `weather_not_found`, `validation_failed`,
  `invalid_options`, `invalid_calendar_year`, `no_features_selected`, `invalid_shading`, `internal_error`,
  `session_closed` (`SimulationController.cs:150-252`); `entry_name_required`, `invalid_sidecar`, `sidecar_in_use`,
  `no_sidecar`, `unknown_run`, `invalid_scenario_id`, `rule_without_conditions`, `transform_not_supported`,
  `entry_not_loaded` (`Connectors/python/AGENTS.md:25,194-200`).
- Inconsistencies: `ProjectController.Save` and `Open` return `{success:false, error}` without `code`
  (`:188,239-240`); `SetStatus` and `SetData` return the bare string `"No project loaded"` (`:252,264`); no exception
  handler, so Development returns the HTML developer page and other environments an empty 500 (MCP issues B5, B8).

## 3. Jobs and SignalR

- `Runtime/JobRuntimeState.cs`: `JobStatus` `Created`, `Running`, `Completed`, `Failed`, `Cancelled` (`:9-16`);
  fields `JobId`, `JobName`, `Status`, `StartedAt`, `FinishedAt`, `Error`, `Signals` (last write wins per id, ordered),
  `Logs`, structured progress (`StampProgress`, `OrderedProgress`, sequenced per job), cancellation fields,
  `Completion`, `LogPath`, `OutputJson`, `Artifacts`. Terminal states are one-way (`TrySetTerminal`, `:122-142`).
  `Runtime/JobExecution.cs:39-68`: `OperationCanceledException` → Cancelled, other exceptions → Failed.
- Store: static `JobStore` → `ProjectSession.Current.Jobs` (`Runtime/JobStoreState.cs`). **In memory, scoped to the
  open project session**; create, open, or close cancels them ("the project was closed"), waits up to 30 s, clears
  them (`Runtime/ProjectSession.cs:162-252`); a later poll returns 404. Release routes exist for zone and calibration
  jobs, not for population jobs (MCP issue B10). One population, zone, or zone-batch run at a time (edit gate,
  `SimulationController.cs:169-170`); other jobs start in `Task.Run`.
- Durable artifacts: `Reporting/SignalRJobReporter.cs:71-77,137-191` writes `job-progress.json` and `run.log` only when
  given an output directory (voxel-shading routes). Population results go to `<project>/Simulations/{jobId}/`.
- `/jobHub` (`Hubs/JobHub.cs`): client invokes `JoinJob(jobId)` (group = job id); on join it replays logs as
  `jobEvent {type:2, message, id}`, then stored signals as `jobEvent`, then progress snapshots as `jobProgress`. Live
  sends from `SignalRJobReporter.Report` (`:80-135`) to `Clients.Group(jobId)` in order; above 256 pending sends, live
  pushes are dropped (state stays in `JobRuntimeState`).
- `/workflowProgressHub` (`Hubs/WorkflowProgressHub.cs`): no methods, no groups, `Clients.All`; client method
  `workflowProgress` with `{stepId, type:"progress"|"indeterminate"|"done"|"error", fraction?, message}` (`:30-72`);
  sent by the TemplateAssignment, SchemaMatching, Fusion, and GeometricPreprocessing controllers.
- Payloads (`EnergyAtlasCore/Job/`): `JobSignal {id, type, done?, percent?, message?, structuredProgress?}`,
  `JobSignalType` Binary 0, Progress 1, Log 2, Warning 3, Exception 4, StructuredProgress 5 (`Job.cs:11-47`),
  completion text `"JOB COMPLETED."`; `JobProgressSnapshot {schemaVersion:2, jobId, sequence, progressId, parentId,
  stage, phase, unit, completed, total?, succeeded, failed, reused, state, currentItem, message, timestampUtc}`
  (`StructuredProgress.cs:7-34`). Clients parse message prefixes `CHARTS:` and `BUILDING_BUNDLE:`
  (`Connectors/python/src/energyatlas/client.py:1238-1243`).
- REST polling: `GET /api/simulation/job/{jobId}?maxSignals=` (0..500) (`SimulationController.cs:242-280`);
  `/api/voxelShading/job/{jobId}` GET and DELETE; `/api/jobList`.

## 4. Project persistence

- One project per process: `ProjectController.CurrentProject => ProjectSession.Current.Project` under a static lock
  (`ProjectController.cs:22-37`); the API tests state "single-project / single-process"
  (`tests/suites/EnergyAtlasWeb.ApiTests/ApiTestInfra.cs:10-12`).
- `<folder>/Project.json`, `formatVersion` 2, other versions rejected (`Models/ProjectData.cs:38,121-140`): fields
  `projectName`, `projectFolder`, `createdUtc`, `modifiedUtc`, `workflowStates{id:{id,status,userData}}`,
  `zoneDefinitions[]`, `calibratedBuildings{}`. `WorkflowItemStatus`: NotStarted, Complete, Running, Skipped, Future.
- Folder layout (`ProjectData.cs:56-75`): `UserData/{Archetypes/{constructions,systems,energyloads,externalloads},
  PrivateSchedules,Shading,Rulesets,Scenarios,RetrofitMeasures,Weathers,FuelData,ScratchArtifacts}`, `UserUploads`,
  `UserCache`, `Simulations`; also `UserData/ScratchArtifacts/*.geojson`, `UserData/Scenarios/Definitions/{id}.json`,
  `UserData/Shading/sunlit.duckdb`, `.calibration-scratch/`.
- Transactional save (`Utilities/ProjectSaveTransaction.cs`): `.project-save-journal`, `Project.json.generation-tmp`,
  `.project-save.lock` with `FileShare.None` (`:43-49`); open returns `recovery`.
- No autosave timer; many routes save as a side effect (workflow status and data, fusion, geometric, schema matching,
  template assignment, simulation). Close saves; open and create do **not** save the outgoing project (MCP issue B1).
- Recent projects: `%APPDATA%/EnergyAtlas/recent-projects.json`, written by `EnergyAtlasWeb/Utilities/
  RecentProjectsStore.cs:113-118` and `EnergyAtlasDesktopEto/RecentProjectsStore.cs:149-154`. No list endpoint found.
- Workflow item ids (`ProjectController.cs:1417-1445`, mirrored in `wwwroot/js/progressSidebar.js:139`): Setup
  `project-setup`, `geospatial-data-upload-fusion`, `working-feature-collection`, `schema-match-compulsory`,
  `building-footprints-post-compulsory`, `geometric-preprocessing`, `building-footprints-post-geometry`; Model
  `load-archetypes`, `edit-archetypes`, `archetype-assignment-tool`, `simulation-ready-footprints`; Simulation
  `run-simulation`, `calibrate-baseline`, `calibrated-baseline`; Scenarios `load-retrofit-measures`,
  `design-retrofit-measures`, `scenario-designer`, `scenario-results`; Results `result-overview`, `result-viewer`.

## 5. The front end RC serves today

- Static HTML and plain JS in `wwwroot/`; no build, no `package.json`, no npm targets
  (`docs/layers/08-web-frontend.md:217`, `docs/flows/flow-gui-workflow.md:10`). Top-level pages include `index.html`,
  `menu.html`, `job.html`, `jobList.html`, `jobRunner.html`, `resultViewer.html`, `capResultViewer.html`,
  `scenarioDesigner.html`, `schemaMatching.html`, `templateAssignment.html`, `archetypeEditor.html`,
  `measureEditor.html`, `geoDataPreview.html`, `buildingDownloader.html`. `wwwroot/workflow-pages/` has `setup/` (7
  plus 8 legacy), `model/` (4), `simulation/` (2), `retrofit-scenarios/` (11), `results-view/overview.html`.
- Shared JS: `js/statusBar.js` and `js/progressSidebar.js` (each in 35 pages), `js/config.js`,
  `config/resultViewerDashboards.json`.
- Same-origin relative `fetch('/api/...')` written inline per page; no shared API client. `statusBar.js` subscribes to
  `/workflowProgressHub` with automatic reconnect (`:503-547`). CDN libraries: `@microsoft/signalr` 7.0.5, Plotly
  2.32.0, mapbox-gl 2.15.0 and 3.1.2, chroma-js 2.4.2. Job SignalR clients: `js/jobConsole.js:126-214`,
  `jobRunner.js:1137-1141`, `runSimulation.js:396-399`.

## 6. Desktop host `EnergyAtlasDesktopEto`

- `Program.cs:17-76`: sets `ASPNETCORE_ENVIRONMENT=Development` if unset, picks free ports, calls
  `WebAppFactory.Build(args, urls, localExecutionMode:true, contentRootPath:AppContext.BaseDirectory)`, starts Kestrel,
  resolves the bound URL **preferring HTTPS** (`:78-97`), runs `MainForm(backendUrl)`, stops Kestrel on exit. Targets
  `net8.0-windows10.0.17763.0`, WPF, Eto 2.8.0, WebView2 1.0.2792.45; copies `..\EnergyAtlasWeb\wwwroot\**` and
  `appsettings*.json` into its output. The MAUI `EnergyAtlasDesktop/` is retired (`docs/layers/09-desktop.md:5-7`).
- `MainForm.cs`: loads `{backendUrl}/index.html` (`:94-98`); cancels navigation to anything but localhost or loopback
  (`:527-557`); injects `BridgeScript` on every `DocumentLoaded` (`:534-544`).
- Native bridge (custom URL scheme, not `postMessage`): `window.MauiFilePicker.pickFile({extensions})`, `pickFiles`,
  `pickFolder`, `pickDirectory()`, each a Promise (`:63-68`); a call sets `window.location.href =
  'maui://{op}?id=…&ext=…'` (`:53`) with a 120 s timeout; the host intercepts `maui` in `DocumentLoading`
  (`:519-525`), handles `pickfile`, `pickfiles`, `pickfolder`, `pickdirectory`, `refreshrecent` (`:619-724`), one
  picker at a time, and replies with `window.__mauiResolve(id, JSON.parse(atob(b64)))` or `window.__mauiReject(id,
  msg)` (`:661,716-718,838-844`). Pages feature-check `window.MauiFilePicker`.
- Menu scripts run in the page (`:104-226,440-479`): New fetches `/api/project/close` and navigates to
  `/workflow-pages/setup/project-setup.html`; Open and Open Recent POST `/api/project/open` with `{projectJsonPath}`
  then navigate to hard-coded `/workflow-pages/setup/*.html`; Close goes to `/menu.html`; Save POSTs
  `/api/project/save`; other items go to `jobList.html`, `menu.html`, or hash routes (`:279-351`). _Interpretation:_ a
  new UI inside this host would need these menu paths changed or kept working.

## 7. Python connector (`Connectors/python`, `energyatlas` 0.3.1)

- Discovery (`src/energyatlas/discovery.py`): `ENERGYATLAS_BASE_URL`, then a `psutil` scan for `EnergyAtlasWeb` or
  `EnergyAtlasDesktopEto` listeners, then ports 5094–5104 and 7200–7210; health probe `GET /api/project` must return
  JSON with `loaded`.
- Launch (`src/energyatlas/backend.py`): `ASPNETCORE_URLS=http://127.0.0.1:{port}`, Development by default; the
  published exe (`ENERGYATLAS_BACKEND_EXE`) or `dotnet run --project EnergyAtlasWeb/EnergyAtlasWeb.csproj
  --no-launch-profile`; on Windows a kill-on-close job object.
- Transport (`_http.py`): synchronous `httpx`, 120 s timeout, `verify=False`; errors read from `error`, `message`,
  `Message`, or `Error` (`:303-337`).
- Canonical order (`WorkflowOrchestrator.run_full_lifecycle`, `src/energyatlas/workflow.py:483-518`):
  - Setup: `GET /api/project`, `GET /api/project/editStatus`, `POST /api/project/close`, `POST /api/project/create`
    (on 409 `project_exists`, `/open`), `POST …/workflow/geospatial-data-upload-fusion/persist-files`,
    `POST /api/project/fusion/run` and `GET …/artifact`, `POST /api/schemaMatching/saveRules`,
    `POST /api/project/schemaMatch/complete`, `POST /api/project/geometricPreprocessing/run` and `GET …/artifact`.
  - Model: `POST /api/project/archetypes/load`, `GET /api/templateAssignment/defaultRules`, `POST …/evaluate`,
    `POST …/complete`.
  - Scenarios: `POST /api/project/measures/load`, `POST /api/scenarioDesigner/evaluate`, `…/saveScenario`,
    `…/saveLibrary`.
  - Simulation: `POST /api/weather/loadFromDisk` or `/importSample`, `GET /api/weather/listEntries`,
    `POST /api/simulation/preflight`, `POST /api/simulation/run`, poll `GET /api/simulation/job/{id}`.
  - Results: `POST /api/simulation/job/{id}/export`, `GET /api/dataHub/fetchFeatureCollection`.
  - Steps marked with `POST /api/project/workflow/{id}/status`. `examples/end_to_end.py:124-412` adds zones and result
    summaries and mirrors `Examples/EndToEndViaApi.cs`.
- Waiting: simulation, calibration, and zone jobs are polled over REST (simulation every 2 s, `client.py:1204-1266`);
  voxel shading uses `/jobHub` via `signalrcore`, reconciles with REST snapshots by sequence, and falls back to polling
  (`voxel_progress.py:69-181`).

## 8. `D:/energyatlas-mcp`

`main` at `1b7e598` (2026-11-01), clean. `energyatlas-mcp` 0.1.2, Python ≥ 3.11, depends on `energyatlas>=0.3.1`,
`mcp>=2.3,<3`, `psutil`, `starlette`, `uvicorn`. Transport stdio or streamable HTTP on loopback. Tools: archetypes,
calibration, datahub, inputs, project, results, scenarios, simulation, weather, zones, plus resources, prompts, and
scoring. Reaches the backend only through the Python connector (`runtime.py:66-105`): starts its **own** backend or
attaches to `--backend-url`, never reuses a discovered one (it may hold the desktop app's project), checks the
listener is its own child, handshakes via `GET /api/config` (`libraryVersion` ≥ 0.2.0), timeout 600 s. One workspace
↔ one project ↔ one backend process. `docs/plans/2026-11-01-rcenergysimulator-issues.md` lists B1–B12 and C1–C4.
No front-end, React, or SPA mentions in its docs.

## 9. API tests (`tests/suites/EnergyAtlasWeb.ApiTests`)

MSTest with `WebApplicationFactory<Program>`, serial (`DoNotParallelize`), `POST /api/project/close` before each test
(`ApiTestInfra.cs:12-43`). The top-level `EnergyAtlasWeb.ApiTests/` holds only stale build output. Pipeline helper
`WorkflowPipeline.cs:40-122`. Test methods per file: SimulationWorkflowSequence 24, BuildingCalibrationEndpoint 23,
SimulationEndpoint 19, ProjectOwnership 15, SchemaMatchEndpoint 14, TemplateAssignmentEngine 13, ArchetypeEdit 12,
ProjectLifecycleEndpoint 11, WeatherEndpoint 11, ZoneDefinitionApi 11, ZoneJobRelease 10, ProjectArchetypeManifest
9, ProjectCancellation 8, ZoneCalibrationEndpoint 8, ArchetypesLoadEndpoint 7, ProjectReadsEndpoint 7,
ScheduleRegistryEndpoint 7, ProjectShadingEndpoint 6, ScenarioDesignerEndpoint 6, DataHubEndpoint 5,
ProjectArchetypes 5, ProjectRegistries 5, ArchetypesLoadIdempotency 4, ProjectSession 4, ProjectWorkflowEndpoint 4,
SignalRJobReporter 3, CalendarEndpoint 2, ProjectStoredIdentity 2, AcceptedCalibrationRun 1, ConfigEndpoint 1,
MeasuresLoadEndpoint 1, VoxelShadingCapabilitiesEndpoint 1. These are executable contract evidence.

## 10. RC documentation worth reading

- API: `docs/api/api-reference.md` (claims authority; "16 controllers / 201 endpoints", 2026-06-30),
  `docs/api/api-call-sequences.md` (the five-stage workflow as ordered calls for GUI, connector, future CLI),
  `docs/api/api-audit.md`, `docs/llm-api-docs/web-api-reference.md` and `python-reference.md` (generated 2026-10-17
  from `feature/mcp` `054e7e10`), `EnergyAtlasWeb/Planning/APIReference/Agent/*` (older baselines).
- Data flow and layers (drafts): `docs/data-flow/s09-rest-signalr.md` (front-end and backend contract),
  `s11-frontend-hosts-engine.md` (Eto and Grasshopper hosts), `s08-controllers-jobs-datahub.md` (historical);
  `docs/layers/07-web-api-backend.md`, `08-web-frontend.md`, `09-desktop.md`, `12-python-connector.md`;
  `docs/issues/drafted/07-*`, `08-*`, `09-*`, `12-*`; `docs/flows/flow-gui-workflow.md` (historical).
- `docs/20260920-examples-api-gap-report.md`: what the API cannot do compared with native C#.
- MCP plans: `docs/superpowers/plans/2026-10-13-mcp-stage0*.md`, `2026-10-16-mcp-stage0c*.md`.
- Not found: any RC or MCP plan to replace the UI, any React, TypeScript, or SPA design, or any mention of
  `energyatlas-ui` (case-insensitive grep of `docs/` for `react|typescript|single-page|spa|vite`).

## Unconfirmed

Exact JSON casing per MVC response (inferred), HTTPS dev-certificate behaviour inside WebView2, and the full contents
of `docs/data-flow/s09` and `s11`.
