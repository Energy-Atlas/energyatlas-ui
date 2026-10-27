# 0031: A map layer stack with the project's own layers, saved with the project

Date: 2026-10-27

Status: accepted by the owner (2026-10-27, answering the [map layers discussion](../map-layers-discussion.md));
implemented on `claude/ui-component-system`, not merged into `master`.

## Context

[Decision 0030](0030-map-properties-control-list.md) left the Layers section of the map's Properties marked
Planned while the owner chose how layers work. The owner answered:

- **Direction B**, a layer stack like RC's GeoData preview, **with support for special objects and layers as in
  A**, the project's own buildings and grid;
- **3D and the like are basemap settings**;
- **"Color by" only in Properties**, not on the Map's bar;
- **layer settings are saved with the project**; and
- **extrusion is a setting of the building layer**.

The same message asked to fold horizon haze, sun intensity, and sun diffusion into one disclosure like Sun position.

## Decision

- **A stack of layers.**
  - The map's Properties lists its layers top first, which is also the drawing order.
  - Each row has a show/hide checkbox.
  - Rows are reordered by dragging, by keyboard drag-and-drop, or with Move up and Move down.
  - An Add layer menu adds a layer above the rest. Layers can be renamed and removed.
  - The chosen layer's settings appear below the list.
  - Several layers can draw the same source, for example two building layers coloured by different metrics.
- **Layer kinds are the project's own objects.** Each kind draws a project source, and its features are selectable
  objects that share the selection:
  - **Buildings**: colour by a metric (Floors, PV yield, Baseline demand, Scenario reduction) or a single colour;
    opacity; and **extrude to height** (floors × 3.2 m, synthetic). Extrusion shows in the 3D view.
  - **Grid lines** (feeders) and **Grid points** (transformers, the substation, utility PV): opacity.

  User-imported layers would be new kinds, added when intake produces map data.
- **Default stack** for a project that saved none: Grid points, Grid lines, Buildings (coloured by floors,
  extruded).
- **The 3D view is a basemap setting.** The Basemap section's switch is now "3D view": tilt and rotation, terrain,
  and lighting. Building layers decide whether they are extruded in it.
- **"Color buildings by" and the grid overlay leave the Map's bar.** The Map's header keeps its title and capability
  badge; the legend shows one block per visible layer, top first.
- **Saved with the project.** The stack is sent with Save next to the table settings
  ([decision 0029](0029-table-settings-with-project-and-stage-properties.md)) and restored when the project opens. A
  changed stack counts as an unsaved change; a malformed saved stack falls back to the defaults.
- **One path for people and agents.** These view operations replace `map.setGridOverlay`:
  - `map.addLayer`, `map.removeLayer`, `map.moveLayer`;
  - `map.setLayerVisible`, `map.setLayerStyle`.

  `map.setMetric` stays as the agent's shortcut: it colours the top building layer.
- **Light and haze** is a disclosure holding horizon haze, sun intensity, and sun diffusion, after Sun position.

## Consequences

- No new package. React Aria's `GridList` with `useDragAndDrop` gives rows that hold a checkbox and can be reordered
  by pointer and keyboard. It is wrapped as the shared `ReorderableList` component and shown in the gallery.
- A stacked building layer can hide another; that is the person's choice, as in a GIS layer list.
- Clicking the map picks from the visible layers, top first.
