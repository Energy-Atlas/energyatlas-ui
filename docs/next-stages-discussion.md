# Next stages: discussion

Date: 2026-10-28. Status: decided the same day ([decision 0032](decisions/0032-next-stages-directions.md)); see
[the owner's answers](#the-owners-answers). Nothing is built yet.

The owner's proposal:

1. Buildings shown per floor and, for the selected building or buildings, per zone.
2. Interfaces for schema matching, archetype assignment rules, scenario assignment rules, and result version
   management.
3. A new page, not a panel, on the same backbone, for handing a project over to view-only clients. It offers every
   feature except running and editing: layout arrangement, filter resets, restyling, panel docking. A "viewer" version.
4. Saved layouts, for both the modeller and the viewer.

These join the remaining cross-cutting items in the [pre-connection roadmap](pre-connection-roadmap.md#3-cross-cutting-functions)
(scale benchmark, versions, provenance, saved layouts and report export, accessibility breadth, fit for RC's host);
feature 4 is the roadmap's "saved layouts as View assets", and result versions overlap its "versions".

## Observed: RC EnergyAtlasWeb

RCEnergySimulator at `7464c140fc5d9a49a2ca59954a85ac199a0faf09` (branch `feature/archetype-library-schedule-registry`,
clean), inspected read-only. Paths are relative to that repository. Earlier observations for the same areas are in
[RC observations for slices 4–8](roadmap-rc-observations.md).

### Floors and zones

- `EnergyAtlasLib/Factory/Zoning.cs:5`: zoning modes `Single`, `Floors`, and `PerimeterCore`, with storeys, floor
  height, perimeter depth, and resolution. `ThermalZoningPolicy.cs:39-51`: floor height is building height over
  storeys, so floors are uniform.
- `EnergyAtlasLib/Factory/BuildingZoner.cs:19-92`: slices a building at floor heights into (floor, region, bottom,
  top) cells; perimeter-core zoning insets the footprint for the core and splits the perimeter into one zone per
  footprint edge.
- `EnergyAtlasCore/Building/Zone.cs:28`: a zone has an ID, building, aggregation weight, bottom and top, surfaces, and
  construction, system, and load bindings; there is no core/perimeter type or area field. Zone IDs are positional
  (`EnergyAtlasLib/Factory/DeterministicIds.cs:22`).
- `EnergyAtlasWeb/Controllers/SimulationController.cs:585-598`: a run takes `zoning: {mode, perimeterDepth,
  resolution}`; without it each building is one zone. The zone endpoints in `ZoneCalibrationController.cs` are
  single-zone only (`ZoneRegistry.cs:45-49`).
- Per-zone hourly results are an opt-in capture, off by default for size (`UbemSimpleSettings.cs:122-127`); no web
  endpoint reads them.
- No page in `EnergyAtlasWeb/wwwroot` shows floors or zones: maps extrude whole buildings (`js/geoDataPreview.js`),
  and there is no building detail page, floor plan, or zone table.

### Schema matching

- `wwwroot/schemaMatching.html`, `js/schemaMatching.js`: a source attribute table (name, type, example) beside rule
  tabs for Compulsory, Overrides (computed), Optional in six groups, and Custom targets; "Fuzzy Match All"; a map and
  charts for the chosen attribute; load and save of rule sets; save to the DataHub.
- `js/schemaMatching.js:1006-1015, 1581`: a rule is valid when enabled, with a source and a target, and no other
  enabled rule maps the same target; Next is blocked while compulsory rules are invalid or missing.
- `Controllers/SchemaMatchingController.cs:30-81, 666-812`: target fields carry required, default, unit, type, tier,
  and group; transforms are not supported and are skipped with a warning; units are reported but not converted;
  enumerated targets warn about unrecognised values with counts and examples. Rule sets are saved as
  `UserData/Rulesets/SchemaMatchingRules.json`.

### Archetype assignment rules

- `Controllers/TemplateAssignmentController.cs:2143-2169`: a rule has a type (builder or custom), logic (all, any, or
  none), priority, enabled, name, conditions of field, operator, and value, and one archetype part each for
  construction, systems, space loads, and external loads.
- `EnergyAtlasLib/Templates/TemplateAssignment.cs:151-192`: rules are tried by descending priority, and each part
  takes the first matching rule that sets it, so one building's parts can come from different rules.
  `EnergyAtlasLib/Scenarios/GISSelection.cs:14-22`: operators are larger, smaller, equals, contains, and does not
  contain.
- `TemplateAssignmentController.cs:1444-1538`: default rules are generated per building type and vintage, with a
  priority-0 fallback rule without conditions. Evaluation reports per-part assignments, statistics, and coded warnings
  for skipped or partly blank rules; the page shows "Unassigned (n)" (`js/templateAssignment.js:1648-1655`).
- There is no per-building editor; completing keeps an archetype already on a building
  (`TemplateAssignmentController.cs:923-949`).

### Scenario assignment rules

- `Controllers/ScenarioDesignerController.cs:946-978`: scenario rules share the archetype rule shape (priority, logic,
  conditions) and assign at most one measure per category (envelope, heating, cooling, hot water, plug loads, gas
  equipment, PV). `EnergyAtlasLib/Scenarios/Scenario.cs`, `MeasurePackage.cs`: a scenario is a list of prioritized
  measure packages with selections.
- Adoption is a query-time setting, not part of a rule: result selections take `penetration {versionKey, fraction,
  seed}` (`SimulationResultsController.cs:258-278`), sampled by hash (`Services/Cap/CapRealizationSampler.cs`).
- No phasing by year; most `wwwroot/workflow-pages/retrofit-scenarios/*.html` pages are placeholders.

### Result versions

- `Controllers/SimulationResultsController.cs:25-33`: a run is a job folder with a results database, its source
  GeoJSON, and run metadata. `EnergyAtlasLib/Results/ResultSchemaSql.cs:78-98`: the `runs` table records status,
  times, weather source, software and calculation versions, and shared inputs; `run_versions` holds the baseline and
  each scenario of a run.
- `GET /api/simulation/runs` lists runs newest first and marks the one the workflow points to as current; there is no
  rename, delete, or set-current endpoint. Accepted calibrations are kept per building
  (`POST /api/calibration/accept`, `DELETE /api/calibration/accepted/{featureId}`).
- `js/resultViewer.js:2796` compares against the entry whose name matches "baseline"; `results-view/overview.html` is a
  placeholder.

### View-only access and saved layouts

- No authentication, roles, view-only mode, or sharing was found in `EnergyAtlasWeb`; Kestrel binds to localhost
  (`EnergyAtlasWeb/Program.cs:46-47`). The nearest mechanism is `Runtime/ProjectEditGate.cs`, which refuses mutating
  requests with 409 `run_in_progress` while a simulation runs.
- No layouts are saved on the server or in the project (`Models/ProjectData.cs`); the desktop host remembers three
  recent projects (`EnergyAtlasDesktopEto/RecentProjectsStore.cs`). Pages keep their own presets in `localStorage`:
  column widths, `resultViewer_state`, `geoDataPreview_state`, menu state, and the theme.

## Observed: the demo today

Local `master` at `27e8a1f`.

- **Buildings** (`src/domain/types.ts`): `floors`, `heightM`, `floorAreaM2`, and `zoneCount` are numbers per building;
  geospatial preprocessing fills height (floors × 3.2 m), floor area, and a zone count. No floor or zone objects exist;
  the map extrudes whole buildings. The `zones` asset kind exists but holds no geometry.
- **Schema matching**: the Data intake page maps dataset fields to six model fields (`TargetField`) and fuses by
  stable source ID ([data intake](data-intake.md)). The Schema matching stage itself is a simulated run.
- **Archetype assignment** (`src/domain/archetypes/assignment.ts`): by use and construction-year range, narrowest range
  first; a manual archetype override on a building wins. No rule list.
- **Scenario assignment** (`src/domain/scenarios/comparison.ts`): a measure applies to one use or to all, and a
  scenario has one adoption percentage. No rules.
- **Results** ([results](results.md)): one published result per baseline and per scenario; a rerun replaces it. A
  calibrated variant can be adopted as the baseline. There is no version list.
- **Write paths**: every model change is a server command sent with `client.execute`; view state changes through
  view operations; layout through `layoutController`. That separation is what a view-only page can rely on.
- **Saved state**: one docking layout per browser (`localStorage` `eaui.layout.v2`, saved automatically); table
  settings and the map layer stack are saved with the project (decisions 0029 and 0031).

## 1. Floors and zones

**A. Floors and zones in the map and Properties (recommended).**
- A zoning setting following RC's three modes: one zone per building, one per floor, or perimeter and core per floor,
  with a perimeter depth. It is an input of Geospatial preprocessing, so changing it makes later stages stale.
- The map draws floors as stacked slabs in 3D. The selected buildings also show their zones, one colour per zone
  with outlines.
- Properties lists a selected building's floors and zones as tables (area, height range, zone type). A zone or floor
  is selectable, and the Table page shares that selection.
- Results get a per-floor and per-zone breakdown for the selected building, derived synthetically from area shares
  and said to be.

**B. A building detail page.** The map stays whole-building. A Building page shows the selected building as an
exploded floor stack and as a plan of one floor with its zones, with zone tables and results beside it.

**C. Both.** Floor slabs and zones in the map as in A, and the detail page from B for plans and per-zone results.

Real, mocked, deferred (direction A): floor slicing, zone geometry, selection, and the state flow are real; zone
results are synthetic; per-zone editing (zone types, per-zone archetype parts) is deferred unless the owner wants it.

Note on geometry: perimeter-and-core zones need a polygon inset. Many OSM footprints are concave, where a simple
inset fails. Either the demo writes its own inset with a documented fallback (one zone per floor when the inset
fails), or a geometry package is added, which needs a recorded decision (`AGENTS.md`).

## 2. Rules and versions

The archetype and scenario rules have the same shape in RC: an ordered list of enabled rules, each with all/any/none
conditions on building attributes and an assignment. One shared rule editor would serve both:

- `RuleList`: rules top first, reordered with `ReorderableList`, an enabled checkbox per rule, and Add, Duplicate,
  and Remove.
- `ConditionBuilder`: rows of field, operator, and value, typed by field (a number range, a use from a list, text
  containment), with per-field validation.
- An evaluation preview: how many buildings each rule takes, the number left unassigned, and a map layer coloured by
  the winning rule.

**2a. Schema matching.** Make the Schema matching stage a real mapping review instead of a simulated run: target
fields in RC's tiers (compulsory, computed, optional, custom), one source per target, suggested matches to review, an
example value and a value distribution per source field, unrecognised values of enumerated fields with counts, and
rule sets that can be saved and loaded. The Data intake mapping would use the same component. Unit conversion and
transforms are deferred, as in RC.

**2b. Archetype assignment rules.** Replace "narrowest year range" with ordered rules: conditions on use, year built,
floors, and floor area assign an archetype. Default rules are generated from the archetype library (one per use and
year range) with a fallback rule. A manual archetype on a building still wins and the preview counts it. RC assigns
four archetype parts separately; the demo's archetype is one object, so per-part assignment is a question below.

**2c. Scenario assignment rules.** A scenario becomes ordered rules: conditions choose buildings and the rule assigns
measures, at most one per measure kind. Adoption becomes a per-rule percentage with a fixed seed, so the same
buildings are chosen every run (RC applies adoption when results are read; the demo would apply it when the scenario
is modelled, and record the difference).

**2d. Result versions.** Keep every published result set as a version instead of replacing it:

- each version records its run, publication time, input signature, and whether it is baseline, scenario, or
  calibrated;
- the Results page lists versions, newest first, with the current one marked (the one the workflow points to, as in
  RC);
- versions can be named and pinned, compared two at a time, and removed from the project, except the current one;
- older versions are read-only and say what changed since they ran.

A retention limit (for example, keep pinned versions and the last few unpinned) keeps the saved project small.

## 3. A viewer page for handover

RC has no view-only access, so this is new. All directions share one rule: the server, not the page, refuses every
model change from a viewer session, as RC's edit gate refuses changes during a run. Running, editing, drafts, and
agent actions that change the model are refused at the source; view operations, layouts, and exports work.

**A. A viewer mode of the same app.** The workbench opens a handed-over project in view-only mode; editing controls
are removed and the shell shows "View only".

**B. A separate viewer page (recommended, as the owner described).** A second entry, such as `viewer.html`, built
from the same components, view operations, layout controller, and project client, with its own shell. It contains
the Map, Table, Dashboard, Results, Properties (read-only), Messages, and Roadmap (read-only), and leaves out Jobs
actions, Data intake, Archetypes and Measures editing, Demo conditions, and Run controls. Its bundle cannot reach an
editor by mistake. The viewer can arrange and dock panels, filter, sort, restyle map layers and tables, reset a page
to its handed-over view, change appearance, and export published results.

**C. A frozen handover package.** The modeller creates a handover from a project: the published model and chosen
result versions, the views and layouts, and provenance, without held outputs, drafts, or job logs. The viewer opens
that package, not the live project. This fits B: B is the page, C is what it opens.

Mocked in the demo: the handover is a package in the browser catalog or a downloaded file opened in the viewer page;
real sharing, accounts, and access control are deferred to RC (decision 0022).

## 4. Saved layouts

**A. Layouts saved with the project.** Named layouts as `view` assets in the project, shared by everyone who opens
it and included in a handover.

**B. Personal layouts in the browser.** Named layouts per person and browser, for any project.

**C. Both (recommended).** Project layouts travel with the project and the handover; personal layouts stay in the
browser. A viewer's own changes are personal and never alter the handed-over layouts, so "reset" always has a
target.

What a layout holds: the docking arrangement and open pages, and optionally a view snapshot (table settings, map
layers and camera, filters, chosen results). One reading is "layout" for docking only and "view" for layout plus view
state; another is one object with a "include view settings" choice.

## Dependencies and suggested order

- Saved layouts come before the viewer, which needs project layouts to hand over and reset to.
- Result versions come before the viewer, so a handover can name which versions it includes.
- The shared rule editor serves archetype and scenario rules; schema matching shares the mapping component with Data
  intake.
- Floors and zones are independent of the rest, but the 10,000-building benchmark should decide how much floor and
  zone geometry the map can draw (selected buildings only is safe).

Suggested order:

1. Saved layouts (personal and project).
2. Result versions.
3. Archetype assignment rules, then scenario assignment rules, on one rule editor.
4. Schema matching.
5. The viewer page and handover package.
6. Floors and zones.

## Questions for the owner

1. **Floors and zones**: map and Properties (A), a building detail page (B), or both (C)? Should zones be editable
   (zone type, per-zone archetype parts), or display only for now? For perimeter-and-core zones, write the inset in
   the demo or add a geometry package?
2. **Archetype rules**: assign the whole archetype, or RC's four parts (construction, systems, space loads,
   external loads) separately?
3. **Scenario rules**: per-rule adoption with a fixed seed when modelling (proposed), or RC's adoption applied when
   results are read?
4. **Result versions**: which actions: name, pin, compare, remove? Keep every version, or a retention limit?
5. **Viewer**: a separate page (B) opening a frozen handover package (C), as proposed? Should the viewer have the
   agent for questions and view changes only, or no agent? Should removed features be absent, or present and
   disabled with "View only"?
6. **Saved layouts**: project and personal layouts (C)? Does a layout include view settings, or docking only?
7. **Order**: the suggested order, or another? Where does the scale benchmark go?

## The owner's answers

Recorded 2026-10-28 in [decision 0032](decisions/0032-next-stages-directions.md):

1. Floors and zones in the map and Properties; zones display only for now; demo-grade geometry is acceptable.
2. Archetype rules assign RC's four parts.
3. A scenario is, in RC, a query and aggregation: each building is simulated with an alternative version, and
   buildings are sampled deterministically at random during aggregation. Not too important for the UI demo.
4. Result versions are discussed later.
5. A separate viewer page opening a handover package; the viewer has the agent for questions, interpretations, and
   view changes; features it cannot use are left out. (The answer to "absent, or present and disabled" was "yes",
   read as the proposed direction B, which leaves them out.)
6. Both project and personal layouts; a layout includes view settings and the panel arrangement.
7. No 10,000-building test now.
