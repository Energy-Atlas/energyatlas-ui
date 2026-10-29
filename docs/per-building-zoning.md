# Per-building zoning and 3D zones: plan and status

Date: 2026-10-29. [Decision 0034](decisions/0034-per-building-zoning-and-3d-zones.md), from the owner's answers to
the [floors and zones in 3D discussion](floors-zones-3d-discussion.md) (A, R1, S2, V1). Built on
`claude/next-stages`; not merged into `master`, not pushed. It extends [floors and zones](floors-zones.md) (stage 6 of
decision 0032).

## The owner's decision

- **Per-building zoning (A).** The project keeps its default zoning mode (Geospatial preprocessing's zoning
  setting); a building can override it in its Properties: Project default, One zone, Each floor a zone, Perimeter and
  core per floor, or Drawn zones. Preprocessing applies each building's own mode, and per-zone results follow it.
- **Drawn zones are the "real zoning" case (R1)**: zone outlines per floor that no mode generated, stored with the
  project and labelled synthetic. IDF, gbXML, and IFC import stays deferred (RC has none either).
- **3D zones for selected buildings only (S2)**, with a "Show zones in 3D" action.
- **MapLibre extrusions with exploded floors and drawn edges (V1)**, no new package.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded with file and line citations in the [discussion](floors-zones-3d-discussion.md#observed-facts): RC zones
each building with its own call (`EnergyAtlasLib/Factory/BuildingZoner.cs:19-92`), so a per-building mode fits its
zoner; its three modes are `Single`, `Floors`, and `PerimeterCore` (`EnergyAtlasLib/Factory/Zoning.cs:5-39`); real
building solids enter only through Grasshopper and there is no zone import; RC's web pages extrude whole buildings
only. Nothing here is copied from RC.

## What was built

| Part | Where |
| --- | --- |
| Per-building modes, resolution, labels, the applied zoning in words, fallback codes and coded warnings | `src/domain/zoning/zoning.ts` (`BuildingZoningMode`, `resolveBuildingZoning`, `buildingZoningChanged`, `publishedZoningOf`, `plannedZoning`, `describeAppliedZoning`, `zoneTypeLabel`, `zoningFallbacks`, `fallbackWarnings`) |
| Drawn zones: shape, uses, checks against the footprint, colours | `src/domain/zoning/drawn.ts` (`drawnPlanProblem`, `drawnColorSlots`) |
| The demo's drawn floor plan and the three fixture overrides | `src/domain/zoning/drawnFixture.ts`, applied in `src/server/fixtures.ts` |
| State | `state.zoning.overrides` and `state.zoning.drawn`; `published.overrides` (what a run applied) |
| Command | `zoning.setBuilding` in `src/domain/commands.ts`, a server and model command (`src/server/server.ts`) |
| Preprocessing | `preprocessItem` and `publishPreprocessing` in `src/domain/commands.ts` and `src/domain/simulation.ts` |
| Saved state and packages | `zoning.overrides`, `zoning.drawn`, `published.overrides` in `src/server/projectSchema.ts`, each defaulting to none |
| Properties | `src/app/properties/BuildingZoningForm.tsx` in `FloorsAndZones.tsx` (the viewer shows facts instead); Show zones in 3D and Explode floors in 3D beside Show on Map |
| Show zones in 3D | `src/app/pages/showZones3d.ts` (`zones3dBlocker`, `showZonesIn3d`, `explodeBlocker`, `setExplodeFloors`); app actions `view.showZones3d` and `view.explodeZonedFloors` in `src/app/actions.ts` |
| Exploded floors | `explodeFloors` building layer setting in `src/app/pages/mapLayers.ts` (`zonesLayer`), `map.setLayerStyle`, `src/app/panels/MapLayers.tsx`; `storeySpan` and `topsM` in `src/app/pages/zoneFeatures.ts` |
| Zone edges in 3D | `zoneEdges` in `zoneFeatures.ts`; the custom WebGL layer `src/app/pages/ZoneEdgeLayer.tsx`; `zones:edges` in `ZoneLayers.tsx` |
| Map legend | `ZoneLegend` in `src/app/pages/MapPage.tsx`: drawn zones, edges, exploded floors |
| Table page | Buildings: Zoning and Zoning from (`TablePage.tsx`); Floors and Zones: Zoning and Zoning from as the last run applied (`FloorZoneTables.tsx`); drawn zone types |
| Viewer | building zoning as facts in Properties; building overrides in Geospatial preprocessing's read-only facts (`ReadOnlyDefinition.tsx`) |
| Agent | `zoningCasesSession` ("Zoning cases in 3D") in `src/app/agent/sessions.ts`; `ScriptContext.view` |
| Capabilities | `zoning.drawnZones` (simulated) in `src/domain/capabilities.ts` |

### Per-building zoning

`state.zoning.overrides` maps a building id to its own mode (`single`, `floors`, `perimeterCore`, or `drawn`); a
building without an entry follows the project's mode. Perimeter and core on a building uses the project's perimeter
depth. `zoning.setBuilding {buildingId, mode}` takes `default` or a mode; it is undoable, refused for an unknown
building (`buildingId`), an unchanged choice, a mode it does not know, and while Geospatial preprocessing is queued
or running (`mode`), and refused during any run like every model command. When the building's zones would change it
bumps the stage's `editRevision`, so through input signatures preprocessing and every later stage become Outdated and
queued later work is invalidated, exactly as `zoning.set` does. A choice that leaves the zones as they are (One zone
on a project zoned one zone per building) is saved and outdates nothing. Its summary says when a perimeter-and-core or
drawn choice will fall back, with the code.

Because buildings overridden to perimeter and core use the project's depth, `zoning.set` treats a depth change as a
change of zones whenever such a building exists, even while the project's own mode is not perimeter and core
(`projectZoningChanges`, `depthOverrides`): it outdates preprocessing and names those buildings. Geospatial
preprocessing's zoning form then shows the depth field too, saying which buildings use it.

Preprocessing zones each building by `resolveBuildingZoning(state.zoning, id)` and publishes the overrides it
applied in `published.overrides`; floors and zones follow the published zoning (`buildingZoning`), so a building's
new override shows a warning in Properties until the rerun. The run's summary and the Thermal zones asset name how
many buildings were zoned their own way.

### Drawn zones

A building's drawn zoning is `{source, plans}`: each plan covers a run of storeys (`fromFloor` to `toFloor`) with
named zones, each with a use (lobby, retail, office, apartment, corridor, core, service) and an outline in longitude
and latitude. On the building's local plane (the projection `ringAreaM2` uses), `drawnPlanProblem` checks, worst
first:

- every storey has exactly one plan, and no plan names a storey the building lacks (`drawn_floors_mismatch`);
- there are plans and zones at all (`drawn_zones_missing`);
- each outline has three corners and does not touch or cross itself (`drawn_zone_not_simple`);
- each outline stays inside the footprint within 0.25 m, sampled along its edges (`drawn_zone_outside`);
- no two zones of a plan overlap by more than 0.25 m, probed from both outlines' edges and interiors
  (`drawn_zones_overlap`);
- the zones cover at least 98% of the floor (`drawn_zones_gap`).

A building set to drawn zones without valid ones gets one zone per floor; Properties shows the reason with its code,
and the run adds an RC-style coded warning per code naming up to five buildings ("… zoned one zone per floor instead
of drawn zones because …"). Valid drawn zones become zones of kind `drawn` with positional ids
(`B0439:F1:Z1`, in the plan's order), names such as "Floor 1 lobby", and areas scaled so a floor's zones add up to the
footprint area. The core takes the de-emphasis grey; the others take the three categorical slots so neighbours
differ where three colours allow. Nothing in the UI edits outlines yet; Properties says so.

### The fixtures

Every fixture stores one hand-authored synthetic plan for **B0439** (a near-rectangle of about 43 by 37 m, 1,602 m²,
four storeys): shops either side of a lobby, a core, and a bike and mail room on the ground floor; four flats off a
corridor, a core, and a laundry on floors 2 and 3; a penthouse, two flats, a corridor, a core, and roof plant on floor
4. It is written in fractions of the building's own outline and resolved once into coordinates
(`fixtureDrawnZones`). Partway, Failed stage, and Complete then set three neighbours through `zoning.setBuilding`
before Geospatial preprocessing runs: **B0439** Drawn zones (25 zones), **B0427** Each floor a zone (9 storeys, 9
zones), and **B0426** Perimeter and core (3 storeys, 467 m², which splits at 4.5 m: 15 zones). Their centroids are
23 and 33 m from B0439's, so one view frames them. The New fixture stores the plan and overrides nothing.

Fixture totals that changed: the Partway, Failed, and Complete fixtures publish **510 zones instead of 464**; the
Thermal zones asset reads "510 zones, one zone per building; 3 buildings zoned their own way". No result reads zone
counts, so building totals, the baseline, and scenario results are unchanged.

### Map

- **Show zones in 3D** (a building's Properties, and the palette for the selected buildings): selects the building
  (`selection.set`, replacing the selection), turns the 3D view on (`map.set3d`), opens the Map, and zooms to it
  (`map.focusSelection`); unavailable with a reason when the building has no zones yet or no shown building layer
  extrudes. Zones stay for the selected buildings only, the first 20 (`MAX_ZONED_BUILDINGS`); a larger selection is
  kept whole, and the zoom's message ("Zones are drawn for the first 20 of N buildings.") and the legend count the
  rest.
- **Exploded floors**: in 3D each zoned storey is lifted by 0.8 of its floor height for every storey below it
  (`storeySpan`), so a gap of 2.56 m opens between 3.2 m storeys; the selection outline follows the exploded top. It
  is the `explodeFloors` setting of the topmost shown building layer that extrudes ("Explode zoned floors" in the
  map's Properties, `map.setLayerStyle`), also offered as "Explode floors in 3D" in the building's Properties and
  "Explode zoned floors in 3D" in the palette, which change that same setting. On any other building layer the
  checkbox is unavailable and names the layer that decides (it can still be switched off there). It is saved with the
  project's layer stack and in layouts; stacks saved before it are not exploded.
- **Zone edges**: in 3D every zone cell is outlined at its base and top with an upright at each corner, drawn by a
  custom WebGL layer (`ZoneEdgeLayer.tsx`) into MapLibre's depth buffer, so edges behind a zone are hidden by it. Each
  edge is a 1.5 px screen-space quad (2.5 px in the selection colour for a selected floor or zone) in the appearance's
  primary ink, nudged towards the camera so it wins over the face it lies on; coordinates are sent relative to each
  building's first corner with the matrix offset in double precision, so edges do not jitter at street zoom. The
  layer has its own vertex array. Flat, zones keep their existing outlines.
- In 3D, zooming to a selection now stops at zoom 17.5 with more room at the top (18 before), so a zoned building's
  storeys show.
- The legend names drawn zones (synthetic), that lines mark zone edges, and when floors are exploded.

### Properties

A building's Floors and zones section gains Show zones in 3D, Explode floors in 3D, and **Zoning of this building**:
what the last run zoned it by and whether by the project default or an override, five choices (the project default
names the project's mode), a hint per choice (for drawn zones, what the stored plans hold and that editing them is
deferred, with the Simulated badge and the source), a warning when the choice would fall back, a note when saving
outdates preprocessing or outdates nothing, and Save building zoning. The summary names the zoning as applied,
including a fallback ("each floor a zone, falling back from drawn zones (building override)"). Zone types read
"Drawn: lobby". Geospatial preprocessing's zoning form says how many buildings are zoned their own way.

### Table page

The Buildings view adds **Zoning** (the building's setting now) and **Zoning from** (Project default or Building
override). The Floors and Zones views add **Zoning** (as the last run applied it, with any fallback) and **Zoning
from**; the Zones view's note counts the buildings zoned their own way.

### Viewer

Packages carry the overrides, the drawn zones, and the published overrides through the saved-project schema. The
viewer shows a building's zoning as facts (Zoning, Drawn zones) with no form, offers Show zones in 3D and exploded
floors (view changes), and lists building overrides among Geospatial preprocessing's read-only facts.

### Agent

`zoning.setBuilding` is an agent tool that waits for approval, like every undoable server command; the viewer's agent
does not have it. The modeller's **Zoning cases in 3D** session proposes drawn zones for a building whose drawn
outlines are not used (approval), reruns Geospatial preprocessing when needed (approval), then selects one building
per case, shows them in 3D, explodes their floors, zooms to them, and describes each one. Its context can read the
view state, for the layer the zones follow.

## States

- **Empty**: a building without a height says floors and zones appear after preprocessing, and its zoning control is
  still offered; Show zones in 3D explains that the building has no zones yet; a building with no drawn zones says so
  under the Drawn zones choice.
- **Loading**: Save building zoning waits for the server ("Saving…", and the button explains it is waiting); the
  rerun is an ordinary job.
- **Success**: the choice saved (status bar and Messages), preprocessing and later stages Outdated, the rerun's zones
  in Properties, the Table, and the Map.
- **Warning**: a choice that will fall back (before saving), a building's zoning not applied yet, the fallback with
  its code after the run and as a coded preprocessing warning, preprocessing outdated.
- **Error**: an unknown building, an unchanged choice, an unknown mode, and a change while preprocessing runs, each
  refused on its field and shown in the form; a server refusal on its field (demo condition).
- **Keyboard**: the zoning radios (arrows), Save, Show zones in 3D, and the explode checkbox in Properties; both app
  actions in the palette; Shift+arrow keys tilt the focused map.

## Real, mocked, deferred

- **Real**: per-building overrides and their command with validation, undo, outdating, and invalidation; preprocessing
  per building; the published overrides; drawn zones stored with the project and checked against the footprint with
  coded fallbacks; saved projects and packages with defaults for older ones; the explode setting saved with the
  stack; the 3D edges; the Properties control, Table columns, viewer facts, palette actions, and agent session.
- **Mocked (synthetic)**: the drawn floor plan of B0439 (hand-authored, not a real plan); heights (floors × 3.2 m);
  per-zone results (the building's result split by floor area).
- **Deferred**: editing drawn outlines in the UI, importing them from IDF, gbXML, or IFC, per-building perimeter
  depths, drawn zones that differ from the footprint per storey (setbacks), zones for more than 20 selected buildings,
  and a Zones layer for every building in view (direction S1, not chosen).

## Decisions taken for review

1. **Overrides are a map from building id to mode** in `state.zoning`; Project default removes the entry. An override
   to perimeter and core uses the project's perimeter depth; there is no per-building depth.
2. **A run publishes the overrides it applied** (`published.overrides`). Drawn outlines are not copied into the
   published zoning because nothing edits them yet; an editor will have to bump preprocessing's edit revision and
   keep the outlines the run used.
3. **Drawn zones arrive as fixture data, not through a command**: every fixture stores B0439's plan from the start,
   like a delivered floor plan, and projects created on the start screen have none. There is no import or edit
   command yet, so the agent cannot add outlines either.
4. **The three fixture buildings are B0439 (drawn), B0427 (each floor), and B0426 (perimeter and core)**, chosen as a
   large near-rectangle, a nine-storey neighbour, and a neighbour that splits at 4.5 m. B0039 and B0464, which
   existing tests zone by the project's mode, were left alone. Partway and Failed stage get the same overrides as
   Complete because they also run preprocessing.
5. **The drawn plan is mixed use** (shops and a lobby below, flats above, a penthouse on top) because the building's
   synthetic use is residential; offices are among the uses but not in the demo plan.
6. **Tolerances**: 0.25 m for corners and overlaps, 98% floor coverage; the schema checks only the shape of drawn
   zones, so a project with a bad outline still opens and explains it.
7. **Drawn zones are a fifth zone kind with a use** ("Drawn: lobby" in tables), named "Floor n name", with ids in
   the plan's order; the core is grey and the other zones take neighbour-aware categorical colours.
8. **A choice that changes no zone outdates nothing** (One zone on a project zoned one zone per building). A project
   depth change outdates nothing only when neither the project's mode nor any building's override is perimeter and
   core; otherwise it outdates preprocessing, since those buildings use the project's depth.
9. **Explode floors is a building layer setting** of the layer stack (decision 0031), not a separate zones setting:
   zones replace the building layer's slabs for the zoned buildings, and the topmost shown building layer that
   extrudes decides. This keeps it in the saved stack and in layouts with no new saved field. The building's
   Properties and the palette offer the same setting so it can be switched while a building is selected (the map's
   Properties show only while nothing is selected).
10. **Only the zoned (selected) buildings explode**, by 0.8 of a floor height per storey below; other buildings keep
    their slabs.
11. **Edges use the appearance's primary ink** (the selection colour for a selected floor or zone), 1.5 px wide, and
    show only in 3D; the flat map keeps its surface-coloured outlines.
12. **Show zones in 3D replaces the selection** with the building and turns 3D on; in 3D every zoom to the selection
    now stops at zoom 17.5 instead of 18.
13. **The Buildings view shows the setting now; the Floors and Zones views show the zoning the last run applied**, so
    a pending change appears in Buildings before the rerun and in Floors and Zones after it.
14. **The viewer keeps Show zones in 3D and exploded floors** as view changes; the zoning control is left out.
15. **A pre-existing defect was fixed**: switching the zones from the flat plan to 3D in one step (as Show zones in
    3D does) kept MapLibre's flat plan layer, because react-maplibre keeps the id and type a layer was mounted with and
    React reused the unkeyed layer; the zone layers are now keyed.

## Known issues and limits

- Edges and exploded floors are checked by screenshot review only; the specs check the legend, the setting, and the
  controls, not WebGL pixels.
- The edge layer uses the Mercator matrix and draws nothing while the globe projection is still blending in (zoomed
  far out, where zones are too small to read anyway).
- The selection outline of an exploded building encloses its gaps (it is a prism to the exploded top).
- Edge corners are not mitred, so a 2.5 px selected edge shows small notches at corners.
- The flat map's zone legend lists the colours of every floor's zones, not only the floor shown (as before).
- Edges are lifted by terrain sampled at the mean vertex of the building's first zone cell, not at the footprint
  centroid MapLibre lifts extrusions by, so on steep terrain they can sit slightly off the zones.
- Drawn-zone checks sample points along and inside each outline and sum zone areas rather than computing polygon
  unions and intersections, so a narrow overlap that no sample falls in (thinner than about the sampling step and
  the 0.25 m tolerance) can slip through, and coverage is judged by summed area.
- A saved drawn plan may name floors up to 500 (`MAX_DRAWN_FLOOR`); the check counts only the storeys the building
  has.
- With the map's Properties hidden while a building is selected, the explode setting is reached from the building's
  Properties or the palette.

## Review (2026-10-29)

An independent review's findings, fixed in one follow-up commit on `claude/next-stages`:

- **Medium**: a project depth change while the project was not zoned by perimeter and core said the depth was unused
  and outdated nothing, though buildings overridden to perimeter and core use it. It now outdates preprocessing and
  names them, and the zoning form shows the depth when they exist (unit test).
- The edge layer detaches and deletes its shaders after linking, deletes the program and vertex array when compiling
  or linking fails, releases everything on removal, and releases its previous GL resources in `onAdd` (a full style
  reload drops custom layers without `onRemove` and adds the same layer object again); resources are deleted only
  through the context that made them (unit test). `SelectionSilhouette` holds no GL resources (it draws on a 2D
  canvas), so it needed no change.
- A hand-edited save naming a drawn plan up to floor 10⁹ hung the check, which counted floor by floor: saves are
  bounded to floor 500, and the check counts only the building's storeys (unit test).
- "Explode zoned floors" was offered on every extruding building layer though only the topmost shown one decides; it
  is now unavailable on the others and names the deciding layer. Both explode checkboxes are described by their
  explanation (`aria-describedby`), which says it takes effect in 3D while the map is flat.
- Show zones in 3D cut a selection over 20 buildings silently; it keeps the selection and the zoom's message says
  how many get zones (unit test).
- Documented: the edges' terrain anchor and the sampled drawn-zone checks (known issues above).

## Verification (2026-10-29)

After the review fixes: `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean;
`npm test`: 559 passed in 51 files (4 more: the depth used by overrides, a plan naming far floors and the bounded
save, GL release by context, and a large selection's message; a stage 6 test now clears B0426's override before
keeping a depth); dev e2e on port 5180: 133 passed with 4 workers, none failed or retried; `npm run
test:e2e:preview`: 4 passed. The review screenshots were retaken.

Built in `0b8e061`. Before it, on the final code:

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
- `npm test`: 555 Vitest tests in 51 files passed (30 more than the 525 before). New:
  `src/domain/zoning/perBuilding.test.ts` (21: drawn-zone checks for a valid plan, floors that differ, missing,
  doubled, and extra floors, a self-crossing, outside, overlapping, and duplicated zone, and a gap; the fixture's
  three cases, their zones, areas, and neighbourhood; the 510-zone total; the New fixture; fallbacks for missing
  drawn zones and an edited floor count, and their coded warning; the command's outdating, rerun, undo and redo,
  fallback note, no-op change, return to the default, and refusals on their fields; older saves, a round trip, and
  refused saves), `src/app/pages/zoneFeatures.test.ts` (6: exploded storey spans, cell counts and drawn tops with a
  cut, edge segments and WebGL vertices, the double-precision matrix offset and colour parsing, the explode layer
  setting and older stacks, and Show zones in 3D with its reasons), `src/app/agent/scriptedAgent.test.ts` (2: the
  Zoning cases in 3D session with its two approvals, and the tool's approval and absence from the viewer), and
  `src/server/handover.test.ts` (1: packages carry overrides and drawn zones, and older packages open).
- Dev e2e on port 5180 (`npx playwright test -c tmp/playwright.5180.config.ts`, 4 workers): 133 passed, including
  the 5 new tests in `e2e/per-building-zoning.spec.ts`; no test failed or was retried.
- `npm run test:e2e:preview`: 4 passed.
- Review screenshots at 1440x900 of the three cases in 3D exploded and closed, in the dark appearance, B0439 in 3D,
  exploded, and flat, the building's Properties and zoning control, a fallback before and after the rerun, and the
  Table's Zones and Buildings views were looked at; they led to the zone layers being keyed (the flat plan had
  survived the switch to 3D), the edge layer's own vertex array, one zoning choice per line, wording for buildings
  without drawn zones, and a wider 3D zoom.
