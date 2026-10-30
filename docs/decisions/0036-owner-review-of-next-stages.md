# 0036: The owner's review of the next stages: backend zones, slimmer layouts, dialog confirmations, Save as views

Date: 2026-10-29

Status: accepted by the owner (2026-10-29, reviewing the [review guide](../20261029_branch-review.md) items M1 to V3
and the eight open questions). The owner's review was a transcribed voice memo; where a point was unclear, the owner
answered a follow-up question the same day, and those answers are marked "(answered)". Points marked "(interpreted)"
are the implementer's reading and are open to the owner's review.

## Context

Before the owner's review, the branch `claude/next-stages` carried the six next stages
([decision 0032](0032-next-stages-directions.md)), decisions [0033](0033-project-layouts-panel-and-scenarios-page.md),
[0034](0034-per-building-zoning-and-3d-zones.md), and [0035](0035-hollow-floors-and-nested-selection.md), and the
fixes from four agent reviews ([branch review](../20261029_branch-review.md)). The review guide grouped them into
items M1–M8 (map, floors, and zones), L1–L2 (layouts), A1–A2 (archetypes), S1–S2 (scenarios), C1 (calibration),
D1–D2 (schema matching and Data intake), and V1–V3 (hand over and the viewer).

## Decision

### Map, floors, and zones

- **M1, nested selection: kept.** Retire **Show zones in 3D** (the Properties button and its palette action) for now;
  it may come back for another purpose.
- **M2, hollow floors: kept, with two changes.** A selected zone no longer greys out the floor's other zones; they
  keep their colours, and the selected zone is marked by the selection outline. Fix the bug where a click on a floor's
  zones always selects the same (first) zone, wherever the click lands.
- **M3: a click in 3D selects the building in front.** Overlapping extrusions must not hand the click to a building
  behind the one under the pointer.
- **M4 and M6: zoning is done by the backend.** The browser does not compute zones: no perimeter-and-core generation,
  no drawn-zone validation or fallbacks, no zoning setting. Zones arrive as geometry (in the demo, precomputed in the
  fixture for a few example buildings) and the map and Properties only display them. Zone volumes tile their floor
  exactly and line up with the building's extrusion: neighbouring zones share their walls with no gaps, a boundary
  between zones is a line in a colour distinct from the envelope edges, and edges hidden behind a volume are fully
  hidden (no short tails showing through). The perimeter depth is not an input: the backend will choose it.
- **M5: the per-building zoning control goes too (answered).** Zones are read-only everywhere; a building without
  zone geometry from the backend is one zone, as in RC.
- **M7: no floor slabs.** EnergyPlus models do not draw floors as slabs, so the floor slab layer setting and its
  drawing are removed. Zone-to-zone boundary lines are still drawn.
- **M8: per-zone results are not shown for now.** They matter, but the synthetic split by floor area is removed from
  the Results page.

### Layouts

- **L1: a layout also stores the map camera**: centre, zoom, pitch, and bearing.
- **The Layouts table keeps only Name, its actions, and Default (open question 3, answered by this).** State, Saved by,
  Created, and Updated leave the table; they stay available elsewhere (interpreted: in the layout's Properties).
- **Confirmations are dialogs, everywhere in the app (answered).** No confirmation may appear inline and push the
  layout around. Every confirmation (deleting a layout, removing a view from the browser, deleting rules and
  definitions, and the rest) is a modal dialog; **Enter** presses the confirming button and **Esc** cancels.
- L2 (Save layout from the View menu) was not commented on and stays as built.

### Deferred until the backend connection

- **Archetypes (A1, A2), Calibration (C1), and Schema matching and Data intake (D1, D2)** are deferred: they will be
  designed when the app is connected to the RC Energy Simulator or the EnergyAtlas backend.
- **Scenarios (S1, S2)** are deferred the same way (answered); they stay as built, unreviewed.

### Views and the viewer

- **File > Save as…** replaces File > Hand over…. It offers a **project** (a fully editable and runnable copy, saved
  as a new project in this browser and downloadable as a file) or a **view** (a view-only copy, kept in this
  browser's list of views and downloadable as a file) (answered). Parametric and batch generation of several views per
  project are deferred; for now a view is a view-only copy of the project.
- **A viewer start page** matches the project start screen in layout, with viewer wording, and opens only views.
- **The viewer follows the editor's layout strictly, with everything blocked.** The top bar has no project title and
  carries all five menus (File, Edit, View, Run, Help); the toolbar and status bar keep the editor's items, disabled
  in look and in function where they cannot act, rather than removed. The **View only** tag stays, moved into the
  status bar next to the project name. The account button is shown, as in the editor. (Interpreted: this applies to
  the shell; the viewer keeps its pages Map, Table, Dashboard, and Results.)
- **Messages, not banners.** A notice such as "results are outdated relative to the model" is a normal message
  (toast and Messages panel), never a banner that shifts the layout.
- **The viewer's agent has the editor's controls**, send and permission modes included. Since the viewer cannot
  change the model or run anything, every mode allows everything by default.
- **Copy or reference** is deferred: a view is an isolated copy of a local project. Views that reference a model on a
  server the user hosts are a later discussion.

### The open questions of the branch review

1. Refusing a fit on a wrong unit, and confirming an Adopt that misses thresholds: **withdrawn**; the backend decides.
2. The comparison after Adopt: **deferred**.
3. Wide tables in side panels: **answered** for Layouts above.
4. Mixed use for the fallback rule: **deferred**.
5. Outdating on an unchanged regenerate: **deferred**.
6. Nested selection with several buildings: **deferred**.
7. The viewer's view changes, unreadable packages, and resets: **superseded** by the viewer decisions above.
8. Losing Shift-drag box zoom: **accepted**; it was redundant.

## Consequences

- `state.zoning.overrides`, `zoning.setBuilding`, the project zoning setting, the perimeter depth, the fallback codes,
  and `src/domain/zoning/` geometry generation are removed; saves that carry them still open and ignore them.
  Fixture zone geometry stands in for the backend's.
- Decision 0034's per-building zoning and drawn-zone validation, and decision 0035's muting of a floor's other zones,
  are superseded. Decision 0035's nested selection and hollow floors stay.
- "Handover package" becomes "view" in the interface; packages saved before this decision still open.
- A shared confirmation dialog component replaces every inline confirmation and joins the gallery.
- Three defects found while preparing the review guide are fixed with this work: the map's hover label going stale
  after Page Up or Page Down, the red failure toast for an asset without a page (a notice, not a failure), and the
  doubled word in "baseline run run-40".
