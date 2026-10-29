# 0034: Per-building zoning, drawn zones, and 3D zones for selected buildings

Date: 2026-10-29

Status: accepted by the owner (2026-10-28, answering the [floors and zones in 3D discussion](../floors-zones-3d-discussion.md));
not built yet.

## Context

The owner asked for floors and zones displayed in 3D on the map, with at least one case each of real zoning, each
floor as a zone, and perimeter and core. Today zoning is one mode per project, every floor shares one plan, only
selected buildings get zones, and zones in 3D are told apart only by colour and slab gaps. The facts and the
alternatives are in the discussion.

## Decision

- **Per-building zoning (Q1, A).** The project keeps a default zoning mode, and a building can override it in its
  Properties: project default, one zone, each floor a zone, perimeter and core, or drawn zones. Geospatial
  preprocessing applies each building's own mode, and per-zone results follow it. The complete fixture sets three
  neighbouring buildings to the three cases.
- **Drawn zones are the "real zoning" case (Q2, R1).** One fixture building carries hand-authored zone outlines per
  floor (for example offices, a corridor, and a core), stored with the project and labelled synthetic. Import from
  IDF, gbXML, or IFC stays deferred; RC has no such import either.
- **Zones show in 3D for selected buildings only (Q3, S2)**, as now, with a clearer way in: a "Show zones in 3D"
  action in a building's Properties that selects it, turns the 3D view on, and frames it.
- **MapLibre extrusions with exploded floors and drawn edges (Q4, V1).** An "Explode floors" setting opens a gap
  between storeys, and zone edges are drawn by a custom WebGL layer like the selection silhouette, so adjacent zones
  read apart without relying on colour alone. No new package.

## Consequences

- Zoning state gains per-building overrides and drawn zone geometry; saved projects need a compatible schema and
  migration (`src/server/projectSchema.ts`), and handover packages carry them.
- Changing a building's zoning makes Geospatial preprocessing outdated, as the project setting does today.
