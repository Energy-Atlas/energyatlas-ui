# Backend connection: evidence index

Date: 2026-11-08. Prepared at the owner's request ("we will be preparing for this to be connected with the
EnergyAtlas connector ASP.NET backend") as indexing work only: it gathers evidence so that architecture and
implementation plans can be decided separately. **Nothing here is a decision.** Observed facts carry source paths;
interpretations are marked _Interpretation_. No reference repository was built, run, fetched into, or modified.

The "EnergyAtlas connector ASP.NET backend" is read here as RC's `EnergyAtlasWeb` (.NET 8, Kestrel), which the Python
connector `Connectors/python` (package `energyatlas`) and `D:/energyatlas-mcp` call over HTTP. If another backend was
meant, this index needs redoing.

## Files

| File | Contents |
| --- | --- |
| This file | Repository and remote status, governing decisions, concept mapping, contract mismatches, open decisions, documentation drift, verification |
| [ui-seam.md](ui-seam.md) | This app's mock-server seam: transport, request and reply types, every server command, state model, persistence, jobs, tests |
| [rc-api-surface.md](rc-api-surface.md) | `EnergyAtlasWeb` HTTP API by controller and domain, main DTOs, project scoping, uploads and downloads, OpenAPI, geometry endpoints |
| [rc-runtime-hosting.md](rc-runtime-hosting.md) | `EnergyAtlasWeb` startup and middleware, JSON, error model, jobs and SignalR, persistence, `wwwroot`, the Eto desktop host and its bridge, the Python connector, `energyatlas-mcp`, API tests, RC docs |

## 1. Repository and remote status (2026-11-08)

### This repository (`D:/energyatlas-ui`, remote `https://github.com/Energy-Atlas/energyatlas-ui.git`)

Observed after `git fetch --all --prune`:

- `master` at `c49dcff` (2026-10-30) is **66 commits ahead of `origin/master` and 0 behind**. `origin/master` is
  `710880b` ("docs: record the decision 0029 integration"). Decisions 0030 to 0036 and all six next stages exist only
  locally. The working tree is clean.
- GitHub Pages publishes `master` (decision 0017). The run for decision 0029 (2026-10-27, run `40603276661`) failed
  in its browser tests, so the published demo was last deployed on 2026-10-20.
- **Update, same day:** at the owner's request `master` was pushed to `origin/master` (`710880b..9b75c0d`), which
  started a new Pages run. The planning agent starts from the
  [planning handoff](../20261108_backend-connection-planning-handoff.md).
- Every local branch is contained in `master` except `feature/agentic` (5 commits: the language-model agent, four
  fictional districts, reload survival, decision 0020), which decision 0022 keeps unmerged.
- Remote branches: `master`, `feature/agentic`, `feature/basemap`, `feature/mock-services`, `feature/ui-alignment`,
  `codex/jobs-design`, `claude/ui-alignment-updates-2de5e1`. All except `feature/agentic` are contained in `master`.
  No remote branch is newer than local work.
- Worktrees under `.claude/worktrees/`: `agent-a0e33b014cc9a7ada` (`claude/0036-views-dialogs`),
  `autonomous-roadmap-slices-9210de` (`claude/next-stages`), `map-zones-0036` (`claude/0036-map-zones`),
  `ui-alignment-updates-2de5e1` (`feature/mock-services`). All their branches are merged; two have only an untracked
  `.claude/` folder.
- `dist/` (ignored) was built 2026-11-04, after `c49dcff`; whether it matches HEAD is unconfirmed.

### Reference repositories

- **RCEnergySimulator** (`C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`): checked out at
  `feature/archetype-library-schedule-registry` = `7464c140` (2026-10-21, "Merge pull request #241 … feature/mcp"), with
  no working-tree changes. `git ls-remote` (read-only, 2026-11-08) shows all 36 remote heads equal to the local
  remote-tracking refs, so **RC has had no new pushes since 2026-10-21**. New fact not in earlier records: **`main26`
  points at the same commit `7464c140`** and contains `main24`; `origin/HEAD` still names `main24` (`f86f1849`,
  2026-06-06). Which branch the RC team now integrates on is not confirmed.
- **energyatlas-mcp** (`D:/energyatlas-mcp`): `main` at `1b7e598` (2026-11-01), clean. Its
  `docs/plans/2026-11-01-rcenergysimulator-issues.md` lists backend issues B1–B12 and connector issues C1–C4 that bear
  directly on any new client (see section 5).

## 2. Decisions that govern the connection

- **[0022](../decisions/0022-backend-connections-inside-rc.md):** no real connections in this repository; they are
  built inside RC so UI and API change together and the Eto host serves the UI. Where inside RC is **not decided**
  (recommendation at the time: a sibling `EnergyAtlasWeb/ClientApp` built into `wwwroot/app/`). Connecting from this
  repository through a dev-server proxy was proposed and **not chosen**. Starting the connection therefore needs a new
  decision that confirms, amends, or supersedes 0022.
- **[0023](../decisions/0023-mock-server-and-fixture-picker.md):** the mock server owns the project behind an
  asynchronous transport, uses RC's error body and 409 `run_in_progress`, RC's job states, and drafts-only undo. "In
  RC the mock is replaced by an HTTP and SignalR client; the UI does not change."
- **[0036](../decisions/0036-owner-review-of-next-stages.md):** zones are backend geometry the browser only displays;
  Archetypes, Scenarios, Calibration, and Schema matching are deferred until the backend connection.
- **[Pre-connection roadmap](../pre-connection-roadmap.md) §4:** real sign-in, generated API types, live SignalR
  progress, and native file pickers are deferred to the connection.

## 3. Concept mapping: UI to RC

Facts from the appendices; the "Fit" column is _Interpretation_.

| UI concept (this repo) | RC counterpart (`EnergyAtlasWeb`) | Fit |
| --- | --- | --- |
| Multi-project browser catalog with stable project ids (`eaui.projects.v1`), `project.list/create/open/close/save/saveAs/openFile` | One project per process, identified by folder (`Project.json`, format 2); `POST /api/project/create\|open\|save\|close`; no project id anywhere; recent list in `%APPDATA%/EnergyAtlas/recent-projects.json` with no list endpoint found | Gap: catalog, ids, Save as, and list need a mapping or new endpoints |
| `projectGeneration` and 409 `project_changed` | `ProjectEditFilter` returns 409 `project_changed` if the session swapped while a request waited | Close match |
| Model changes refused during a run: 409 `run_in_progress` with `jobId`, `kind` | Same body from `ProjectEditGate`; `GET /api/project/editStatus` | Match; the UI drops `jobId`, `kind`, `code` in `issuesFromError` |
| Error body `{success:false,message,code,errors?,traceId?}` | Same for coded routes; older routes return `{error}` or a bare string; no exception handler (HTML dev page or empty 500) | Partial: client must normalise |
| Server pushes **full state snapshots** with a `sequence` that replies also carry; client waits for the matching push | No state push; `/jobHub` (per job group: `jobEvent`, `jobProgress`) and `/workflowProgressHub` (broadcast `workflowProgress`); REST reads per resource | **Largest gap**: state sync and ordering need a design |
| 12 workflow stages with derived states (ready, stale, blocked…), revisions, input signatures | 20 workflow item ids in 5 groups, status `NotStarted/Complete/Running/Skipped/Future`, free-form `userData`, set by `POST /api/project/workflow/{id}/status` | Gap: different stage sets; RC has no staleness or signatures |
| Jobs: run groups, held item results, failed-item retry (`retryBlocker`), FIFO queue, job history saved with the project | Jobs in memory, per project session, cancelled on swap; one population/zone run at a time; no retry route; REST polling or `/jobHub`; states `Created/Running/Completed/Failed/Cancelled` | Partial: states map; retry, held results, history have no counterpart |
| Buildings from a bundled OSM fixture; manual overrides via `edits.apply` | GeoJSON DataHub entries passed by `entryName`, `*_ESL` attribute names; edits by `replaceArtifact` uploads | Gap: no per-building edit route found (unconfirmed) |
| Data intake and fusion by stable source id | Geometric fusion (`/api/project/fusion/run`) over uploaded or server-path GeoJSON | Different matching model (recorded in [RC observations](../roadmap-rc-observations.md)) |
| Schema matching mapping review, rule sets, suggestions | `/api/schemaMatching/*` (autoMatch, saveRules, loadRules), `/api/project/schemaMatch/complete` | Close in shape |
| Archetypes with four parts, assignment rules | Four part categories keyed by GUID; `/api/templateAssignment/evaluate\|complete`, rules with priority, conditions, formula | Close; UI lacks formula rules and numeric priority |
| Schedules (day types, week) | `/api/schedules` (list, get, validate), `ScheduleRecipe` | Read and validate only; no save route found |
| Measures (4 categories), scenario rules, adoption at aggregation | 7 categories; `/api/scenarioDesigner/*`; results export, summary, aggregate take `penetration{versionKey, fraction, seed}` | Close in spirit; category count differs |
| Calibration fit, adopt, revert | `/api/calibration/run\|evaluate\|accept`, `DELETE /api/calibration/accepted/{featureId}` | Close |
| Results: published only, drill-down, CSV | Per-job DuckDB; `/api/simulation/job/{id}/summary\|aggregate\|buildings\|outcomes\|export\|database` | Close; RC richer |
| Zone geometry displayed in 3D (decision 0036) | `/api/zones*` return counts and attributes only; **no endpoint serves zone or floor polygons** (`ZoneCalibrationController.cs` `DescribeZone`, around line 1257) | **Gap**: the UI's main 3D zone feature has no backend source |
| Saved view: table settings, map layers, layouts, camera | Nothing; `Project.json` `workflowStates[].userData` is free-form | Gap: storage place undecided |
| Save as view, handover packages, `viewer.html` | Nothing | Gap |
| Demo conditions, fixtures | Not applicable | Dev and test only |
| Agent tools through the same client; `feature/agentic` unmerged | `energyatlas-mcp` reaches the backend through the Python connector, starts its own backend, never attaches to a desktop one | Two agent paths exist; relationship undecided |
| File picking (deferred) | Browser mode uploads multipart; local mode sends server paths and uses the Eto bridge `window.MauiFilePicker.*` over a `maui://` scheme with `window.__mauiResolve/__mauiReject`; `GET /api/config` returns `executionMode` | Interface defined by RC; UI must support both |

## 4. Hosting facts that constrain any plan

- `EnergyAtlasWeb` serves `wwwroot` with `UseDefaultFiles` and `UseStaticFiles`, **no SPA fallback, no CORS, no
  authentication**; Swagger is on in every environment (`/swagger/v1/swagger.json`, UI at `/api-docs`). `wwwroot/`
  already has its own `index.html` at `/`.
- Ports 5094 (HTTP) and 7200 (HTTPS) with a silent sweep of +10; the Eto host prefers HTTPS and runs with
  `ASPNETCORE_ENVIRONMENT=Development` unless set.
- REST JSON is Newtonsoft (camelCase inferred, enums as PascalCase strings); SignalR uses System.Text.Json defaults,
  so hub enums are **numbers**; `NaN` is serialised as the string `"NaN"` (MCP issue B11).
- The Eto host cancels navigation to anything but localhost; whether fetches to OpenFreeMap and Mapterhorn tiles work
  inside it is unconfirmed (they are requests, not navigations). The developer guide records that loading the bundle
  in the ASP.NET or Eto host is unverified.
- This app builds two entries (`index.html`, `viewer.html`) under a configurable base path (`basePath.ts`,
  `EAUI_BASE_PATH`), copies MapLibre's worker files, and has no HTTP or SignalR client dependency
  (`package.json`). Adding one needs a package decision (`AGENTS.md`).
- RC has no npm build anywhere (no `package.json` outside a test virtual environment); its pages load
  `@microsoft/signalr` 7.0.5 from a CDN.
- `appsettings.json` in RC contains a literal Mapbox token that `GET /api/config` returns to clients. This app does not
  use Mapbox. The value is not reproduced here.

## 5. Known backend issues relevant to a new client

From `D:/energyatlas-mcp/docs/plans/2026-11-01-rcenergysimulator-issues.md` (read, not verified): open or create does
not save the outgoing project (B1); port moves give no instance id; unhandled exceptions return HTML 500 pages (B5,
B8); inconsistent error bodies; population jobs have no release route (B10); `NaN` as a string (B11). RC's own
`docs/api/api-reference.md` says "16 controllers / 201 endpoints", last updated 2026-06-30, while 23 controller
classes exist now, so it is partly stale.

## 6. Decisions the plan will need (open questions, not answered here)

1. Does the connection follow decision 0022 (UI moves into RC), or is 0022 amended (for example a typed API client
   and Vite proxy developed here first)? If inside RC, where, and on which RC branch (`main26` and the feature branch
   are the same commit today)?
2. State synchronisation: how the UI's snapshot-and-sequence model maps onto RC's per-resource REST and per-job hubs
   (client-side assembly, a new project-state endpoint or hub, or a change to the UI's model).
3. Project identity: how the browser catalog, project ids, Save as, project files, and recent projects map onto
   folder-scoped single-project sessions.
4. Workflow: reconcile 12 UI stages with RC's 20 workflow items, and whether staleness and input signatures stay
   client-derived.
5. UI features with no RC counterpart: saved views and layouts, handover packages and the viewer, job history and
   retry, held results, per-building overrides, zone polygons. For each: new RC endpoint, local-only, or dropped.
6. API types: Swagger exists but many bodies are hand-read `JObject`s; generated types would be partial.
7. The agent: how the in-app agent relates to `energyatlas-mcp` and `feature/agentic`.
8. Which decision 0036 deferrals (Archetypes, Scenarios, Calibration, Schema matching) come back first.
9. Whether to push local `master` (66 commits) before connection work starts; nothing has been pushed since
   decision 0029.

## 7. Documentation drift found in this repository

Observed while indexing; not fixed here.

- `docs/README.md` and the header of `docs/developer-guide.md` still say the next-stages work is "not merged"; it was
  fast-forwarded into local `master` on 2026-10-30.
- `AGENTS.md` describes "overrides are `state.zoning.overrides` … drawn outlines are `state.zoning.drawn`"; the
  current model is `zoning{geometry, published}` and `projectSchema.ts` strips the legacy fields (decision 0036).
- The developer guide lists `eaui.layouts.v1` and `eaui.viewer.layouts.v1:<id>` storage keys; no code in `src/`
  references them (personal layouts were removed by decision 0033).
- The developer guide says only geospatial preprocessing has item-level work; `ITEM_STAGES` in
  `src/domain/jobs/runGroups.ts` also includes archetypes and scenario modeling.
- `AGENTS.md` still names `../RCEnergySimulator` as the reference path; on this machine it is
  `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator` (already recorded in decision 0022).

## 8. Verification on 2026-11-08

On `master` at `c49dcff`, Node 24.21.0:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 585 passed in 56 files |
| `npx eslint . --ignore-pattern '.claude/**'` | Passed |
| `npm run lint` and `npm run format:check` as written | **Fail**, only on files under `.claude/worktrees/` (four nested worktree checkouts that neither ESLint nor Prettier ignores; Prettier flags each worktree's `back-bay-buildings.geo.json`). The repository's own files pass. Removing the merged worktrees or ignoring `.claude/` would clear it; neither was done here. |
| Browser tests | Not run: this change is documentation only. Last recorded: 134 of 140 dev e2e passed with 6 load timeouts that passed on rerun, and 4 of 4 preview tests ([branch review](../20261029_branch-review.md#verification-2026-10-29-on-the-combined-fixes)). |

## 9. How this index was made

Three read-only searches (this app's seam; RC's API surface; RC's runtime, hosting, connector, and
`energyatlas-mcp`), then spot checks by hand: the remote comparisons above, `DescribeZone` in
`ZoneCalibrationController.cs` (no polygons), the absence of `eaui.layouts.v1` and `zoning.overrides` in `src/` outside
a migration test, the `api-reference.md` header, and `main26`. Line numbers come from those searches and were not all
re-checked; treat them as starting points.
