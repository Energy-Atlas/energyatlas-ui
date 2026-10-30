# Per-building zoning and 3D zones: plan and status

Date: 2026-10-29. [Decision 0034](decisions/0034-per-building-zoning-and-3d-zones.md), from the owner's answers to
the [floors and zones in 3D discussion](floors-zones-3d-discussion.md) (A, R1, S2, V1). Built on
`claude/next-stages`; not merged into `master`, not pushed. It extends [floors and zones](floors-zones.md) (stage 6 of
decision 0032).

**Superseded in large part by [decision 0036](decisions/0036-owner-review-of-next-stages.md)**: zoning is the
backend's, the browser only displays zone geometry, and per-building zoning, drawn-zone checks, Show zones in 3D,
floor slabs, and per-zone results are removed; nested selection and hollow floors stay. See
[Since decision 0036](#since-decision-0036); the sections before it record what was built and reviewed earlier.

## The owner's decision

- **Per-building zoning (A).** The project keeps its default zoning mode (Geospatial preprocessing's zoning
  setting); a building can override it in its Properties: Project default, One zone, Each floor a zone, Perimeter and
  core per floor, or Drawn zones. Preprocessing applies each building's own mode, and per-zone results follow it.
- **Drawn zones are the "real zoning" case (R1)**: zone outlines per floor that no mode generated, stored with the
  project and labelled synthetic. IDF, gbXML, and IFC import stays deferred (RC has none either).
- **3D zones for selected buildings only (S2)**, with a "Show zones in 3D" action.
- **MapLibre extrusions with exploded floors and drawn edges (V1)**, no new package. Exploded floors were removed
  by [decision 0035](decisions/0035-hollow-floors-and-nested-selection.md) in favour of hollow floors and nested
  selection ([below](#since-decision-0035)).

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
| Properties | `src/app/properties/BuildingZoningForm.tsx` in `FloorsAndZones.tsx` (the viewer shows facts instead); Show zones in 3D beside Show on Map |
| Show zones in 3D | `src/app/pages/showZones3d.ts` (`zones3dBlocker`, `showZonesIn3d`); the app action `view.showZones3d` in `src/app/actions.ts` |
| Exploded floors | removed by decision 0035; `storeySpan` in `src/app/pages/zoneFeatures.ts` keeps every storey at its height |
| Zone edges in 3D | `zoneEdges` in `zoneFeatures.ts`; the custom WebGL layer `src/app/pages/ZoneEdgeLayer.tsx`; `zones:edges` in `ZoneLayers.tsx` |
| Map legend | `ZoneLegend` in `src/app/pages/MapPage.tsx`: drawn zones, edges, and (decision 0035) the selected floor among hollow floors |
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
- **Exploded floors** were removed by decision 0035; see [Since decision 0035](#since-decision-0035).
- **Zone edges**: in 3D every zone cell is outlined at its base and top with an upright at each corner, drawn by a
  custom WebGL layer (`ZoneEdgeLayer.tsx`) into MapLibre's depth buffer, so edges behind a zone are hidden by it. Each
  edge is a 1.5 px screen-space quad (2.5 px in the selection colour for a selected floor or zone) in the appearance's
  primary ink, nudged towards the camera so it wins over the face it lies on; coordinates are sent relative to each
  building's first corner with the matrix offset in double precision, so edges do not jitter at street zoom. The
  layer has its own vertex array. Flat, zones keep their existing outlines.
- In 3D, zooming to a selection now stops at zoom 17.5 with more room at the top (18 before), so a zoned building's
  storeys show.
- The legend names drawn zones (synthetic) and that lines mark zone edges.

### Properties

A building's Floors and zones section gains Show zones in 3D and **Zoning of this building**:
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
viewer shows a building's zoning as facts (Zoning, Drawn zones) with no form, offers Show zones in 3D and the map's nested selection (view changes), and lists building overrides among Geospatial preprocessing's read-only facts.

### Agent

`zoning.setBuilding` is an agent tool that waits for approval, like every undoable server command; the viewer's agent
does not have it. The modeller's **Zoning cases in 3D** session proposes drawn zones for a building whose drawn
outlines are not used (approval), reruns Geospatial preprocessing when needed (approval), then selects one building
per case, shows them in 3D, zooms to them, and describes each one, then (decision 0035) selects the drawn building, its
floor 2, and a zone on it. Its context can read the
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
- **Keyboard**: the zoning radios (arrows), Save, and Show zones in 3D in Properties; the Show zones in 3D app action
  in the palette; Shift+arrow keys tilt the focused map, and (decision 0035) Escape, Page Up, and Page Down change
  the selection level and floor.

## Real, mocked, deferred

- **Real**: per-building overrides and their command with validation, undo, outdating, and invalidation; preprocessing
  per building; the published overrides; drawn zones stored with the project and checked against the footprint with
  coded fallbacks; saved projects and packages with defaults for older ones; the 3D edges; the Properties control, Table columns, viewer facts, palette actions, and agent session.
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
9. *(Removed by decision 0035.)* **Explode floors is a building layer setting** of the layer stack (decision 0031), not a separate zones setting:
   zones replace the building layer's slabs for the zoned buildings, and the topmost shown building layer that
   extrudes decides. This keeps it in the saved stack and in layouts with no new saved field. The building's
   Properties and the palette offer the same setting so it can be switched while a building is selected (the map's
   Properties show only while nothing is selected).
10. *(Removed by decision 0035.)* **Only the zoned (selected) buildings explode**, by 0.8 of a floor height per storey below; other buildings keep
    their slabs.
11. **Edges use the appearance's primary ink** (the selection colour for a selected floor or zone), 1.5 px wide, and
    show only in 3D; the flat map keeps its surface-coloured outlines.
12. **Show zones in 3D replaces the selection** with the building and turns 3D on; in 3D every zoom to the selection
    now stops at zoom 17.5 instead of 18.
13. **The Buildings view shows the setting now; the Floors and Zones views show the zoning the last run applied**, so
    a pending change appears in Buildings before the rerun and in Floors and Zones after it.
14. **The viewer keeps Show zones in 3D** (and, until decision 0035, exploded floors) as view changes; the zoning
    control is left out.
15. **A pre-existing defect was fixed**: switching the zones from the flat plan to 3D in one step (as Show zones in
    3D does) kept MapLibre's flat plan layer, because react-maplibre keeps the id and type a layer was mounted with and
    React reused the unkeyed layer; the zone layers are now keyed.

## Known issues and limits

- Edges and hollow floors are checked by screenshot review only; the specs check the legend, the selection, and the
  controls, not WebGL pixels.
- The edge layer uses the Mercator matrix and draws nothing while the globe projection is still blending in (zoomed
  far out, where zones are too small to read anyway).
- Edge corners are not mitred, so a 2.5 px selected edge shows small notches at corners.
- The flat map's zone legend lists the colours of every floor's zones, not only the floor shown (as before).
- Edges are lifted by terrain sampled at the mean vertex of the building's first zone cell, not at the footprint
  centroid MapLibre lifts extrusions by, so on steep terrain they can sit slightly off the zones.
- Drawn-zone checks sample points along and inside each outline and sum zone areas rather than computing polygon
  unions and intersections, so a narrow overlap that no sample falls in (thinner than about the sampling step and
  the 0.25 m tolerance) can slip through, and coverage is judged by summed area.
- A saved drawn plan may name floors up to 500 (`MAX_DRAWN_FLOOR`); the check counts only the storeys the building
  has.

## Since decision 0035

Date: 2026-10-29. [Decision 0035](decisions/0035-hollow-floors-and-nested-selection.md), from the owner's review of
F5: geometry less changed. Built on `claude/next-stages`; not merged, not pushed.

### What changed

| Part | Where |
| --- | --- |
| Exploded floors removed | the `explodeFloors` layer setting, both checkboxes, the palette action, the agent's step, the storey lift, and the legend text; `mapLayers.ts` drops the key from stacks saved with it (zod strips it), so they open with no unsaved change |
| Selection levels | `src/app/pages/mapSelection.ts`: `clickTarget` (what a click selects from the selection now and the hits, nearest first), `upTarget` (Escape), `stepTarget` (Page Up and Page Down), `describeTarget` (hover labels) |
| Map | `MapPage.tsx`: clicks and hover go through `clickTarget`; keys on the focused map through `upTarget` and `stepTarget`; the selection outline is the whole building |
| Cell states | `zoneOverlay` in `zoneFeatures.ts`: each cell is `zone`, `floor`, `selected`, `muted`, or `hollow`; `focus` and `hollow` replace the cut; `selectedFloorsByBuilding`, `floorNumberOf` |
| 3D drawing | `ZoneLayers.tsx`: `zones:extrusion` (solid cells: zone colours, the selected zone in the selection colour, other zones of its floor muted), then the edge layer, then `zones:hollow` (a faint shell); `ZoneEdgeLayer.tsx` draws four edge styles |
| Tokens | `hollow: { opacity, edgeAlpha, muted }` in every appearance's data palette (`appearances.ts`; `muted` added by the review fixes) |
| Agent | the Zoning cases in 3D session ends by selecting B0439, its floor 2, and a zone on it, through `selection.set` |

**Nested selection.** On the map a click on an unselected building selects it. With a building selected, a click on
it selects the floor under the pointer: in 3D the storey hit, flat the floor whose plan is shown. With a floor
selected, a click on it selects the zone under the pointer, and a click on another of its floors selects that floor.
With a zone selected, a click on its floor selects another zone, and elsewhere in the building the floor hit. A
click on another building selects that building, and an empty spot clears the selection as before. Shift adds or
removes at the same level within the building (floors of the selected building, zones of the selected floor); Shift
on another building selects it, and buildings still add and remove with Shift. The Table, Assets, Properties tables,
and the agent still select floors and zones directly. Hover labels name what a click would select, such as
"Floor 2 of Building 439".

**Keyboard.** With the map focused, Escape goes up a level (zone to its floor, floor to its building, building to
nothing, a whole-building zone to its building), and with a floor or zone selected Page Up and Page Down select the
floor above or below (they stop at the top and bottom and say so). MapLibre's own keys (arrows, Shift+arrows, plus and minus) and
the app's shortcuts use none of these. Properties lists a building's floors and zones for selection, as before.

**Hollow floors.** With a building selected, its zones are drawn as in decision 0034. With a floor or zone selected,
that floor is solid with its zones and emphasised edges (2.25 px), the selected zone takes the selection colour with
2.5 px edges in that colour and the floor's other zones are muted, and the building's other floors are hollow: a
faint shell in the de-emphasis colour at the appearance's `hollow.opacity` (0.12 in light appearances, 0.16 in dark
ones) with 1 px edges at `hollow.edgeAlpha`. Nothing is cut away or moved. MapLibre writes a translucent extrusion's
depth before its colour, so the solid cells and the edges are drawn first and the hollow shell last; the selected
floor and its edges show through the shells from above and from a low angle (checked by screenshot in light and
dark). MapLibre sorts 3D hits across extrusion layers by depth, and a hit on the selected floor wins over nearer
hollow floors in front of it, so its zones can be picked through them. Flat, the map still shows one floor's plan:
the selected floor or zone's, else the ground floor.

### States

- **Empty**: nothing selected draws no zones; a selected building without zones has no floor level on the map until
  preprocessing zones it (a click on it changes nothing in 3D without slabs; flat it selects the floor shown).
- **Success**: each click and key reports the selection in the status bar and Messages, and Properties follows it.
- **Warning/error**: none new; selection ids are still checked by `selection.set`.
- **Keyboard**: Escape, Page Up, and Page Down on the focused map; the Properties tables; the palette's Show zones in
  3D.

### Real, mocked, deferred

- **Real**: the selection levels and their rules, the keys, the hollow and solid drawing with its tokens, the hover
  labels, and the agent's levels.
- **Mocked**: nothing new; zones stay display only.
- **Deferred**: picking a hollow floor that lies entirely behind the selected floor from where one looks (from above,
  floors above the selected one cover it: use Page Up, Page Down, or a side view), and keyboard picking of a zone
  inside a floor (use the Properties zones table).

### Decisions taken for review (decision 0035)

1. **Page Up and Page Down** step floors and **Escape** goes up a level, on the focused map only; arrow keys stay
   MapLibre's.
2. **A hit on the selected floor wins** over hollow floors in front of it, so zones can be picked from above; another
   floor is chosen where it is not in front of the selected one, or by keyboard.
3. **Shift** adds within the building at the floor or zone level; Shift on another building selects that building
   (it does not add across buildings), while buildings still add with Shift.
4. **Flat**, a click on a selected building selects the floor whose plan is shown (floor 1 until another is chosen).
5. **Colours**: a selected zone in the selection colour, the floor's other zones and a muted core in the de-emphasis
   colour; hollow shells in the de-emphasis colour; new `hollow` tokens per appearance.
6. **The selection outline** is the whole building again (nothing is cut away).
7. **Properties is unchanged**: its Floors and Zones tables already list every floor and zone for selection; the
   Zones table is not narrowed to the selected floor.
8. **The agent session** demonstrates the levels with `selection.set` on B0439, its floor 2, and the floor's first
   zone that is not its core (its corridor).

### Known issues

- From straight above, the floors above a selected floor cover it, so another floor cannot be clicked there.
- In the light appearances muted zones and the core share the de-emphasis colour and the selection colour is dark,
  so a selected zone reads as a dark cell among grey ones; edges in the selection colour mark it too. In Monochrome
  and Lieflat the selection colour is a hue close in lightness to the muted grey.
- In the dark appearances, hollow floors below a selected floor read as a dark box against the dark ground (see
  the review fixes).
- Shift-drag box zoom is off on the map, since Shift-click selects.
- Hover labels and clicks depend on MapLibre's 3D hit test of extrusions, checked in e2e at the framed centre only.
- Hollow floors and edges are checked by screenshot review only.

### Verification (decision 0035)

On the final code, before the commit:

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
- `npm test`: 571 passed in 52 files (12 more than the 559 before). New: `src/app/pages/mapSelection.test.ts` (12:
  building, floor, then zone; another floor from a floor or a zone; the selected floor picked through nearer hollow
  floors; another building; the flat map's floor; an empty spot and grid elements; Shift for floors, zones, and
  buildings; Escape; Page Up and Page Down with their ends; hover labels). Changed: `zoneFeatures.test.ts` (cell states
  instead of the cut, storeys kept at their heights, a floor of one case among hollow floors, a whole-building zone,
  edges by style, and a stack saved with `explodeFloors` opening without it and with no unsaved change) and the agent's
  Zoning cases session (it ends on B0439's floor 2 corridor).
- Dev e2e on port 5180 (`npx playwright test -c tmp/playwright.5180.config.ts`, 4 workers): 134 passed (the explode
  test was replaced by two: clicks down on the flat map with the hover label, Page Up and Page Down, and Escape up;
  and in 3D a floor then a zone clicked with hollow floors in the legend), none failed or retried.
- `npm run test:e2e:preview`: 4 passed.
- Review screenshots at 1440x900: a selected building's zones, floor 2 selected among hollow floors from the side,
  from above, and from a low angle, in light and dark, a selected zone, and floor 2's flat plan with the zone
  selected; they led to the hollow shell being drawn after the edges, a stronger legend swatch, and the e2e and
  review steps pausing between tilt keys (MapLibre eases each key, and a key pressed during the ease cancels it).

### Review fixes (2026-10-29)

From a review of decision 0035's build; not merged, not pushed.

- **Shift-click reaches the selection.** MapLibre's box zoom (Shift-drag) swallowed every click with Shift held, so
  Shift never added a floor, zone, or building on the map. Box zoom is off (`boxZoom={false}` in `MapPage.tsx`):
  **Shift-drag no longer zooms to a box**; the zoom buttons, the wheel, and plus and minus still zoom. New e2e: a
  Shift-click adds a second zone of floor 1 (`Selected 2 zone(s).`) and a second Shift-click removes it.
- **A selected whole-building zone** (one zone per building, such as B0464's) is drawn in the selection colour on
  every storey with selected edges, the building's other zones muted, and the legend says "Whole-building zone of
  B0464 selected, on every floor." (`focus.level` is `building zone` in `zoneOverlay`).
- **No silent no-ops on the map.** A click or key that changes nothing says why in the status bar and Messages (a
  `view.mapSelection` entry with the reason on `selection`, so a warning without a toast): Page Up on the top floor
  ("Floor 4 is the top floor of Building 439."), Page Down on the bottom floor, either key with a building selected
  ("Select a floor first: click the selected building, or choose one in its Floors table.") or with a whole-building
  zone selected, a selected whole-building zone clicked again, a Shift-click that would leave nothing selected, and
  a click on a selected building with no storeys drawn (`clickNotice` and `stepNotice` in `mapSelection.ts`).
- **Hover labels follow the selection.** The label is derived from the last pointer hits on every render, so it
  changes after a click or key without a mouse move; on a Shift-click it names the item under the pointer ("Floor 3
  of Building 439 and 1 more", or "Remove … from the selection"), not the first selected item (`describeClick`).
- **The selected floor's hit wins only over its own building**: a nearer hit on another building or a grid element
  is what the click is on (`primaryHit`; unit test).
- **Dark appearances**: the other zones of a selected zone's floor take a new `hollow.muted` token, darker than the
  de-emphasis colour in Dark (`#4d4c48`) and Dark engineering (`#464b51`); the light appearances keep the
  de-emphasis colour. On lit top faces a selected zone against its neighbours went from about 1.6:1 to 3.3:1. The
  hollow floors below a selected floor still read dark against the dark ground: the shell is translucent and the
  ground under it is black, so raising `hollow.opacity` (tried 0.24 and 0.34) only greyed it slightly while
  veiling the selected floor from above; the opacity is unchanged, and this stays a known issue.

Left for the owner: what a click does with several buildings selected, and whether Page Down on a selected building
should enter its first floor.

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

## Since decision 0036

Date: 2026-10-29. [Decision 0036](decisions/0036-owner-review-of-next-stages.md), the owner's review of the next
stages, items M1 to M8 and the camera of L1. Built on `claude/0036-map-zones` (from `claude/next-stages` at
`061cb41`), fast-forwarded into `claude/next-stages` on 2026-10-30; not merged into `master`, not pushed. It supersedes most of this record above: per-building zoning, drawn-zone checks,
the project zoning setting, floor slabs, and per-zone results are gone. Nested selection and hollow floors
(decision 0035) stay.

### What changed

| Item | Change | Where |
| --- | --- | --- |
| M1 | **Show zones in 3D retired**: the Properties button, the `view.showZones3d` palette action, and `showZones3d.ts`. The agent's Zoning cases in 3D session reaches the same view through `selection.set`, `layout.openPage`, `map.set3d`, and `map.focusSelection`. | `src/app/actions.ts`, `src/app/properties/FloorsAndZones.tsx`, `src/app/agent/sessions.ts` |
| M2 | **A selected zone keeps its colour and so do its neighbours**; its edges in the selection colour mark it (3 px). The muted cell state and the `hollow.muted` token are gone. The bug that a click on a floor always picked the same zone is fixed (root cause below). | `zoneOverlay` (`src/app/pages/zoneFeatures.ts`), `ZoneLayers.tsx`, `appearances.ts` |
| M3 | **A click in 3D picks what is in front.** The map casts the pointer's ray against every drawn zone cell and extruded building itself and orders hits by distance. | `src/app/pages/mapPicking.ts`, `featuresAt` in `MapPage.tsx` |
| M4, M6 | **Zoning is the backend's**: no zoning setting form, perimeter depth, `zoning.set`, generation (`geometry.ts`), drawn-zone checks (`drawn.ts`), fallback codes, or outdating. Zones come from `state.zoning.geometry`; a building without zone geometry is one zone. | `src/domain/zoning/zoning.ts`, `src/domain/commands.ts`, `src/domain/simulation.ts` |
| M5 | **No per-building zoning control**: `BuildingZoningForm.tsx`, `zoning.setBuilding`, and `state.zoning.overrides` are gone; zones are read-only everywhere. | as above |
| M4 | **Fixture zone geometry** for B0439 (the drawn mixed-use plan, 25 zones), B0427 (each floor a zone, 9), and B0426 (perimeter and core at 4.5 m, 15), generated offline and committed; every zone of a floor tiles the footprint exactly. | `scripts/generate-zone-geometry.mjs`, `src/domain/fixtures/zone-geometry.json`, `src/domain/zoning/fixtureGeometry.ts` |
| M4 | **3D drawing**: storeys span their floors exactly (the slab gap is gone), so the zones make up the extrusion; every edge is drawn once, as the building's envelope or, in a colour of its own, a boundary between zones; edges behind a volume stay hidden. | `zoneEdges` (`zoneFeatures.ts`), `ZoneEdgeLayer.tsx`, the `zoneEdges` tokens |
| M7 | **No floor slabs**: the Buildings layer's Draw floors as slabs setting, its drawing, the `floor-slabs` source, and `floorSlabs` in the layer stack and `map.setLayerStyle`. | `mapLayers.ts`, `StackLayer.tsx`, `MapLayers.tsx`, `viewOperations.ts` |
| M8 | **No per-zone results**: the Results page's "by zone (synthetic split)" section and the Properties tables' Baseline share column, with `demandShares` and the `results.zoneBreakdown` capability. | `ResultsPage.tsx`, `FloorsAndZones.tsx` |
| L1 | **The map camera is view state**: centre, zoom, pitch, and bearing, kept in step with the map, moved by `map.setCamera`, restored when a layout is applied or a project opens, and saved with the project. | `src/app/view/mapCamera.ts`, `map.setCamera` and `map.syncCamera` in `viewOperations.ts`, `savedLayout.ts`, `MapPage.tsx` |
| Defect | **The hover label follows keys and Shift**: after Page Up, Page Down, Escape, or a click the map queries the hits again where the pointer rests once it has drawn the change; Shift pressed or released changes the label without a move. | `MapPage.tsx` |

Geospatial preprocessing's Properties now say where zones come from ("Zoning is done by the backend…", with the
buildings that have zone geometry); the viewer shows the same as a fact. The Table page's Buildings, Floors, and Zones
views keep their Zoning column (now what the building got: one zone, each floor a zone, perimeter and core zones, or
zones of its floor plans) and rename Zoning from to **Zones from** (Zone geometry or No zone geometry).

### The M2 root cause

The selection rules (`clickTarget` in `mapSelection.ts`) take the map's hits nearest first, and the map passed on
MapLibre's `queryRenderedFeatures` as it came. In MapLibre 6.9.1 that order is not nearest first for fill-extrusion
features: measured on B0439 with a ray cast from MapLibre's own camera, the four storeys under the pointer came back
ground floor first (distances 0.986, 0.969, 0.953, 0.941 along the ray), and at some points the face in front was left
out altogether (a click on the roof's penthouse returned only the core cells of each storey, met by the ray inside the
building). So a click on a building selected its ground floor, a click on a selected floor picked the cell where the
ray left the floor or a cell behind it, which for much of a floor was the same cell, and a building behind another
could take the click (M3). The map now ignores MapLibre's extrusion hits in 3D and casts the ray itself: the camera from
MapLibre's public getters (centre, centre elevation, zoom, pitch, bearing, field of view, canvas height; checked to
match MapLibre's internal camera to about 1e-10), the ground point under the pointer from `unproject`, and every drawn
zone cell and extruded building as a prism. Flat, MapLibre's hits are used as before.

### Fixture zone geometry

`scripts/generate-zone-geometry.mjs` reads `back-bay-buildings.geo.json` and writes `zone-geometry.json` (formatted
by Prettier). B0439's plan is the hand-authored plan of decision 0034 in fractions of its four-cornered outline,
mapped bilinearly (straight lines stay straight); every corner of a zone that lies on a neighbour's wall is inserted
into that wall too, so no wall has a T-junction. B0426's core is its outline inset by 4.5 m (each core corner where
the offsets of the edges beside a footprint corner meet), and each perimeter zone runs between a footprint edge and
the core edge inside it, so neighbours share their corners exactly; core corners are rounded once to 1e-9° and
footprint corners are copied unchanged. B0427 is its footprint on every floor. `zoning.test.ts` checks that every wall
of every zone either lies on the footprint outline or is the reverse of exactly one neighbour's wall, that windings
match the footprint, that areas add up to the footprint's, and that footprint corners are the footprint's own numbers.

Fixture totals are unchanged: the three buildings have the same zone counts as their decision 0034 overrides gave
them, so the Partway, Failed, and Complete fixtures still publish 510 zones; the Thermal zones asset reads "510 zones,
3 buildings zoned by their zone geometry, the rest one zone each". The New fixture stores the geometry and zones
nothing until Geospatial preprocessing runs; projects created on the start screen have no zone geometry.

### Edges in 3D

`zoneEdges` builds the edges of each building's zone cells once. At every storey level, each wall's top or bottom edge
is split at every zone corner on it at that level (so plans above and below that split a wall differently give one
line, drawn in pieces), and kept when it is the building's outline at the ground or the roof (envelope) or when it
parts two zones (boundary: between neighbours on a floor, or between a zone and the zone above it). An upright is kept
per storey at the footprint's corners (envelope) and where two zones meet elsewhere (boundary). A whole-building zone
therefore shows only its envelope, and each-floor-a-zone shows one line round the facade at every floor. The two
causes of the doubled lines the owner saw were each shared wall being drawn by both of its zones and each floor being
drawn twice, the top of one storey and the base of the next a slab gap (0.35 m) apart; both are gone.

Envelope edges take the appearance's `zoneEdges.envelope` (its primary ink) and boundaries `zoneEdges.boundary` (its
surface colour, at least 3:1 against every zone colour in every appearance; appearance test). A selected zone's
edges take the selection colour, a selected floor's are emphasised, and hollow floors' are faint. The short tails of
occluded lines came from the old clip-space depth bias (2.5e-4 of normalized depth, several metres at street zoom):
each vertex is now pulled towards the camera along its own line of sight by 1.5 pixels' worth of distance, which
leaves it where it is on screen and lets the depth test hide anything more than that behind a volume.

### The camera (L1)

`view.map.camera` holds `{center, zoom, pitch, bearing}` (`src/app/view/mapCamera.ts`, rounded so float noise is no
change). The map records every move it makes with the internal `map.syncCamera` (left out of the agent's tools and of
the operation log); `map.setCamera` (an agent tool) moves the map by bumping `cameraRequest`, as applying a layout and
opening a project with a saved camera do. A layout saved with a camera restores it when applied (flat layouts keep
centre and zoom, not tilt); layouts saved before keep the map where it is. The project saves the camera with its other
views (`camera` in the saved view and in packages); a project opening with a camera near its footprints opens there,
otherwise it is framed as before.

### States

- **Empty**: a building without zone geometry is one zone and says so ("with no zone geometry from the backend"); no
  building has floors or zones before Geospatial preprocessing; a project without a camera is framed on its
  footprints.
- **Success**: clicks and keys report the selection in the status bar and Messages; a layout applied moves the map.
- **Warning**: zone geometry that does not cover a building's floors (after its floor count is edited and the stage
  rerun) is not shown, Properties says why, and the building is one zone until the backend zones it again;
  Geospatial preprocessing outdated.
- **Error**: `map.setCamera` refuses a zoom or centre out of range on its field; a saved camera that cannot be read is
  ignored.
- **Keyboard**: Escape, Page Up, and Page Down on the focused map (decision 0035); the Properties tables; the hover
  label follows Shift.

### Real, mocked, deferred

- **Real**: displaying zone geometry (floors, zones, tables, map, viewer); the tiling of the fixture geometry and its
  check; the edge classification, the occlusion handling, and the tokens; ray picking in 3D; nested selection and
  hollow floors; the camera as view state, in layouts, and saved with the project; saved projects with the removed
  fields opening without them.
- **Mocked**: the zone geometry itself, precomputed offline for three buildings and labelled synthetic (the `Zone
  geometry` capability, simulated), standing in for the backend's zoning.
- **Deferred**: receiving zone geometry from the backend (RC or the EnergyAtlas backend), per-zone results, zone
  geometry for every building, zones for more than 20 selected buildings, and Show zones in 3D for another purpose.

### Decisions taken for review

1. **The project zoning setting and `zoning.set` are removed too**, not only the per-building control: decision 0036
   says "no zoning setting", and with zones as the backend's there is nothing left for them to set.
2. **The Properties tables' Baseline share column is removed with the Results split** (M8), since it was the same
   floor-area split.
3. **Saved `drawn` outlines are dropped, not converted** into zone geometry: they came only from this unmerged branch,
   and the fixture geometry replaces them; such a project shows its buildings as one zone each.
4. **Geometry that does not cover a building's floors is not shown** (one zone, with a note): a display guard rather
   than a validation, for a floor count edited after the backend zoned the building.
5. **Colour slots are assigned by shared walls** (two consecutive shared corners), cores in the de-emphasis colour,
   whole floors alternating, as before.
6. **The selected zone keeps its colour** and is marked by 3 px edges in the selection colour and the 3D selection
   outline of its building, as the decision says; the legend reads "Selected floor or zone, outlined".
7. **Boundary lines take the surface colour** of each appearance (white in the light appearances, black in Dark),
   envelope edges its primary ink.
8. **Picking in 3D ignores MapLibre's extrusion hits** and casts the ray against every drawn prism (464 buildings and
   at most 20 zoned ones; well under a millisecond), since MapLibre both misorders and omits them.
9. **The camera is saved but is not an unsaved change**, and moving the map does not count as a change to the applied
   layout: panning should not prompt a save or a layout update. Updating or saving a layout keeps the camera.
10. **`map.setCamera` is an agent tool** (a view operation like the others); `map.syncCamera` is internal.

### Known issues

- MapLibre's own `queryRenderedFeatures` order for extrusions is still used flat (2D), where it is correct.
- The ray picking uses MapLibre's public camera getters; if a later MapLibre changes how it places the camera (its
  distance of half the canvas height over the tangent of half the field of view), picking would drift; the unit
  tests pin the formula and the screenshot review checked it against MapLibre's internal camera.
- Edges lying on a face seen nearly edge-on can lose half their width where the face slopes towards the camera.
- On steep terrain, edges and picks are lifted by the terrain at one point per building.
- A camera applied before the map has loaded (the Map tab never opened) moves the map once it loads.

### Verification (decision 0036)

On `claude/0036-map-zones` after merging `claude/next-stages` at `d9bf958` (the views and dialogs work):

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
- `npm test`: 585 passed in 56 files (578 in 54 before the merge). New or rewritten: `src/domain/zoning/zoning.test.ts`
  (the fixture geometry tiling every floor exactly, zones from geometry, colour slots by shared walls, one zone without
  geometry, geometry that misses a floor, the 510-zone fixture total, no zoning command, saves with the removed fields),
  `src/app/pages/zoneFeatures.test.ts` (storeys spanning their floors, neighbours keeping colours, edges drawn once by
  role and style, the camera pull, stacks saved with `floorSlabs`), `src/app/pages/mapPicking.test.ts` (ray and prism,
  the front building first, the top storey first, the camera position, and a click on a selected floor selecting the
  zone under the pointer), `src/app/view/mapCamera.test.ts` (sync, set, project open, a layout restoring the camera),
  the appearance test for the `zoneEdges` tokens, and the agent sessions.
- Dev e2e on port 5181 (`npx playwright test -c tmp/playwright.5181.config.ts`, 4 workers): 142 of 143 passed; the
  failure was `viewer.spec.ts` "removes a view from the start page after confirming" (`toBeFocused`), which passed when
  `viewer.spec.ts` was rerun once on its own (7 passed). New: `e2e/map-zones.spec.ts` (6 tests, replacing
  `per-building-zoning.spec.ts`), rewritten `e2e/floors-zones.spec.ts` (3).
- `npm run test:e2e:preview`: 4 passed.
- Review screenshots at 1440x900 in the light appearance: B0439's zones in 3D, floor 2 among hollow floors, the floor
  2 corridor selected among neighbours keeping their colours, the boundary lines close up, and B0452 picked in front of
  B0439 at a low angle (where MapLibre's own hits listed only B0439's core cells).
