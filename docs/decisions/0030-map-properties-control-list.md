# 0030: The map's controls live in its Properties, and the Map has no selection bar

Date: 2026-10-27

Status: accepted by the owner (2026-10-27); implemented on `claude/ui-component-system`, not merged into `master`.

## Context

The Map page had a footer bar with the selection ("1 building selected: B0001"), Clear selection, Inspect, and Open
Table. Its header also carried the 3D buildings and Terrain switches and the terrain exaggeration slider, while scene
lighting sat in the map's own Properties ([decision 0018](0018-map-scene-lighting.md)). Since
[decision 0028](0028-properties-panel-and-definition-tables.md) every selection is shown and cleared in Properties.

On 2026-10-27 the owner asked to:

- remove the selection text, Clear selection, Inspect, and Open Table from the Map;
- clear a selection with the × in Properties, or by clicking an empty part of the map, which selects the map itself;
- move the terrain option into the map's Properties; and
- make that panel one list of controls: layers (not enabled yet), then the basemap, with the 3D buildings switch, the
  terrain switch, the sun position switch, the horizon haze slider, and the sun intensity and diffusion sliders under
  it.

How the map manages layers, including "Color buildings by", the grid overlay, and 3D building settings, was discussed
in [map layers](../map-layers-discussion.md) and settled by [decision 0031](0031-map-layer-stack.md), which replaces
the Planned Layers section, renames "3D buildings" to "3D view", and folds haze, intensity, and diffusion into one
disclosure.

## Decision

- **No selection bar on the Map.** The footer keeps only the basemap and terrain status, their Retry buttons, and the
  note that the canvas is not available to screen readers.
- **Clicking the map shows Properties.** Clicking a building or grid element selects it and opens Properties.
  Clicking an empty spot clears the selection and opens Properties, which then shows the map's own properties.
- **Map properties, in order:**
  1. **Layers**: marked Planned (`map.layers` capability). It explains that buildings are coloured and the grid shown
     from the Map's own bar until the layer list is designed.
  2. **Basemap**, with these controls:
     - the OpenFreeMap basemap switch, the same setting as in Settings;
     - 3D buildings, with the missing-heights note;
     - Terrain, offered only in 3D, with its exaggeration slider and the paused note;
     - **Sun position**, a disclosure holding the season and time of day;
     - horizon haze, sun intensity, and sun diffusion;
     - the scene summary with its Simulated badge.
- "Color buildings by" and the grid overlay stay in the Map's header until the layer list is decided.

## Consequences

- With the map unselected, its display settings are found in one place: Properties.
- The "sun position toggle" is read as a disclosure that shows or hides the season and time sliders. Turning
  sun-driven lighting on and off would be a new view state, and the owner has not asked for it.
- Opening Properties on every map click can cover the map in a narrow window, where side panels are overlays. The
  Roadmap does the same since [decision 0029](0029-table-settings-with-project-and-stage-properties.md).
