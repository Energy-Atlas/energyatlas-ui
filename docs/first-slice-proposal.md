# First slice proposal: workflow walking skeleton

Date: 2026-09-14 (revised the same day after discussion)

Status (updated 2026-09-15): being implemented; stages 1 to 3c are built on `master`, and stage 4 is built on the `feature/agentic` branch (see [implementation status](#implementation-status), [gaps](#deviations-and-gaps-2026-09-15), and [next steps](#next-steps)). The OpenFreeMap basemap and Back Bay footprints of [decision 0012](decisions/0012-openfreemap-basemap-back-bay.md) are built on `feature/basemap` (see [basemap status](#basemap-and-back-bay-footprints-2026-09-15)), together with 3D buildings from [decision 0013](decisions/0013-3d-building-extrusion.md) (see [3D status](#3d-buildings-2026-09-15)) and live terrain from [decision 0015](decisions/0015-terrain.md) (see [terrain status](#terrain-2026-09-15)). The design alignment pass for decisions [0009](decisions/0009-ui-design-guidelines.md) and [0010](decisions/0010-geist-typeface.md) is built; see [design alignment](design-alignment.md#implementation-status). The plan below was a proposal that the user accepted through [0002](decisions/0002-web-react-typescript-vite.md) web-only React/TypeScript/Vite; [0003](decisions/0003-combined-product-shell.md) combined shell, panels, pages, asset tree; [0004](decisions/0004-workbench-layout-and-docking.md) workbench layout with full docking; [0005](decisions/0005-first-slice-workflow-and-panel-scope.md) workflow sequence, reasoning content, roadmap meaning, first creators; [0006](decisions/0006-scripted-agent-and-layout-details.md) scripted agent and confirmed layout details; packages in [0007](decisions/0007-package-selection.md) and [0008](decisions/0008-flexlayout-docking.md). Details not covered by a decision remain recommendations. For code structure and conventions, read the [developer guide](developer-guide.md).

## Goal

A single synthetic project can be taken through the whole 12-stage workflow in the browser. Every required region, panel, and page is present, and every element states honestly whether it works, is simulated, or is planned.

## Layout details (side bar, Roadmap/Dashboard tabs, and status-bar detail tabs confirmed in decision 0006)

- **Side bar:** a narrow icon strip, like the Visual Studio Code activity bar. Each icon switches the left panel between views (Assets, Workflow, Search, and later others). Assets and Workflow can also be shown as stacked, collapsible sections in one view.
- **Middle window:** pages open as tabs. Docking allows splitting the middle window into several tab groups, for example Map beside Table.
- **Roadmap page:** a full-size view of the project-setup workflow graph for planning, while the left Workflow view is its compact form. Both read the same workflow state.
- **Dashboard page:** result charts plus the scenario controls panel (toggles, sliders).
- **Status bar:** clicking issues or background tasks opens an Issues or Tasks tab in the middle window, so detail is available without a fixed bottom panel.
- **Default layout:** restorable from the ribbon and by keyboard command; the user's layout is kept in UI state and is serializable for later View/layout assets.
- **Narrow widths:** side regions collapse to overlays opened from the side bar and ribbon.

## Cross-cutting state model

- **Project document:** typed asset tree with stable IDs, kind, status, and provenance (manual, agent, or stage output, with inputs).
- **Workflow graph:** stages are nodes with dependency edges; the default is the linear 12-stage sequence. Node states: `future`, `ready`, `running`, `executed`, `skipped`, `blocked`, `failed`, `stale`, `unavailable`. The current stage is a focus marker shown over its derived state rather than a state of its own (implemented in `src/domain/workflow.ts`). A stage becomes `stale` when an upstream input changes after it executed. `unavailable` marks planned capability and is never shown as executed (the reference's calibration page marked unimplemented work complete; see the audit). Graph edits (insert, skip, remove) are operations that must keep the graph acyclic. Nodes link their inputs, produced assets, and any reasoning entries that proposed or explained them.
- **Operations:** every mutation (create or edit an asset, run or skip a stage, change a scenario control, apply an approval) is a typed command with validation and a result, appended to an operation log. Manual controls and the agent invoke the same commands; agent tool calls in the reasoning panel link to their log entries, and agent-proposed commands wait for approval.
- **Background tasks:** running stages are tasks with progress, cancellation, and terminal states, shown in the status bar.
- **Selection:** one project-scoped selection shared by assets, map, table, and dashboard. An empty selection stays explicit and never silently widens.
- **UI state:** open tabs, layout, panel sizes, and collapsed regions, kept separate from project state.
- **Capability status:** each feature is **Working** (real behavior over fixture data), **Simulated** (deterministic stand-in for engineering or LLM computation, labeled), or **Planned** (visible, disabled, with an explanation). A single registry drives these labels so the UI cannot drift from the truth.

## Workflow stages and produced assets

| # | Stage | Produces (synthetic) |
| --- | --- | --- |
| 1 | Location setup / footprint capturing | Project location, footprint GIS dataset |
| 2 | Geospatial data enriching | Enriched GIS dataset with added attributes |
| 3 | Schema matching | Schema rules |
| 4 | Geospatial preprocessing | Buildings with cleaned geometry and zones |
| 5 | Shading calculation / PV yield estimation | Shading results, BIPV/PV yield |
| 6 | Archetype modeling | Archetypes and assignments |
| 7 | Baseline model setup | Weather selection, baseline energy model and results |
| 8 | Scenario definitions | Measures, scenarios (working creators) |
| 9 | Scenario modeling | Scenario energy results |
| 10 | Grid definitions | Lines, buses, transformers, utility PV, loads |
| 11 | Grid modeling | Grid results |
| 12 | Dashboard / visualization | Views, report |

Implemented assumption: stage 7 selects synthetic weather and computes baseline results.

## Working, simulated, and planned boundary

| Area | Working | Simulated | Planned (labeled) |
| --- | --- | --- | --- |
| Top ribbon | Menus, save (local project state), search over assets and commands, run current stage, layout reset/toggles, full screen | None | Comments |
| Docking workspace | Tabs, splits, drag-and-drop, resize, collapse, keyboard equivalents, default-layout restore | None | Saving layouts as View assets |
| Status bar | Open project, stage status, issue/notice counts, background task progress | Compute resources | None yet |
| Left panel: Assets | Tree over fixture project, selection, open in page, status/provenance badges, stage outputs appear | Result contents | Gas network, document viewer, custom widgets |
| Left panel: Workflow | Graph/list render, all node states, run/skip/revisit, stale propagation, insert/skip stage | Stage durations and outputs | Free-form graph editing |
| Right panel: Reasoning | Transcript layout for tool calls, reasoning, actions, and referenced links; chat input; prompt presets; approvals that invoke real operations | Agent sessions: scripted replays of realistic tool calls (decision 0006) | Document grounding |
| Map page | Synthetic footprints plus small grid overlay, linked selection, color by one metric | Metric values | Geometry editing, 3D/shading visuals |
| Table page | Buildings, zones, grid elements; sort/filter; linked selection; pending edit with apply/cancel and validation | None | User table import |
| Dashboard page | Baseline vs scenario comparison; scenario controls re-derive outputs | All numbers | Custom widgets, report export |
| Roadmap page | Full workflow graph for project setup, same state as the Workflow view | None | None yet |
| Creator page | Measure and scenario creators with validation | None | Other asset kinds, listed with Planned status |
| Settings page | Units, theme, layout reset | None | Model provider credentials, accounts |

Fixture variants cover empty project, loading, success, warning (missing weather, partial archetype coverage), and error (failed stage, rejected approval, cancelled task).

## Verification plan

- Operation and state tests: graph transitions, stale propagation, acyclicity, approvals, task lifecycle, selection rules.
- Browser checks of the full manual 12-stage workflow without using the agent.
- Keyboard traversal across ribbon, side bar, panels, tabs, and status bar; keyboard docking commands; visible focus.
- Visual checks at 1280x800, 1920x1080, and a narrow width; default and rearranged layouts.
- Exact commands are chosen when scaffolding.

## Package decisions that follow

Docking layout (first-order: tabs, splits, drag-and-drop, serialization, keyboard equivalents), map library (prefer token-free so the prototype runs without credentials; the reference uses Mapbox GL), workflow graph rendering, table/grid, charts, state management, rich text/markdown for the transcript, and test tooling.

## Open questions

Package selection was resolved in decisions 0007 and 0008. Open questions for stage 4 are listed under [next steps](#next-steps).

Proposed scripted agent sessions (decision 0006), at minimum:

- **UI restructuring:** open Map beside Table, focus a selection, and restore the default layout.
- **Data representation:** color the map by PV yield and add a dashboard chart comparing baseline and scenario.
- **Model change:** propose a measure or stage change that waits for approval, then show the resulting stale stages.

## Implementation status

### Stage 1: domain state and commands (2026-09-14)

Code in `src/domain/`; 21 unit tests in `src/domain/*.test.ts`.

- **Real:**
  - Typed workbench state and the asset tree skeleton from decision 0003.
  - Derived stage states with stale propagation, run blockers, and custom stage insertion with cycle checks.
  - Background task lifecycle and a task simulator with an injectable scheduler.
  - A shared selection that rejects unknown ids and never widens.
  - Validated pending edits, applied as manual overrides that survive stage reruns.
  - Measure and scenario creators with validation.
  - One command path, `createWorkbench().execute`, with zod-validated inputs, an operation log recording the source (manual, agent, system), and undo/redo for model changes through Immer patches.
  - A JSON Schema command catalog (`describeCommands`) for future agent tools.
- **Simulated:** every stage output in `src/domain/simulation.ts` is a deterministic synthetic stand-in:
  - 400 footprints near latitude 0, longitude 0 (open ocean), with uses, floors, zones, shading, and PV yield;
  - archetype energy intensities, baseline and scenario demand;
  - grid elements and transformer loading.

  Grid modeling fails on its first attempt by design so the failed state and recovery can be exercised.
- **Deferred to later stages:** all UI, layout commands, dashboard scenario controls, and the scripted agent with approvals.
- **Design notes:**
  - Undo covers model changes only: skip or restore, insert stage, apply edits, create measure or scenario. Runs, tasks, selection, and pending edits are not undoable. The id and revision counter never rewinds, so undone changes cannot collide with later ones.
  - Stage state is derived, never stored. An executed stage becomes stale when an upstream revision or its own edit revision differs from what its last run consumed, or when an upstream stage is no longer executed or skipped.

### Stage 2: workbench shell (2026-09-14)

Code in `src/app/` and `src/App.tsx`. Tests in `src/app/shortcuts.test.ts`, `src/domain/workbench.test.ts`, `e2e/workbench.spec.ts`, and `e2e/smoke.spec.ts`.

- **Real:**
  - The three-row window of decision 0004: ribbon, FlexLayout main area, and status bar.
  - Default layout: a left border (Assets, Workflow) whose tab strip is the icon side bar; a center tab group (Map, Table, Dashboard, Roadmap, Creator, Settings); and a right border (Reasoning). Issues and Tasks open from the status bar.
  - A layout controller (`src/app/layout/layoutController.ts`) with typed layout operations: open page, toggle panel, maximize, reset, and compact mode. They are recorded in the operation log alongside manual tab selections, moves, and closes. The layout is kept in this browser.
  - One action registry (`src/app/actions.ts`) drives the ribbon menus, quick buttons, command palette (Ctrl+K), and keyboard shortcuts. Blocked or planned actions record their reason in the status bar instead of doing nothing.
  - The Workflow panel (run, rerun, skip, restore, focus, state badges) and the Tasks, Issues, and Settings pages (theme, layout reset, capability table).
  - Save and restore in this browser's storage, a confirmed new empty project, keyboard undo and redo, and system, light, and dark themes with FlexLayout colors mapped to workbench tokens.
  - Below 1100 px wide, side panels close and open as overlays so pages keep their width.
- **Simulated:** stage runs, and computing resources in the status bar.
- **Not built yet, labeled in the UI:** Assets, Map, Table, Dashboard, Roadmap, and Creator (stage 3); Reasoning (stage 4).
- **Verification (2026-09-14):**
  - `npm run typecheck`, `npm run lint`, and `npm run format:check` pass; 28 unit tests pass.
  - `npm run test:e2e` passes 23 tests, including 8 workbench tests and a smoke test with no axe violations at 1280x800. An axe scan in dark mode also reported no violations.
  - Screenshots reviewed at 1280x800, 1920x1080, and 900x700, and in dark mode with a running stage, the command palette, and the View menu open.
- **Notes and known gaps:**
  - React Aria has no menubar, so the ribbon uses menu buttons inside an ARIA toolbar.
  - Unavailable buttons use `aria-disabled` so they stay focusable and explain themselves. Playwright treats them as disabled, so tests activate them from the keyboard.
  - At 1280 px with both side panels open, the Settings tab moves into FlexLayout's tab overflow menu.
  - Undo covers model commands only; layout changes are logged but not undoable.

### Stage 3a: assets, creator, and roadmap (2026-09-14)

Code in `src/app/panels/AssetsPanel.tsx`, `src/app/panels/assetTree.ts`, `src/app/pages/CreatorPage.tsx`, and `src/app/pages/RoadmapPage.tsx`. Tests in `src/app/panels/assetTree.test.ts` and `e2e/pages.spec.ts`.

- **Real:**
  - **Assets panel:** a keyboard-navigable React Aria tree over the full asset skeleton, with kind icons, child counts, and planned badges. A details region shows kind, summary, provenance (stage run or operation), capability status, and related pages; Enter opens the first related page.
  - **Creator page:** measure and scenario creators backed by the `measure.create` and `scenario.create` commands. Command validation issues appear on the matching fields, and the remaining creators are listed as planned.
  - **Roadmap page:** the workflow graph laid out by dagre and rendered by React Flow, sharing state with the Workflow panel. Each stage is a focusable button and the view follows the focused stage. A stage-details panel offers run, rerun, skip, restore, previous and next, and inserting a custom stage.
- **Simulated:** stage outputs shown in the tree and details remain synthetic.
- **Not built yet, labeled in the UI:** Map and Table (stage 3b), Dashboard (stage 3c), and Reasoning (stage 4).
- **Verification (2026-09-14):**
  - Typecheck, lint, and format check pass; 31 unit tests pass.
  - `npm run test:e2e` passes 26 tests, including 3 page tests with no serious or critical axe violations.
  - Screenshots of the Assets panel, Creator page, and Roadmap page reviewed at 1280x800.
- **Findings:**
  - React Aria Form's form-level `validationErrors` kept a corrected field natively invalid, so the next click on submit silently did nothing. Forms now mark each field invalid from command issues and clear only that field's issue when it is edited.
  - Docked tabs stay mounted while hidden and measure 0x0, so the roadmap refits once React Flow reports a real size.
  - When the docked page is narrow, a container query stacks the roadmap graph above the stage details.
  - React Aria checkboxes keep the native input visually hidden, so browser tests operate them from the keyboard.

### Stage 3b: map and table (2026-09-15)

Code in `src/app/pages/MapPage.tsx`, `src/app/pages/mapMetrics.ts`, `src/app/pages/TablePage.tsx`, `src/app/grid/agGrid.ts`, `src/app/viz/palette.ts`, and `src/app/components/EmptyState.tsx`. Tests in `src/app/pages/mapMetrics.test.ts` and `e2e/map-table.spec.ts`.

- **Real:**
  - **Map page:** MapLibre with no basemap or token.
    - Buildings are colored by one available metric on a single-hue sequential ramp, with a legend and a no-data color; the ramp's anchor flips in dark mode.
    - An optional grid overlay shows feeders, transformers, the substation, and utility PV.
    - Click selects, Shift+click adds or removes, and clicking empty map clears; every change goes through the shared selection commands.
    - Hover shows the building and its value. Unavailable metrics are disabled and explained.
  - **Table page:** AG Grid Community with Buildings and Grid elements tabs, quick filter, column filters, sorting, and keyboard grid navigation.
    - Floors and archetype edits go through `edits.propose`, show validation messages, stay highlighted while pending, and are applied or discarded with `edits.apply` and `edits.discard`.
    - Table row selection and map selection are the same shared selection.
  - Empty states name the missing stage and offer to run it.
- **Simulated:** all metric values, grid loading, and demand figures.
- **Not built yet:** Dashboard (stage 3c) and Reasoning (stage 4).
- **Verification (2026-09-15):**
  - Typecheck, lint, and format check pass; 33 unit tests pass.
  - `npm run test:e2e` passes 29 tests, including 3 Map and Table tests with no serious or critical axe violations.
  - Screenshots reviewed at 1280x800: Table (light), Map (light, with a selection), and Map (dark). The review moved the legend so it no longer covered footprints or the attribution control.
- **Accessibility and color:**
  - The map canvas is not exposed to screen readers. The page says so and links to the Table page, which shares the selection.
  - The sequential ramp comes from the dataviz reference palette. Categorical slots 1-3 were validated with the dataviz validator against the workbench surfaces (light `#ffffff`, dark `#1d2126`) using `--pairs all`: every check passes, but light-mode aqua is 2.82:1, so any chart using it must ship direct labels or a table view.
- **Finding:** AG Grid selection events report a `source`. The table ignores programmatic sources so that syncing from the map does not echo back as new selection commands.

### Stage 3c: dashboard (2026-09-15)

Code in `src/app/pages/DashboardPage.tsx`, `src/app/pages/dashboardData.ts`, `src/app/pages/dashboardCharts.ts`, and `src/app/viz/EChart.tsx`. The shared scenario calculation (`computeScenarioResult`) and the `scenario.setAdoption` command live in `src/domain/`. Tests in `src/app/pages/dashboardData.test.ts`, `src/domain/workbench.test.ts`, and `e2e/dashboard.spec.ts`.

- **Real:**
  - Stat tiles for baseline annual demand and peak, and for each compared scenario with its reduction against the baseline.
  - A monthly demand line chart and an annual demand bar chart (ECharts), each with a legend or category labels, tooltips, and a data table.
  - Transformer peak loading meters with a status icon and label; the marker line is 100% of rating.
  - **Scenario controls:** compare toggles and what-if adoption sliders.
    - A preview recomputes results with the same `computeScenarioResult` the scenario modeling stage uses, and is labeled "Preview, not saved". Reset discards it.
    - Apply runs the undoable `scenario.setAdoption` command, which marks the scenario stages stale. The dashboard then shows a stale-results notice with a run action.
  - An empty state before the baseline exists. Custom widgets and report export are visible and marked planned.
- **Simulated:** every number.
- **Not built yet:** Reasoning (stage 4).
- **Verification (2026-09-15):**
  - Typecheck, lint, and format check pass; 38 unit tests pass.
  - `npm run test:e2e` passes 30 tests, including the full dashboard flow (stages, creators, modeling, preview, apply, stale notice, data table) with no serious or critical axe violations.
  - Screenshots at 1920x1080 reviewed in light mode (with the data table open) and dark mode. The review removed line end labels and the y-axis name, which collided with each other and with the legend, and compacted the annual chart's tick labels.
- **Design notes:**
  - Charts compare at most the first three scenarios, matching the three categorical slots validated all-pairs. Further scenarios are listed as not charted.
  - Colors follow the scenario, not its rank, and the baseline uses the de-emphasis gray.
  - The light-mode third slot (aqua) is below 3:1 contrast; category labels and data tables provide the required relief.

### Stage 4: scripted agent (2026-09-15)

Branch `feature/agentic`: commits `7b6ff81` (view operations and chart specifications), `a0444b5` (layout operations), and the agent commit that follows them. Code in `src/app/view/`, `src/app/layout/layoutController.ts`, `src/domain/stagePlan.ts`, `src/app/agent/`, and `src/app/panels/ReasoningMode.tsx`. Tests in `src/app/view/viewStore.test.ts`, `src/app/layout/layoutController.test.ts`, `src/domain/stagePlan.test.ts`, `src/app/agent/scriptedAgent.test.ts`, `e2e/agent.spec.ts`, and `e2e/workbench.spec.ts`.

- **Real:**
  - **View operations:** context mode, map metric, grid overlay, map zoom to the selection, table view and filter, dashboard compare toggles, and added charts. Each is validated, recorded in the operation log with its source, and described with a JSON Schema input.
  - **Chart specifications** ([decision 0011](decisions/0011-agent-view-specs-and-missing-state.md)): validated against the project, compiled to ECharts with a data table, and removable.
  - **Layout operations:** place a page beside another, split the active tab, and move it to the next tab group. The command palette entries close the keyboard docking gap.
  - **Agent adapter and scripted player:** sessions replay tool calls only through the workbench, the view store, and the layout controller with source `agent`. Each tool call in the transcript shows its status, operation ids, summary, and input.
  - **Approvals:** tool calls that run stages or change the project model wait for Approve or Reject. Rejecting records a rejected operation and ends the session.
  - **Missing project state:** `planStages` lists the stages to restore or run in workflow order, and the session offers them as one approval. A stage that fails during the run ends the session with its own message.
  - **Reasoning mode:** a transcript with Markdown messages, collapsible reasoning, tool calls, approvals, and references to pages, stages, and Inspection; prepared sessions; a message field; and Stop. Rebuilt by [decision 0016](decisions/0016-reasoning-and-inspection-panels.md) as an independent Reasoning panel: an expanding composer with send modes (Send, Queue, Stir), permission modes that drive the approval gate (Ask for approval, Automatic, Bypass approval, Plan), suggested next steps instead of prepared sessions, and planned controls for attachments and model choice.
  - **Sessions:** Map beside Table with the tallest buildings; a PV yield map and a demand chart from a specification; a scenario change with approvals, the outdated stages, and a rerun; restoring the default layout.
- **Simulated:** the agent itself, which follows scripts and calls no language model, disclosed once in the Reasoning header; every number.
- **Limited or planned:** free text starts a session only when it matches a session's keywords, and otherwise the agent says it can only run prepared sessions. Transcripts, view state, and added charts are not saved with the project. No real model provider; the adapter and `describeAgentTools()` are the seam for one.
- **Verification (2026-09-15):**
  - Typecheck and lint pass; `npx prettier --check . --end-of-line auto` passes.
  - `npm test`: 95 tests in 13 files pass, including approvals, rejection, stopping, missing-stage planning, and a model change followed by a second approval that runs nine stages through the task simulator.
  - `npm run test:e2e`: 41 tests pass with 4 workers, including the four agent flows with axe checks.
  - Screenshots reviewed at 1920x1080: the pending approval and the finished layout session in Light and Dark engineering, and the data representation session in Light.
- **Findings from review:**
  - Sticky session controls covered the newest transcript entries while `toBeVisible` assertions passed. The transcript now scrolls on its own above the controls.
  - Long tool titles pushed the icon onto its own line; tool rows now use a three-column grid.
  - Added charts rendered below the built-in charts, out of view after the agent reported them; they now come first.
  - Zooming right after a tab move could run before the map container resized; the map now resizes and fits two frames later. The five tallest synthetic buildings are spread across the grid, so their zoom stays wide.
  - Selected buildings were not outlined on the map at all, including selections made in the Table. The map passed a new style object on every render, so react-maplibre called `setStyle`, whose diff removes the sources added at runtime together with their feature state. The style object is now memoized, the selection is re-applied once the map is idle, and outline visibility uses `line-opacity` with a surface-colored halo. A probe screenshot confirmed the outlines; canvas rendering has no automated check, so screenshot review is what caught it.

### Basemap and Back Bay footprints (2026-09-15)

Branch `feature/basemap`, from `feature/agentic`, following [decision 0012](decisions/0012-openfreemap-basemap-back-bay.md). Code in `src/domain/fixtures/`, `scripts/fetch-osm-buildings.mjs`, `src/domain/simulation.ts`, `src/app/pages/basemapStyle.ts`, `src/app/pages/useBasemap.ts`, `src/app/basemapPreference.ts`, `src/app/pages/MapPage.tsx`, and `src/app/pages/SettingsPage.tsx`. Tests in `src/app/pages/basemapStyle.test.ts`, `src/app/basemapPreference.test.ts`, `e2e/map-table.spec.ts`, and the shared fixture `e2e/test.ts`.

- **Real:**
  - **Footprints:** 464 OpenStreetMap buildings between Arlington Street and Dartmouth Street (Beacon Street to Commonwealth Avenue), fetched once from the public Overpass API with OSM data as of 2026-09-15T18:10:53Z and committed as a 116.6 KB GeoJSON file with an ODbL notice. Building ids B0001 to B0464 follow the file order, north to south. Footprint areas are computed from the real polygons, and Inspection provenance names the OSM element.
  - **Basemap:** the OpenFreeMap Positron style from the public instance, with every paint color rewritten from the active appearance, the basemap's own buildings and road shields hidden, and alley, path, and track names dropped. Attribution shows OpenFreeMap, OpenMapTiles, and OpenStreetMap, plus a separate OpenStreetMap credit on the footprint source that stays when the basemap is off.
  - **States:** loading and failure are shown in the Map footer. A failed style request, a 15 second timeout, or a failed basemap tile falls back to the plain background, with Retry basemap. Settings has a toggle stored under `eaui.basemap` and logged as `view.setBasemap`.
  - **Grid placement:** transformers sit at the mean position of the buildings in each quadrant around the district center, the substation west of the district, and the utility PV plant north of it.
  - **Saved projects:** saves move to `eaui.project.v2`. A version 1 save, which holds the ocean grid, stays in storage, is not restored, and the operation log says why.
- **Simulated:** every building attribute and result, all grid elements, and the weather, now named "Synthetic typical year (Boston stand-in)".
- **Verification (2026-09-15):**
  - Typecheck, lint, and `npx prettier --check . --end-of-line auto` pass.
  - `npm test`: 108 tests in 15 files pass, including basemap roles and recoloring in all six appearances, the label filter, attribution, and the stored preference.
  - `npm run test:e2e`: 44 tests pass with 4 workers. The product specs use a stand-in OpenFreeMap style and empty tiles, and cover basemap credits with axe, the fallback and retry, and the Settings toggle across reloads.
  - Screenshots with the real OpenFreeMap instance reviewed at 1920x1080 in Light, Dark engineering, Lieflat-inspired, and Technical monochrome; style, TileJSON, glyph, and sprite requests returned 200. A zoomed capture of one block did not run because the capture script could not find the table cell; district-scale captures show footprints aligned with Beacon, Marlborough, Commonwealth, Newbury, and Boylston streets.
- **Findings from review:**
  - MapLibre's attribution and zoom controls kept their white default boxes in dark appearances; they now use surface and text tokens, and their dark icons are inverted on dark themes.
  - The legend's translucent background let basemap street labels show through its text; it is now opaque.
  - Alley names ("Public Alley 421") crowded the building rows and competed with the modeled objects, against guidelines section 6; service, path, and track names are filtered out.
  - Cross-origin routed responses in Playwright need `Access-Control-Allow-Origin`, or the browser treats them as network failures.
  - Switching style while the previous one is still loading logs "Unable to perform style diff" and MapLibre rebuilds the style; the map recovers, so this is left as a warning.

### 3D buildings (2026-09-15)

Branch `feature/basemap`, following [decision 0013](decisions/0013-3d-building-extrusion.md). Code in `src/app/view/viewOperations.ts` (`map.set3d`), `src/app/pages/MapPage.tsx`, `src/app/pages/silhouette.ts`, and `src/app/pages/SelectionSilhouette.tsx`. Tests in `src/app/view/viewStore.test.ts`, `src/app/pages/silhouette.test.ts`, and `e2e/map-table.spec.ts`.

- **Real:**
  - **2D/3D switch:** a "3D buildings" checkbox on the Map page runs the logged `map.set3d` view operation, which the agent can also call. 3D tilts the camera to 50° and rotates it -20°, shows the compass, and allows tilting with right-drag or Shift+⇡/⇣ and rotating with Shift+⇠/⇢; 2D keeps the map flat and north-up (`maxPitch` 0). Fits and zoom to selection keep the current pitch and bearing.
  - **Extrusion:** a `fill-extrusion` layer raises footprints to `heightM` in the metric colors. Before "Geospatial preprocessing" the page notes that buildings stay flat, and the status notice says so when 3D is turned on. The legend adds the height rule.
  - **Selection:** building colors never change. 2D keeps the ground outline with its halo. In 3D, a MapLibre custom layer supplies the Mercator projection matrix every frame; each selected building's ground, roof, and walls are projected, filled into a mask, and dilated and cut out on an overlay canvas, so the selection-colored line and surface halo follow the visible silhouette as the camera moves.
- **Simulated:** heights (floors × 3.2 m) and every attribute.
- **Verification (2026-09-15):**
  - Typecheck, lint, and `npx prettier --check . --end-of-line auto` pass.
  - `npm test`: 114 tests in 16 files pass, including `map.set3d` and silhouette projection (Mercator altitude, faces, clip-to-pixel projection, faces behind the camera).
  - `npm run test:e2e`: 45 tests pass. The 2D/3D test covers the missing-heights note, the legend and keyboard hint, axe, selecting a building from the Table and finding painted pixels on the silhouette overlay, and an empty overlay after returning to 2D.
  - Screenshots with the real OpenFreeMap instance reviewed at 1920x1080 in Light and Dark engineering, before and after clicking building B0425 in 3D: the outline follows its roof edge, near wall, and base, and its fill keeps the floors color.
- **Findings from review:**
  - The first selection design recolored selected extrusions; the user replaced it with outlines, then replaced a roof-edge rim with a view-dependent silhouette outline. MapLibre 6.9.1 has no line elevation property, so ground lines cannot outline extrusions.
  - The silhouette first drew nothing. A probe of the custom layer's inputs showed that `modelViewProjectionMatrix` expects world pixel coordinates, while `defaultProjectionData.mainMatrix` takes Mercator 0 to 1; with the former, a selected corner projected to (43, -641) on a 1243x845 canvas, and with the latter to (361, 560). The e2e pixel check on the overlay caught the empty outline, which a visibility assertion would not have.
  - The outline is drawn above the map, so it shows through taller buildings in front, and adjacent selected buildings share one outline.
  - Throwaway capture scripts could not click Table cells at 1920x1080 and timed out; the captures click buildings on the map instead.

### Terrain (2026-09-15)

Branch `feature/basemap`, after `feature/agentic` was merged into it, following [decision 0015](decisions/0015-terrain.md). Code in `src/app/view/viewOperations.ts` (`map.setTerrain`, `map.setTerrainExaggeration`), `src/app/pages/terrain.ts`, `src/app/pages/useTerrain.ts`, `src/app/pages/MapPage.tsx`, and `src/app/pages/silhouette.ts`. Tests in `src/app/pages/terrain.test.ts`, `src/app/pages/silhouette.test.ts`, `src/app/view/viewStore.test.ts`, and `e2e/map-table.spec.ts`.

- **Real:**
  - **Live terrain:** MapLibre fetches Mapterhorn terrarium tiles at runtime for the terrain mesh and a hillshade layer colored from the active appearance and placed beneath basemap labels. Nothing is stored: terrain is display only and never project data.
  - **Controls:** a "Terrain" switch beside "3D buildings" runs the logged `map.setTerrain` view operation, and an exaggeration slider from 1 to 10 logs `map.setTerrainExaggeration` when released. The default is true scale. While the map is flat, the page says relief shows once the map is tilted.
  - **Features on terrain:** MapLibre drapes basemap fills and lines, building fills, outlines, and feeder lines; it raises grid points and labels itself; extrusions stand on the elevation at each building's centroid. The 3D selection outline is lifted by the same sampled elevation, so it stays on the building.
  - **States:** loading and failure appear in the Map footer; a failure falls back to a flat map with Retry terrain. The legend names the exaggeration and the source, and the map credits Mapterhorn, USGS 3DEP, OpenStreetMap, and OpenFreeMap.
- **Simulated:** building heights and every attribute; terrain elevation itself is real data shown for orientation only.
- **Verification (2026-09-15):**
  - Typecheck, lint, and `npm run format:check` pass.
  - `npm test`: 126 tests in 17 files pass, including hillshade colors for all six appearances, the label layer lookup, both terrain view operations with exaggeration validation, and the silhouette's elevation lift.
  - `npm run test:e2e`: 47 tests pass. The terrain tests cover the switch, the legend row, credits, the keyboard slider, axe, and the flat fallback with retry, against a stand-in flat tile served by `e2e/test.ts`.
  - Screenshots with the live Mapterhorn service reviewed at 1920x1080 in Light and Dark engineering at 10× exaggeration, with and without a selected building: Beacon Hill and the Charles River basin read as relief, buildings stand on the slope, labels and water drape, and the selection outline stays on building B0425.
- **Findings from review:**
  - MapLibre throws when a source is removed while `setTerrain` still points at it, and child sources unmount before a parent effect can clear terrain. The terrain and hillshade sources therefore stay mounted (they fetch nothing until used) and `useTerrain.ts` applies or clears terrain itself, re-applying on `styledata` because style swaps drop it. react-maplibre's `terrain` prop is not used for the same ordering reason.
  - A stubbed terrain tile must decode: an empty or 204 response fails, so the suite serves a flat 8x8 terrarium PNG (elevation 0).
  - Mapterhorn serves Back Bay to zoom 16 and states no usage terms or service level; AWS Terrain Tiles returned no cross-origin header and document their endpoints for EC2 use.
  - Back Bay's true-scale relief is barely visible, which is why review used the maximum exaggeration.
  - Only the silhouette overlay needed lifting: MapLibre's circle and symbol shaders already add the terrain elevation at their anchors.

### Shell styling, docking, and menus (2026-09-15)

A pass over reported UI problems, on `feature/agentic`, after `feature/basemap` was merged into it. Code in `src/app/global.css`, `src/app/layout/flexlayout-theme.css`, `src/app/layout/layoutController.ts`, `src/app/shell/WorkbenchShell.tsx`, `src/app/shell/Ribbon.tsx`, `src/app/shell/shell.module.css`, `src/app/shell/CommandPalette.tsx`, and `src/app/actions.ts`. Test in `e2e/workbench.spec.ts`.

- **Real:**
  - **Scrollbars:** no reserved gutter anywhere (`offsetWidth - clientWidth` is 0); the thumb is a dim rounded rectangle over the content that brightens when pointed at. Firefox keeps a thin dim scrollbar through its own properties.
  - **Splitters:** a one-pixel line with a seven-pixel hit area, so resizing stays easy while the seam is quiet.
  - **Side containers:** both borders stay in place when empty and say "Drop a tab here to dock it". Panel tabs can be closed; showing a closed panel again docks it back on its own side and says so.
  - **Ribbons:** left and right strips read the same way (top to bottom) with icon, name, and close, matching center tabs.
  - **Menus:** panel visibility is one "Panels" submenu and themes are one "Appearance" submenu, opening to the side with their check marks and shortcuts. The command palette stays flat so search still finds every action.
  - **Command palette:** Backspace edits the query again.
- **Verification (2026-09-15):**
  - Typecheck, lint, and `npm run format:check` pass; `npm test`: 126 tests in 17 files; `npm run test:e2e`: 48 tests, including a regression test that types in the palette and deletes with Backspace.
  - Screenshots at 1600x900 in Light and Dark engineering: default layout, both submenus open, the empty left container with its hint, and the panel docked back.
- **Findings from review:**
  - React Aria's `Autocomplete` replays the field's keys on the focused menu item and cancels the real key when the item cancels the replay. A menu item claims Backspace, so the palette field never deleted while Delete worked. The palette now stops the replayed, untrusted Backspace at the menu.
  - Chromium draws overlay scrollbars here: they reserve no width and never appear in screenshots, even for a control element with a red thumb on a yellow track. Scrollbar styling is verified through computed styles instead. Setting `scrollbar-width` makes Chromium ignore `::-webkit-scrollbar` rules, so it is scoped to Firefox.
  - FlexLayout's own hovering scrollbars wrap the border tab strip, not panel content, so they do not govern the panels; panel scrolling stays with the panel elements.

### Shell follow-up: separators, side containers, and menu structure (2026-09-15)

A second pass over reported UI problems, on `feature/agentic`. Code in `src/app/layout/flexlayout-theme.css`, `src/app/layout/layoutController.ts`, `src/app/actions.ts`, `src/app/shell/Ribbon.tsx`, `src/app/panels/panels.module.css`, and `src/app/components/components.module.css`.

- **Real:**
  - **Separators:** the seam stays a hairline until pointed at, then takes the accent color and shows a filled circle with a two-way arrow marking the direction it moves; the arrow turns for horizontal seams.
  - **Side containers:** two ribbon buttons collapse and expand the left and right containers independently, as in Visual Studio Code, whatever each holds. Collapsing selects no tab; expanding restores the first.
  - **Panels menu:** every page (Map to Tasks) and every panel (Assets, Workflow, Context) sits under one Panels submenu, named plainly without the "Show or hide" prefix, keeping check marks and shortcuts.
  - **Appearance menu:** holds Reset layout and a Theme submenu; the themes are named plainly (System, Light, Dark, Technical monochrome, Lieflat-inspired, Clean technical light, Dark engineering).
- **Verification (2026-09-15):**
  - Typecheck, lint, and `npm run format:check` pass; `npm test`: 126 tests in 17 files; `npm run test:e2e`: 48 tests.
  - Screenshots at 1600x900: the splitter circle magnified, each side container collapsed on its own and restored, and the three menu levels.
- **Findings from review:**
  - FlexLayout's hovering mini-scrollbars wrap only border strips and tab bars, never tab content: their containers do not overflow and their bars measure 0x0. Handing panel scrolling to the docked tab therefore removed the indicator entirely, so panels and pages keep their own scrolling with the overlay thumb, which still reserves no width.
  - Drawing the separator's arrow with `clip-path` produced four corner fragments; an SVG mask filled with the on-accent token renders cleanly and keeps color in tokens.
  - Renaming menu actions to plain names broke four end-to-end tests that typed "open settings" and similar into the palette; they now type the plain name.

## Deviations and gaps (2026-09-15)

Compared with the plan above and the package constraints, the build so far:

- **Reasoning mode:** built in stage 4 as scripted sessions; free text only matches prepared sessions.
- **Keyboard docking:** closed in stage 4 for splitting the active tab and moving it to the next group; the palette cannot pick a specific target group or side.
- **View state:** logged view operations since stage 4, except dashboard what-if previews, which stay unlogged drafts. View state resets on reload.
- **Chart specs:** charts the agent adds use validated specifications; the Dashboard's built-in charts still build ECharts options directly.
- **Table page:** Buildings and Grid elements only; zones appear as a count column, and there is no column visibility menu.
- **Fixture variants:** warning and error states are reached by walking the workflow (schema matching's warning, skipped shading with a PV measure, grid modeling's scripted first failure), not by a fixture picker.
- **Verification breadth:** automated axe runs cover 1280x800 only; 1920x1080, narrow widths, and dark mode were checked by screenshots. The bundle has not been loaded in the reference ASP.NET or Eto host.

## Next steps

Current plan (2026-10-25): the [pre-connection roadmap](pre-connection-roadmap.md). Real backend connections are built inside RCEnergySimulator after the demo is refined, and `feature/agentic` stays unmerged for now ([decision 0022](decisions/0022-backend-connections-inside-rc.md)). The stage 4 notes below are history.

Stage 4 is built on the `feature/agentic` branch; see [stage 4 status](#stage-4-scripted-agent-2026-09-15). The scope it implemented, from decisions 0006, 0009, and 0011 and the Reasoning row above:

- **Context panel** (decision 0009): built in the [design alignment](design-alignment.md) pass with a Reasoning placeholder and a read-only Inspection mode. The items below fill the Reasoning mode; agent tool calls can switch modes with `setContextMode(mode, 'agent')`.
- **Transcript** in the Reasoning mode: user and agent messages (Markdown through `react-markdown` and `remark-gfm`), reasoning steps, tool calls with inputs and results linked to operation log entries, and referenced links. Label all of it simulated (`agent.sessions` capability).
- **Chat input and prompt presets**; a preset starts one of the scripted sessions. Free text without a matching script gets an honest "scripted sessions only" answer.
- **Approvals:** tool calls that change the project model (`undoable` commands) wait for Approve or Reject. Approve runs the command with source `agent`; Reject records a rejected operation. Layout and view tool calls run directly and are logged.
- **Sessions (at minimum):**
  - UI restructuring: open Map beside Table, focus a selection, restore the default layout.
  - Data representation: color the map by PV yield and add a baseline-versus-scenario dashboard chart.
  - Model change: propose a measure or adoption change, wait for approval, then show the stale stages.
- **Agent adapter:** a small interface that the scripted player implements, so a real provider can replace it later. The player replays tool calls through `workbench.execute(command, 'agent')` and the layout controller with source `agent`, never through private paths. `describeCommands()` supplies tool schemas.

Prerequisites and design questions, all resolved:

1. Done in commit `7b6ff81`: move the view state listed under deviations into typed, logged view operations (a UI-state store beside the workbench, recorded like layout operations), so agent and manual changes share one path.
2. Done in commit `a0444b5`: add a layout operation that places a page beside another (split), and expose tab moves in the command palette to close the keyboard docking gap.
3. Resolved 2026-09-15 ([decision 0011](decisions/0011-agent-view-specs-and-missing-state.md)): the agent adds charts as validated view specifications.
4. Resolved 2026-09-15 ([decision 0011](decisions/0011-agent-view-specs-and-missing-state.md)): a session explains missing project state and offers to run the missing stages as one approval.
5. Resolved and built 2026-09-15: the [design alignment](design-alignment.md) pass (decisions 0009 and [0010](decisions/0010-geist-typeface.md)) came before stage 4. The view state it added, appearance and context mode, is already logged like layout operations.

Later candidates, not yet discussed with the user: reviewing and merging `feature/agentic` into `master`, saving added charts and layouts as View assets, remaining creators, zones table, fixture picker, saved layouts as View assets, report export, and a real model provider behind the adapter (variables already reserved in `.env.example`).
