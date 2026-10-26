# Pre-connection roadmap

Recorded 2026-10-25 at the owner's request, under [decision 0022](decisions/0022-backend-connections-inside-rc.md):
real backend connections are built inside RCEnergySimulator (RC) later, and the demo is refined first. This is the
agreed list of UI work to build and test before any connection. The order is a suggestion; each slice is discussed
before it is built and states what is real, mocked, and deferred, as `AGENTS.md` requires.

The aim is a demo that already behaves as if it had a backend (slow, failing, long-running, persisted), so the move
into RC replaces one mock layer rather than reworking the interface. RC facts below are from
`feature/archetype-library-schedule-registry` at `7464c140` (2026-10-21), read-only.

## 1. Foundation

Status: built on `feature/mock-services` (2026-10-25), as [decision 0023](decisions/0023-mock-server-and-fixture-picker.md)
records. Real: request states, RC-shaped error display, the edit lock, the job lifecycle and logs, and the Demo
conditions picker. Mocked: the server, its storage, the delay, and the faults. Deferred: HTTP, SignalR, sign-in, and
native file pickers.

Reviewed and integrated into local `master` on 2026-10-25, with synchronization and provenance fixes; no push yet.
See the [review and lifecycle discussion](20261025_review-and-project-lifecycle.md) for verification and the pending
step 2 entry-flow alternatives. On 2026-10-26 the owner chose a dedicated start screen ([decision 0024](decisions/0024-dedicated-project-start-screen.md)).
The owner also chose confirmation before cancelling active jobs. The [lifecycle design](project-lifecycle-design.md)
records step 2, reviewed and integrated into local `master` on 2026-10-26 at `4fb94b1`; not pushed.

- **Mock service layer.** Commands finish synchronously in memory today; RC is asynchronous and job-based. One
  interface between the UI and its data adds simulated latency, server errors, rejected input with field errors, and
  conflicts. Resources follow RC's names (project, workflow, jobs) and its error body (`{success, message, code}`
  plus validation errors), so the swap is small. Shapes only: no RC code is copied.
- **Fixture picker.** A known gap: empty, warning, and error states are reached only by walking the workflow. A picker
  sets any surface to empty, loading, slow, warning, error, or offline, for review and for Playwright.

`feature/agentic` is not merged (decision 0022), so this work starts from `master`.

## 2. Workflow surfaces RC has and the demo lacks

| Surface | RC counterpart (`EnergyAtlasWeb`) | Demo today |
| --- | --- | --- |
| Project lifecycle: start screen, open, create, recent, save status, unsaved-changes guard | `workflow-pages/setup/project-setup.html`, `ProjectController` | Integrated into local `master` (decision 0024), with browser-local catalog and confirmed job cancellation |
| Data intake: upload, schema matching, data fusion, with one file-picking interface (browser upload or desktop native picker, both mocked) | `geospatial-data-upload-fusion`, `schema-match-compulsory`, `working-feature-collection`; `SchemaMatchingController`, `FusionController` | Schema matching as a simulated stage |
| Archetypes: library, editor, assignment, schedules | `workflow-pages/model/*`, `archetypeEditor.html`, `templateAssignment.html`; `ScheduleRegistryController` | Planned creators on the Creator page |
| Measures and scenarios: measure library and editor, scenario designer, comparison | `workflow-pages/retrofit-scenarios/*`, `measureEditor.html`, `scenarioDesigner.html` | Dashboard what-ifs |
| Jobs: queue, detail, logs, cancel, retry, partial failure, completion notices | `jobList.html`, `job.html`, `jobRunner.html`; `/jobHub`, `/workflowProgressHub` | Tasks page with simulated runs |
| Calibration: meter data in, calibrated baseline out | `workflow-pages/simulation/calibrate-baseline.html`, `calibrated-baseline.html`; calibration controllers | None |
| Results: per-building drill-down, time series, export | `resultViewer.html`, `capResultViewer.html`, `workflow-pages/results-view/overview.html` | Dashboard |

Every surface covers empty, loading, success, warning, and error states and keyboard use, and gets agent tool paths
through the same commands as manual controls.

## 3. Cross-cutting functions

- **Editable Inspection:** pending edits and per-field validation, shaped like RC's validation responses. Inspection is
  read-only today.
- **Scale:** a synthetic district at RC's benchmark scale (10,000 buildings, 10 versions) with performance budgets for
  the map, a virtualised table, and charts.
- **Versions:** project and scenario versions with a diff view; undo for layout changes.
- **Table:** a Zones view and a column visibility menu (known gaps).
- **Provenance:** where each value comes from (OpenStreetMap, upload, archetype default, calibration).
- **Saved layouts as View assets, and report export.**
- **Accessibility:** axe in every appearance and at more than one size; keyboard docking to a chosen group or side.
- **Fit for RC's host:** working under a subpath (such as `wwwroot/app/`) and inside a constrained WebView2. The Pages
  build already exercises a base path.

## 4. Deferred to the connections

Real sign-in, generated API types, the live SignalR progress channels, and native file pickers. The demo only defines
the interfaces they plug into.

## Suggested order

1. Foundation (mock service layer, fixture picker).
2. Project lifecycle.
3. Jobs.
4. Data intake.
5. Archetypes and schedules.
6. Measures and scenarios.
7. Calibration.
8. Results.

Scale and accessibility checks run alongside every step.

Step 3, Jobs, is built and merged into local `master` (2026-10-26); see the
[Jobs execution plan and status](jobs-execution-plan.md). Step 4, Data intake, follows in
[data intake](data-intake.md), step 5 in [archetypes and schedules](archetypes-schedules.md), step 6 in
[measures and scenarios](measures-scenarios.md), step 7 in [calibration](calibration.md), and step 8 in
[results](results.md). Steps 3–8 are complete in local `master`; see the
[completion report](20261026_roadmap-completion.md). Before it, the owner chose a Jobs list and detail pane
([decision 0025](decisions/0025-jobs-list-and-detail-pane.md)), held successful results until failures are resolved,
and failed-item retry only when inputs are unchanged. The owner approved the [rollout defaults](jobs-rollout-plan.md)
through Results (steps 3–8), with local merges after review and checks pass and no implementation pushes/deployments
([decision 0026](decisions/0026-autonomous-roadmap-through-results.md)). The next agent starts from the
[autonomous handoff](20261026_autonomous-roadmap-handoff.md).
