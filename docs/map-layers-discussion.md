# Map layers: discussion

Date: 2026-10-27. Status: decided the same day. The owner chose direction B with the project's own layers from A,
kept 3D and the like as basemap settings, put "Color by" only in Properties, saved layer settings with the project,
and made extrusion a building layer setting ([decision 0031](decisions/0031-map-layer-stack.md)).

The owner asked how the map should manage layers, and how "Color buildings by", the grid overlay, and the 3D building
settings fit into that.

## Observed: RC EnergyAtlasWeb

RCEnergySimulator at `7464c140` (branch `feature/archetype-library-schedule-registry`), read only. Paths are under
`EnergyAtlasWeb/wwwroot/`. All of these pages use Mapbox GL JS, and each manages its own layers; there is no shared
layer module.

- **GeoData preview** (`js/geoDataPreview.js`) is the only page with a layer list (`#layersList`,
  `geoDataPreview.html:45`; rows built by `createLayerItem`, 2381-2458):
  - each row has show/hide, edit style, attributes, zoom to, move up/down, and delete;
  - reordering swaps the array and re-adds every layer (2151-2240);
  - styling offers a fill type (solid, categorical, or continuous), a colour ramp with linear or log scale, min/max
    with Auto Range, opacity, stroke, and 3D height (2645-2770);
  - height comes from none, a fixed value, or an attribute, in metres, feet, or storeys (1914-1968);
  - the layer list is saved in `localStorage` as `geoDataPreview_state`, as `{entryName, featureType, visible,
    styling}` for each layer (996-1019);
  - there is no map legend, only a category swatch list inside the style panel (3940-3973).
- **Result viewer** (`js/resultViewer.js`) has no layer list:
  - tabs choose Footprints, Tract, Block Group, or Block (`resultViewer.html:110-115`);
  - a settings dialog colours the one building layer by any property, with ramp, range, bins, and colours below and
    above the range (564-571, 1935-1987);
  - a gradient legend with six ticks follows that choice (1999-2035), and the choice is saved as `resultViewer_state`
    (206-259).
- **CAP result viewer** (`js/capResultViewer.js`) has a metric dropdown and geography-level tabs, with a fixed ramp and
  a min/max legend (116-134, 516-540, 744-752).
- **Building downloader** (`js/buildingDownloader.js`):
  - 12 Overture layers, each with an eye button that adds or removes the layer (1150-1259);
  - a 3D button that adds terrain and extrudes buildings by `height` (287-395).
- No grid or network layer (feeders, transformers, substations) was found in these pages.

## Interpretation

- RC's habit is one map per task, with the thing a person colours by chosen up front: a metric dropdown or settings
  dialog, and a legend that follows it. A full layer manager appears only where people bring their own GeoJSON.
- In this experiment the map is already one shared surface with a fixed set of things to show:
  - **buildings**, as a flat fill or 3D extrusion, coloured by Floors, PV yield, Baseline demand, or Scenario
    reduction;
  - **grid elements**, as feeder lines and transformer, substation, and utility PV points;
  - **terrain** with hillshade;
  - the **basemap**.

  Later slices add result layers, such as grid loading and calibration error.

## Directions

**A. A fixed list of the project's layers (recommended).**
- Properties lists Buildings and Grid, and later each result layer, in a fixed drawing order: points over lines over
  polygons.
- Each row has a show/hide switch and a legend swatch; choosing a row opens that layer's settings below it.
- **Buildings** settings: colour by (today's metrics, later any numeric or category attribute), colour range, and
  opacity. Settings for the 3D extrusion are covered under "Where 3D settings go" below.
- **Grid** settings: lines and points shown separately, and later colour by element type or loading.
- The legend card on the map shows one block for each visible layer.
- View operations: `map.setLayerVisible`, `map.setLayerStyle`. Selection picks from visible layers only.
- *Cost:* moderate. This replaces the Map header's radio group and checkbox, and fits agents through the same view
  operations.

**B. A layer stack, as in RC's GeoData preview.**
- People can add the same source more than once, for example buildings coloured by demand plus buildings outlined by
  archetype.
- Layers can be reordered and removed, each with a full style editor.
- *Cost:* high. It needs add, remove, and reorder operations, rules for stacked building fills hiding each other, and
  per-layer selection rules. It suits user-imported data more than a workflow app.

**C. Map themes.**
- A single choice, such as Baseline demand, PV potential, Grid loading, or Calibration error, sets which layers show
  and how they are coloured.
- A few switches remain (grid on or off, 3D).
- *Cost:* low. It is quick for people and agents, but gives the least control, and every new result needs a theme.

A and C combine well: a theme could be a saved set of layer settings in A. That can wait until the result layers
exist.

## Where 3D settings go

There are two different things:

- **The 3D view** is scene-level: tilt and rotation, terrain, and sky and lighting. It stays under Basemap, as now.
- **Building extrusion** is a Buildings layer setting:
  - height source, either floors × 3.2 m (synthetic) or none;
  - exaggeration, and opacity.

Under A, turning on the 3D view would extrude buildings by default, and the Buildings layer could turn extrusion off
or change how heights are drawn.

## Questions for the owner

1. Direction A, B, or C, or A now with themes later?
2. Should the Map keep a quick "Color by" control on its own bar, or should that live only in Properties?
3. Should layer settings be saved with the project, as table settings are
   ([decision 0029](decisions/0029-table-settings-with-project-and-stage-properties.md))? The recommendation is yes:
   the map view saved with the project.
4. Should 3D extrusion be part of the Buildings layer, as above, or stay a single scene switch?
