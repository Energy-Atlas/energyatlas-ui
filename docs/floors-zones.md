# Floors and zones: plan and status

Date: 2026-10-28. Stage 6 of 6, the last, of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed.

## Since decision 0034

[Per-building zoning and 3D zones](per-building-zoning.md) (decision 0034, 2026-10-29) changes this stage in these
places: the zoning setting is now the project default, and a building can override it in its Properties (including
drawn zones, a fifth zone kind); preprocessing zones each building its own way and publishes the overrides it
applied; drawn zones fall back to one zone per floor with their own codes and warnings; the complete fixture zones
three neighbours their own way (510 zones instead of 464); in 3D the map draws zone edges (decision 12 below no longer holds); a building's Properties offer Show zones in 3D; and
the Table page's views name each building's zoning. Everything else below still holds, except as [decision 0035](decisions/0035-hollow-floors-and-nested-selection.md)
changes it ([status](per-building-zoning.md#since-decision-0035)): storeys above a selected floor or zone are no longer
cut away; the selected floor is drawn solid among the building's other floors drawn hollow, and the map selects a
building, then a floor, then a zone, one level per click, with Escape, Page Up, and Page Down on the focused map.

## The owner's decision

Direction A of the [next stages discussion](next-stages-discussion.md#1-floors-and-zones): a zoning setting in RC's
three modes; the map draws floors as slabs in 3D and the selected buildings' zones; Properties lists the selected
building's floors and zones, which share the selection with the Table page; zones are display only; demo-grade
geometry with the demo's own footprint inset, falling back to one zone per floor where the inset fails, and no
geometry package.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded in the [next stages discussion](next-stages-discussion.md#floors-and-zones). The facts this stage follows:

- `EnergyAtlasLib/Factory/Zoning.cs:5`: modes `Single`, `Floors`, and `PerimeterCore`; a perimeter depth and a
  sampling resolution for `PerimeterCore`.
- `EnergyAtlasLib/Factory/ThermalZoningPolicy.cs:39-51`: one policy per run; floor height is the building's height
  over its storeys, so floors are uniform. `ThermalZoningPolicy.Single` is "what a run does when it asks for no
  zoning".
- `EnergyAtlasLib/Factory/BuildingZoner.cs:19-92`: `Single` is one cell for the whole building; `Floors` cuts at floor
  heights; `PerimeterCore` buffers the floor inward by the depth for the core, then splits the band into one zone per
  boundary edge (after removing collinear points) with a Voronoi diagram of points sampled along the edges, and
  verifies that the cells cover the floor. Core cells come first.
- `EnergyAtlasWeb/Controllers/SimulationController.cs:585-598`: a run takes `zoning: {mode, perimeterDepth,
  resolution}`; `perimeterDepth` is required for `PerimeterCore` and has no default. RC's zoned-formation test uses
  4.5 m (`tests/suites/EnergyAtlas.CoreTests/ZonedFormationTests.cs:52`).
- `EnergyAtlasCore/Building/Zone.cs:28`: a zone has no core or perimeter type and no area field; zone IDs are
  positional (`EnergyAtlasLib/Factory/DeterministicIds.cs:22`). No web page shows floors or zones.

## What was built

| Part | Where |
| --- | --- |
| Footprint geometry: clean, simplicity, mitred inset with refusals, perimeter cells, edge grouping, facing | `src/domain/zoning/geometry.ts` |
| Zoning model: setting, modes, floors, zones, fallback codes, coded warnings, demand shares, ids, selection owners | `src/domain/zoning/zoning.ts` (`zoneBuilding`, `buildingZoning`, `buildingFloors`, `perimeterCorePlan`, `fallbackWarnings`, `demandShares`, `selectedBuildingIds`) |
| State and command | `state.zoning` (`ZoningState` in `src/domain/types.ts`), `zoning.set` in `src/domain/commands.ts` (server and model command in `src/server/server.ts`) |
| Preprocessing | `preprocessBuilding` and `publishPreprocessing` in `src/domain/simulation.ts`: zone counts by the setting, the published zoning, fallback warnings |
| Selection | `'floor'` and `'zone'` in `SelectableEntity`; `selectableExists` in `src/domain/selection.ts`, used by `selection.set` and `mergeServerState` |
| Saved state | `zoning` in `src/server/projectSchema.ts` with RC's default for older saves and packages; `floorSlabs` in `src/app/pages/mapLayers.ts` |
| Zoning control | `src/app/properties/ZoningForm.tsx` in Geospatial preprocessing's Properties (`StageProperties.tsx`); the zoning as a fact in `ReadOnlyDefinition.tsx` (viewer) |
| Properties | `src/app/properties/FloorsAndZones.tsx` in a building's Properties; floors and zones selections show their building (`src/app/panels/inspection.ts`) |
| Map | `src/app/pages/zoneFeatures.ts` (slabs and zone cells), `src/app/pages/ZoneLayers.tsx`, `StackLayer.tsx` (slabs), `MapPage.tsx` (sources, picking, legend, outline), `MapLayers.tsx` (Draw floors as slabs) |
| Table page | Floors and Zones tabs in `src/app/pages/FloorZoneTables.tsx`; shared grid selection in `src/app/pages/tableSelection.ts`; `table.setView` takes `floors` and `zones` (`src/app/view/tableViews.ts`) |
| Results | `src/app/pages/results/ZoneBreakdown.tsx` on a drilled-down building |
| Agent | `zoningSession` and `viewerZonesSession` in `src/app/agent/sessions.ts`; `zoning.set` waits for approval like every undoable server command |
| Capabilities | `zoning.floorsZones` (working) and `results.zoneBreakdown` (simulated) in `src/domain/capabilities.ts` |

### The zoning setting

`state.zoning` holds `mode` (`single`, `floors`, or `perimeterCore`, RC's `Single`, `Floors`, `PerimeterCore`),
`perimeterDepthM` (1 to 15 m), and `published`: the setting the last successful Geospatial preprocessing run applied,
with its run ID. `zoning.set` is a server command and a model command (refused while a run holds the project), and is
refused while Geospatial preprocessing is queued or running. A change that changes zones bumps the stage's
`editRevision`, so through the existing input signatures the stage and every later stage become Outdated and queued
or running later work is invalidated. A depth changed while the mode is not perimeter and core is kept for later and
outdates nothing.

### Floors and zones

Floors and zones are derived from a building's footprint, storeys, and height and the published zoning, and cached
per building object; nothing about them is saved.

- **Floors**: `storeys` floors of `height / storeys` each (RC's uniform floors), floor 1 at the ground, each with
  the footprint area. The storeys are those the last preprocessing run used (`published.storeys`, recorded per
  building when it publishes), so a floor count edited since changes no floor or zone until the stage runs again;
  projects saved before zoning settings use the current floor count. Floors exist for every building with a height,
  whatever the zoning.
- **Single**: one zone, `<building>:Z1`, from the ground to the roof, with the floor area of every storey.
- **Floors**: one zone per storey, `<building>:F<n>:Z1`.
- **Perimeter and core**: per storey, the core `<building>:F<n>:Z1`, then one perimeter zone per footprint edge,
  `Z2` onward, named with the direction it faces (such as "Floor 2 perimeter 3 (north)").

The footprint is projected onto a local plane in metres (the projection `ringAreaM2` uses), cleaned (closing point,
repeated points, and points within 0.1 m of the line through their neighbours removed), and turned counter-clockwise.
`insetRing` offsets every edge inward by the depth and joins neighbouring offsets at their intersection, so the core
keeps one corner per footprint corner, and the band splits along the corner bisectors into one cell per edge. It
refuses, rather than repairs, a footprint that touches or crosses itself, an offset edge that collapses or turns
round, a core that is not simple or leaves the footprint, and a core corner closer than the depth to any footprint
edge (a narrow part of a concave footprint). A core under 10 m² or under 10% of the floor is too small. A final check
that the zones' areas add up to the floor within 0.5% only catches an inverted cell: mitred cells always sum to the
footprint by construction, and the distance checks above are what keep cells from overlapping. Zone areas are scaled
so a floor's zones add up to the footprint area exactly.

Where perimeter and core cannot be made, the building gets one zone per floor, Properties says why, and the run adds
an RC-style coded warning per cause to Geospatial preprocessing's warnings (Issues and the status bar), naming up to
five buildings: `footprint_not_simple`, `perimeter_inset_failed`, or `core_too_small`. At 4.5 m, 79 of the 464
fixture footprints get perimeter and core; 359 are too narrow (mostly Back Bay row houses about 6 m wide) and 26
leave too small a core.

### Map

- **Floor slabs**: a building layer that extrudes in 3D draws one slab per storey, with a gap of 0.35 m (or a tenth
  of the floor height when less) under each slab top, from the `floor-slabs` source. "Draw floors as slabs" is a
  building layer setting in the map's Properties and in `map.setLayerStyle` (`floorSlabs`), saved with the stack
  like the other layer settings. Slabs are on by default, also for stacks saved before them.
- **Zones**: the selected buildings' zones (the buildings selected, or owning a selected floor or zone; the first 20
  only) are drawn from the `zones` source above the stack, one cell per zone and storey. Neighbouring perimeter
  zones take different categorical colours, the core takes the de-emphasis grey, storeys alternate in floors mode,
  and the selected floor or zone takes the selection colour. In 3D the zoned buildings are left out of their layers'
  slabs and extrusions, and when a floor or zone is selected the storeys above it are cut away so its plan shows;
  the selection outline follows the cut. Flat, the map shows one storey's plan (the selected floor or zone's, else
  the ground floor) with outlines. Clicking a zone selects it.
- The legend names the zoned buildings and the storey shown, one row per kind of zone drawn with the colours its
  cells use (so one zone per building shows one colour, and a selection mixing perimeter-and-core with a fallback
  shows core, perimeter, and whole-floor rows), the cut, and how many selected buildings are not drawn.

### Properties

A building's Properties gain **Floors and zones**: a summary (storeys and their height, zones and how they were
zoned), warnings, Show on Map (selects the building if needed, opens the Map, and zooms to it), and two shared
tables. **Floors** (floor, from, to, area, zones) and **Zones** (zone, type, floor, area, from, to, ID) are
`WorkbenchTable`s whose rows select a floor or zone; Floors in Table and Zones in Table open the Table page on that
view. With a published baseline both tables add a **Baseline share** column, the building's baseline split by floor
area. Selecting a floor or zone keeps its building in Properties, its eyebrow naming the floor or zone. Warnings: the
inset fallback with its code, a zoning setting not yet applied, Geospatial preprocessing outdated, and zones counted
before the zoning setting existed.

### Table page

Two new views beside Buildings and Grid elements: **Floors** (every building's floors) and **Zones** (every zone of
the published zoning). Both are AG Grid tables with the shared table bar, sharing the selection by entity type like
the other views. Their empty states name Geospatial preprocessing.

### Results

On a drilled-down building, **Show _building_ by zone (synthetic split)** opens a table of its zones with area, share,
and demand, the shown result split by floor area in whole kWh by largest remainders, so the rows and the CSV add up
to the building's published total rounded to whole kWh. The total is unchanged; the section says so and shows the
Simulated badge. The Properties tables' Baseline share uses the same split.

### Viewer

Packages carry `zoning` through the saved-project schema, so floors, zones, slabs, the Floors and Zones views, the
Properties tables, and the Results split appear in the viewer as in the modeller. The viewer shows Geospatial
preprocessing read-only with its zoning as a fact; the zoning form is left out, as every stage editor is. Its agent
has a floors-and-zones session, and "zoning" is among the model objects whose changes it refuses.

### Agent

`zoning.set` waits for approval. The modeller's **Zone by perimeter and core** session proposes perimeter and core at
4.5 m, reruns Geospatial preprocessing after a second approval, selects the largest building that kept perimeter and
core, and shows it on the 3D map with its floors, zones, and the fallback warnings. The viewer's **Floors and zones of
a building** session does the same with view operations only. `selection.set` describes floor and zone ids, so the
agent can select them.

## States

- **Empty**: a building without a height says floors and zones appear once Geospatial preprocessing has computed it;
  the Table's Floors and Zones views say what to run; nothing selected shows no zones on the map.
- **Loading**: the zoning form's Save waits for the server ("Saving…", and the button explains it is waiting); the
  rerun is an ordinary job with its progress in Jobs and the status bar.
- **Success**: the setting saved (status bar and Messages), the stage and later stages Outdated, the rerun's summary
  naming the zoning; Single gives one zone per building.
- **Warning**: the inset fallback per building and as coded preprocessing warnings; a setting not applied yet;
  preprocessing outdated; zones counted before zoning settings (older saves); selected buildings beyond the 20 drawn.
- **Error**: a server refusal on its field (`mode` or `perimeterDepthM`), a depth out of range, an unchanged setting,
  and a change while preprocessing runs, each explained; unknown floor or zone ids are refused by `selection.set`.
- **Keyboard**: the zoning form's radios and number field; the Properties tables (arrows, Space or Enter to select);
  the Table page's grids (arrows, Space); every button explains itself when unavailable.

## Real, mocked, deferred

- **Real**: the zoning setting and its command, outdating and invalidation through input signatures, uniform floor
  slicing, the perimeter-and-core inset with its fallback and coded warnings, floor and zone selection shared by
  Properties, the Table page, and the map, slabs and zones on the map, saved settings with defaults for older saves
  and packages, the viewer's display, and the agent's tools and sessions.
- **Mocked**: heights stay synthetic (floors × 3.2 m unless Schema matching maps them); per-floor and per-zone results
  are the building's result split by floor area, not simulated per zone (RC's per-zone capture is off by default and
  no web endpoint reads it).
- **Deferred**: editing zones (zone types, per-zone archetype parts), RC's sampling resolution, courtyards (only the
  outer ring of a footprint is used, as everywhere in the demo), stepped or sloped roofs, a building detail page
  (direction B), and zone geometry for more than 20 selected buildings at once (the 10,000-building benchmark is not
  scheduled).

## Decisions taken for review

1. **Default zoning: one zone per building**, RC's behaviour when a run names no zoning (`SimulationController.cs`,
   `ThermalZoningPolicy.Single`). Older saves and packages get it too.
2. **Default perimeter depth 4.5 m** (about 15 ft; RC's zoned-formation test), from 1 to 15 m; RC requires a depth
   and has no default.
3. **The setting lives in Geospatial preprocessing's Properties** (the Roadmap or Workflow stage), as an input of that
   stage. It is refused while the stage is queued or running; a depth change in another mode is kept without
   outdating anything.
4. **Zones follow the published zoning**: the setting the last successful preprocessing run applied
   (`state.zoning.published`), so changing the setting shows a warning until the rerun instead of redrawing zones that
   no run produced. Projects saved before zoning settings have none: their floors show, and their zones appear after a
   rerun; their saved zone counts (an estimate by floor area) are kept as they were.
5. **Zone counts now follow the zoning**: preprocessing publishes the number of zones under the setting, so one per
   building by default instead of the old floor-area estimate. No result reads zone counts, so building totals,
   fixtures' results, and published results are unchanged.
6. **One perimeter zone per footprint edge, with short edges merged**: after removing points within 0.1 m of a
   straight line, an edge shorter than the perimeter depth joins the zone of the edge before it, so short jogs in
   OpenStreetMap outlines do not become slivers. With fewer than three long edges every edge keeps its own zone, as in
   RC. The band is split along corner bisectors (mitre lines) rather than RC's Voronoi split, which differs near
   concave corners.
7. **Fallback thresholds**: a core under 10 m² or 10% of the floor is too small. Fallbacks give one zone per floor
   (RC would make whatever cells its buffer gives).
8. **Self-touching footprints**: none of the 464 fixture footprints touches itself (checked for every pair of edges),
   so the unit test pinches B0039's outline into one that does.
9. **Floor slabs are on by default**, a building layer setting saved with the stack; stacks saved before it read as
   on, so opening them is not an unsaved change. Slabs draw only where a layer extrudes in 3D.
10. **Zones are drawn for the first 20 selected buildings**; the legend counts the others.
11. **Zone colours** reuse the appearance's three categorical slots, cycled so neighbours differ, with the core in the
    de-emphasis grey and the selection colour for a selected floor or zone; no new tokens.
12. **3D zone outlines**: MapLibre draws no outlines on extrusions, so in 3D zones read apart by colour and the gaps
    between storeys; the flat map draws outlines. Storeys above a selected floor or zone are cut away.
13. **The Table page shows floors and zones as two more views** (tabs), each listing every building, rather than a
    filter of the Buildings view; selecting a floor or zone elsewhere does not switch the view, but Properties offers
    Floors in Table and Zones in Table.
14. **Selecting a floor or zone shows its building in Properties**, with the floor or zone highlighted in its tables;
    floors or zones of several buildings show the buildings' summary.
15. **The demand split is by floor area**, so every storey of a building gets the same share; it is shown in
    Properties (Baseline share) and on Results, labelled synthetic.
16. **A storey's area is the footprint area** even when Schema matching maps another floor area for the building;
    the building's floor area stays as published.
17. **Zone names carry the direction a perimeter zone faces** (the outward normal of its longest edge), and IDs are
    positional as in RC.

## Known issues and limits

- After a floor-count edit, Properties' Floors attribute and the Table show the new count while floors and zones keep
  the storeys of the last run until preprocessing runs again (it is Outdated, and Properties says so).
- At 4.5 m most Back Bay row houses fall back to one zone per floor; a smaller depth zones more of them.
- The Zones view lists about 3,900 rows under perimeter and core for the 464 buildings; larger districts are not
  benchmarked.
- The map canvas is not available to screen readers; the Floors and Zones views and Properties tables are the
  equivalent.

## Review (2026-10-28)

An independent review's findings, all fixed on `claude/next-stages`:

- **Medium**: floors were sliced from the building's current floor count, so an applied floor-count edit showed
  storeys and selectable zones no run produced. The run now records each building's storeys in the published zoning
  and floors are sliced from them until the next run (unit test).
- **Medium**: the map rebuilt and re-sent every floor slab on every state change. Map metrics are now memoised on the
  buildings, results, and scenarios they read, and the zone overlay on the selection, buildings, and zoning.
- **Medium**: the viewer test checked for the zoning form on the Map page. It now follows the viewer agent's stage
  reference to Geospatial preprocessing, as handed over, and checks the read-only Zoning fact and that no form, radio,
  or Save zoning is there.
- The zoning form compared and sent the perimeter depth in every mode; it now does so only for perimeter and core. An
  emptied depth is an error instead of becoming 4.5 m, and the field steps by 0.1 m like the command. The form's
  title takes the label tokens of every panel label.
- The Results split rounded each row; it now uses largest remainders (unit tested) so rows add up. The legend is built
  from the zones drawn. `map.focusSelection` names floors and zones, and refuses selections the map does not show.
  The Table page's view tabs wrap in a narrow docked Table. The coverage check is described for what it catches.

## Verification (2026-10-28)

After the review fixes: `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
`npm test`: 523 passed in 50 files (3 more: storeys kept from the last run until a rerun, largest-remainder
apportioning, and the legend built from the zones drawn; existing tests gained the whole-kWh split, an older published
zoning without storeys, and `map.focusSelection` nouns). `npm run test:e2e` on port 5180, after the last change: 128
passed with 4 workers. In the run before it, `map-table`'s "2D and 3D" test timed out at 30 s once; alone it passes in
about 27.5 s whether slabs are on or off and whether zoned buildings are filtered, so it was near its limit rather
than slowed by this stage, and it now sets a 60 s timeout like the other long flows. `npm run test:e2e:preview`: 4
passed. The Table page and a building's Properties floors and zones were reviewed at 900x700 (the view tabs fit; the
Properties tables scroll sideways in the narrow panel), and the view tabs wrap onto a second line in a 220 px docked
Table; the captures were deleted.

Before the review:


- `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
- `npm test`: 520 Vitest tests in 50 files passed (26 new). `src/domain/zoning/zoning.test.ts` covers ring cleaning,
  convex and concave insets, refused insets (collapse, a narrow concave part, a self-touching ring), edge grouping,
  fixture footprints (convex B0039, concave B0464, tiny B0001, narrow B0002, small core B0020, and B0039 pinched to
  touch itself), uniform floors and the three modes, the demand split, the setting outdating preprocessing and a rerun
  publishing zones with coded warnings, refusals on their fields, a later stage invalidated, floor and zone
  selection, and older saves. `src/app/pages/zoneFeatures.test.ts` covers slabs, zones of selected buildings only, the
  cutaway and highlight, the 20-building bound, and the view operations. Others cover slabs read for older layer
  stacks, an older handover package, and the modeller's and viewer's agent sessions.
- `npm run test:e2e` (dev server on port 5180, as port 5173 is held by the owner's RC build): 128 Playwright tests
  passed with 4 workers, including the 3 new in `e2e/floors-zones.spec.ts`. After two last small fixes (the zoning
  draft compared by value, a margin), `floors-zones`, `map-table`, and `pages` passed again (17).
- `npm run test:e2e:preview`: 4 passed.
- Screenshots of the zoning form, a building's Properties, the 3D map with slabs, zones, and the cutaway, and the
  Zones view in Light and Dark at 1280x800, and the zoning form at 900x700, were reviewed and deleted; they led to the
  cutaway above a selected floor, Show on Map, and fitted columns in the Properties tables.
