# RC observations for roadmap slices 4–8

Date: 2026-10-26. Reference: `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`, branch
`feature/archetype-library-schedule-registry` at `7464c140fc5d9a49a2ca59954a85ac199a0faf09` (the main checkout was on
`claude/mcp-design-setup-3a8705`, unchanged). Inspected only with `git --no-optional-locks show/ls-tree`; nothing was
built, installed, copied, or modified. Paths below are relative to that repository at that revision.

Observed facts are separate from the demo's approved rules ([rollout plan](jobs-rollout-plan.md) D1–D10). Where they
differ, the approved demo rule stands and the difference is recorded here; none reverses an accepted decision.

## Data intake (slice 4)

Observed:

- `EnergyAtlasWeb/wwwroot/workflow-pages/setup/geospatial-data-upload-fusion.html`: one footprint source plus parcel or
  context layers as `.geojson`/`.json`, a preview, Run fusion, then Schema Match (Compulsory Attributes).
- `EnergyAtlasWeb/Controllers/FusionController.cs`: upload rejects a missing project or file, empty or unparseable
  GeoJSON, and zero features; fusion writes one working collection.
- `EnergyAtlasWeb/Planning/GeoDataFusion.md`, `EnergyAtlasLib/Preprocessing/GeoDataFusion.cs`: fusion is geometric
  (overlap and distance in a local UTM projection), one match per footprint per layer, with match classes
  (confident, dominant, tie-break, distance, ambiguous); merged attributes are prefixed with the layer name.
- `EnergyAtlasWeb/Planning/SchemaMatchingTool.md`, `EnergyAtlasWeb/SchemaMatching/SchemaMatchAutoMatcher.cs`,
  `EnergyAtlasWeb/Planning/SchemaMatchInputOutputReference.md`, `EnergyAtlasWeb/Controllers/SchemaMatchingController.cs`:
  source attributes with inferred type and example; rules with a source and a target, one rule per target; name-based
  automatic suggestions left pending for review; compulsory targets with fixed units; coded completion errors.

Difference from the demo: the demo matches records by an explicit stable source ID (D9) and does not model
geometric matching. It keeps RC's reviewable suggestions, one model field per mapping, and per-field validation.

## Archetypes and schedules (slice 5)

Observed:

- `EnergyAtlasWeb/wwwroot/workflow-pages/model/load-archetypes.html`, `edit-archetypes.html`,
  `archetype-assignment-tool.html`, `EnergyAtlasWeb/Planning/ArchetypeEditor.md`: load, manage, and assign archetypes;
  the editor filters by climate zone, program, and vintage and shows parts read-only.
- `EnergyAtlasWeb/Controllers/ProjectArchetypeImportsController.cs`, `EnergyAtlasWeb/Planning/TemplateAssignmentTool.md`:
  archetypes are keyed by GUID; assignment rules have priority, enablement, and attribute conditions; evaluation
  reports assigned and unassigned counts per part.
- `EnergyAtlasWeb/Controllers/ScheduleRegistryController.cs`, `EnergyAtlasLib/Zones/ZoneScheduleUtil.cs`,
  `EnergyAtlasCore/Model/Schedules/ScheduleRecipe.cs`: schedules are listed and validated (weekday/weekend, hourly, or
  constant specifications expand to a year of hours with min/max/load-hour statistics); no dedicated schedule page.

## Measures and scenarios (slice 6)

Observed:

- `EnergyAtlasWeb/Planning/MeasureEditorPage.md`, `MeasureEditor.md`: seven measure categories; per-field validation
  with Save disabled until valid.
- `EnergyAtlasWeb/Planning/ScenarioDesigner.md`, `EnergyAtlasWeb/Controllers/ScenarioDesignerController.cs`: a scenario
  is a set of prioritized rules with at most one measure per category; preview is unavailable until baseline results
  exist; the summary shows counts only, with no cost metrics.
- `EnergyAtlasWeb/wwwroot/workflow-pages/retrofit-scenarios/*.html`: scenario simulation and comparison pages are
  placeholders.

## Calibration (slice 7)

Observed:

- `EnergyAtlasWeb/wwwroot/workflow-pages/simulation/calibrate-baseline.html`: calibration is not implemented; the
  workflow continues uncalibrated.
- `EnergyAtlasWeb/Planning/SchemaMatchInputOutputReference.md`: meter input is 12 monthly kWh values per fuel per building.
- `EnergyAtlasWeb/Controllers/BuildingCalibrationController.cs`: candidate evaluation and explicit acceptance; acceptance
  is refused while a job runs or when shared inputs changed since evaluation; accepted results can be undone.
- No CV(RMSE) or NMBE computation or display was found; the demo's fit metrics and thresholds are its own.

## Results (slice 8)

Observed:

- `EnergyAtlasWeb/wwwroot/resultViewer.html`, `EnergyAtlasWeb/wwwroot/config/resultViewerDashboards.json`: dashboards
  with map and charts; result columns carry units in their names.
- `EnergyAtlasWeb/Controllers/SimulationResultsController.cs`: paged per-building detail; annual, monthly, or hourly
  aggregation; export and summary share one selection so totals agree.
- `EnergyAtlasWeb/wwwroot/workflow-pages/results-view/overview.html`: placeholder.
