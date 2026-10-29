# Floors and zones in 3D on the map: discussion

Date: 2026-10-28. Answered by the owner on 2026-10-28: A, R1, S2, and V1, accepted as
[decision 0034](decisions/0034-per-building-zoning-and-3d-zones.md), built on `claude/next-stages`
([status](per-building-zoning.md)).

## The owner's request (2026-10-28, review of stage 6 of decision 0032)

> floors and zones. floor / zone should have on-the-map 3d display. let's discuss how to enable that. need to have
> at least 1 case of real zoning 1 case of each floor as a zone and 1 case of perimeter core zoning displayed.

## Observed facts

This repository, `claude/next-stages` at `9453f22` plus uncommitted work:

- **Zones are already drawn in 3D, but only for chosen buildings.** `src/app/pages/ZoneLayers.tsx:59-112` adds a
  `fill-extrusion` layer (`zones:extrusion`) with per-feature `base` and `top`, at opacity 0.95. It is drawn only when
  the 3D view is on and a building layer extrudes (`src/app/pages/MapPage.tsx:222-250`). In 2D the same zones are a
  fill and outlines for one storey.
- **Only selected buildings get zones**, at most 20: the selected buildings, or the owners of selected floors or zones
  (`src/app/pages/zoneFeatures.ts:17, 131-132`). Every other building is a stack of floor slabs (`floorSlabs`, on by
  default, `src/app/pages/mapLayers.ts:28`) or one extrusion. In the review screenshot 07d no building was selected, so
  only slabs showed.
- **Storeys above a selected floor or zone are cut away** (`zoneFeatures.ts:140-175`).
- **One zoning mode per project.** `state.zoning.published` (`src/domain/zoning/zoning.ts:59-65, 461-469`) is one of
  one zone per building, one zone per floor, or perimeter and core per floor. Perimeter and core fall back to one
  zone per floor for a building whose footprint cannot be split (`zoning.ts:367-369`); 79 of 464 fixture buildings
  are split at 4.5 m depth. So today a project can show "perimeter and core" and "each floor a zone" side by side
  (through the fallback), but never three modes, and never a zone layout that was not generated.
- **Every floor of a building has the same plan.** Floors are uniform (height ÷ storeys); perimeter and core copy one
  plan to every storey (`zoning.ts:326-451`).
- **No real zone geometry exists in the repository.** The footprints (`src/domain/fixtures/back-bay-buildings.geo.json`)
  are OpenStreetMap outlines with no interior information; there are no IDF, gbXML, or IFC files.
- **Rendering limits.** MapLibre draws no outlines on extrusions, so in 3D zones are told apart only by colour and the
  gaps between slabs (`docs/floors-zones.md`); lines cannot be raised above the ground (decision 0013), which is why
  the 3D selection outline is a custom WebGL layer (`src/app/pages/SelectionSilhouette.tsx`).
- **Packages.** deck.gl was rejected as a second rendering stack (`docs/package-selection.md:77`); three.js is not in
  any decision. The stage 6 decision said "no geometry package" (`docs/floors-zones.md`).

RC (`../RCEnergySimulator` at `7464c140`, read only):

- RC has the same three modes (`EnergyAtlasLib/Factory/Zoning.cs:5-39`: `Single`, `Floors`, `PerimeterCore`).
- `BuildingZoner.Partition` (`EnergyAtlasLib/Factory/BuildingZoner.cs:19-92`) cuts each floor from the building
  solid's cross-section at that level, so floors follow setbacks and roofs; perimeter and core use a buffer and a
  Voronoi split, including courtyards.
- Real building solids enter only through Grasshopper (`EnergyAtlasGrasshopper/BuildingModel/BuildingFromSolid_Component.cs`),
  from a Rhino Brep; the web path zones a rectangle with the building's area and perimeter
  (`EnergyAtlasLib/UBEM/UbemSimple.cs:1511`). There is no IDF, gbXML, or IFC zone import.
- RC's web pages extrude whole buildings only (`EnergyAtlasWeb/wwwroot/js/geoDataPreview.js:1961-1966`); none shows
  floors or zones in 3D.

## What has to be decided

### Q1. How three zoning cases appear at once

- **A. Per-building zoning (recommended).** The project keeps a default mode, and a building can override it in
  Properties (project default, one zone, each floor a zone, perimeter and core, or drawn zones). Geospatial
  preprocessing applies each building's own mode, and results follow it. This is a real model feature; RC zones each
  building with its own call, so per-building modes fit its zoner. The complete fixture would set three neighbouring
  buildings to the three cases.
- **B. A display-only showcase.** Three buildings are drawn with fixed zoning on the map, whatever the project's
  mode, labelled as examples. Cheap, but the map would show zones the model does not use.

### Q2. What "real zoning" means here

- **R1. Drawn zones (recommended).** One building carries zone outlines per floor that are not generated: offices,
  a corridor, a core, with a setback upper floor, as a floor plan or an imported model would give. In this
  prototype they are hand-authored, stored with the project, and labelled synthetic. Import from IDF, gbXML, or IFC
  stays deferred, as RC has none.
- **R2. Floors cut from a 3D shape.** A building with setbacks whose floors differ in plan, as RC's
  `BuildingFromSolid` gives, zoned by the generated modes. Closer to RC, but it shows real floors rather than real
  zones.
- **R3. Both**, R1 on the setback building.

### Q3. Which buildings show zones in 3D

- **S1. A Zones layer in the layer stack (recommended).** Zones become a layer of the map's stack (decision 0031)
  that can be added, hidden, and styled (colour by zone kind or by a per-zone result). It draws every building in
  view up to a cap (for example 200 buildings, about 1,700 zone cells in perimeter and core), and the selected
  buildings beyond that. Saved with the project and in layouts like other layers.
- **S2. Selected buildings only**, as now, with a clearer way in: a "Show zones in 3D" button in a building's
  Properties that selects it, turns the 3D view on, and frames it.

### Q4. How zones read in 3D

- **V1. Stay on MapLibre extrusions (recommended)**, adding an "Explode floors" setting on the Zones layer that opens
  a gap between storeys, and zone edges drawn by a custom WebGL layer like the selection silhouette, so adjacent zones
  read apart without relying on colour alone. No new package.
- **V2. A three.js custom layer** for true wireframes, transparency, and exploded views. Needs a new package decision
  and a second scene model.

## Recommendation

A, R1 on a setback building (R3 if the owner wants RC's cross-section behaviour shown too), S1, and V1. That
gives a real, saved per-building mode, one building of each case in the complete fixture, zones visible without
selecting first, and no new package.

## Questions for the owner

1. Q1: per-building zoning (A) or a display-only showcase (B)?
2. Q2: what should the "real zoning" case be: drawn zones (R1), floors from a 3D shape (R2), or both (R3)?
3. Q3: a Zones layer in the layer stack (S1), or zones for selected buildings only (S2)?
4. Q4: stay on MapLibre with exploded floors and drawn edges (V1), or allow a three.js layer (V2)?
