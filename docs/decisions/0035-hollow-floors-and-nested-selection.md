# 0035: Hollow floors and nested selection instead of exploded floors

Date: 2026-10-29

Status: accepted by the owner (2026-10-29, reviewing F5 of [decision 0034](0034-per-building-zoning-and-3d-zones.md));
the choices marked "for review" were made by the implementer and are open to the owner's review. Being built on
`claude/next-stages`; not merged, not pushed ([status](../per-building-zoning.md)).

## Context

Decision 0034 showed the zones of a selected building in 3D and offered "Explode floors", which lifts each storey
apart. The owner, reviewing it, asked whether there is an approach that changes the geometry less:

> maybe we can hollow some floors out and highlight certain floors that are selected. So maybe we have to enable like
> hierarchical selecting condition, where maybe we select the building and then only at this time we will be able to
> select the sub-components of that building, like floors, and then within each floor we can select the zones. And
> still we display zone level fidelity when we have the building selected, which is good.

## Decision

- **Geometry stays in place.** Exploded floors are removed: the `explodeFloors` building layer setting, its
  checkboxes, its palette action, and the agent's use of it. Storeys keep their real heights. (Built only on this
  unmerged branch, so no saved project outside it carries the setting; a save from this branch that does still opens,
  and the setting is ignored.)
- **A selected building shows zone-level fidelity**, as in decision 0034: its zone cells coloured, with zone edges.
- **Nested selection on the map.** A click on an unselected building selects the building. Only once a building is
  selected can a click on it select one of its floors, and only once a floor is selected can a click on that floor
  select one of its zones. A click on another building selects that building. Shift adds at the same level within
  the same building (floors of the selected building, zones of the selected floor). Escape on the map goes up one
  level: zone to its floor, floor to its building, building to nothing. The Table, Assets tree, Properties, and agent
  can still select a floor or zone directly; the map then shows it in its building as below.
- **Hollow floors.** When a floor or zone is selected in 3D, the selected floor is drawn solid with its zones and
  emphasised edges, and the building's other floors are drawn hollow, a faint translucent shell with thin edges, so
  the selected floor reads through them, instead of floors above being cut away. Hollow floors stay clickable, so
  another floor can be chosen directly. When a zone is selected, it is highlighted and the floor's other zones are
  muted.
- **2D** keeps one floor's plan: a click on a selected building's plan selects the floor shown, then a click selects
  a zone on it.
- **Keyboard (for review).** Besides Escape, with a floor or zone selected on the focused map, keys move to the floor
  above or below, and Properties lists a building's floors and a floor's zones for selection, so every level can be
  reached without a pointer.

## Consequences

- The 0034 review questions about the explode gap and where the explode setting lives fall away.
- The selection outline no longer has to enclose exploded gaps.
- Picking depends on MapLibre's 3D hit test of translucent extrusions; zone edges must stay visible through hollow
  shells.
