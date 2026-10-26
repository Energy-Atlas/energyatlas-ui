import { GROUP, upsertAsset } from './assets.ts'
import { addedBuildings, applySourceRecords } from './intake/fusion.ts'
import backBayBuildings from './fixtures/back-bay-buildings.geo.json'
import type {
  Archetype,
  Building,
  BuildingUse,
  EditableBuildingField,
  GridElement,
  HeldPreprocessingOutput,
  LngLat,
  Provenance,
  ResultSet,
  Scenario,
  WorkbenchState,
} from './types.ts'
import { STAGE_IDS } from './workflow.ts'

// Deterministic stand-ins for the engineering stages of decision 0005.
// Nothing here is a physical calculation: values are synthetic, seeded by
// building index, so the workflow, stale propagation, warnings, and failures
// can be exercised honestly. Footprint geometry comes from a bundled
// OpenStreetMap extract of Boston Back Bay (decision 0012); every attribute and
// result is synthetic and does not describe the real buildings.

export type StageRunContext = {
  runId: string
  operationId: string
  /** 1 for the first run of the stage, counting cancelled runs. */
  attempt: number
}

export type StageRunResult =
  | { ok: true; summary: string; warnings: string[] }
  | { ok: false; message: string }

const SPACING_DEGREES = 0.0003
const METERS_PER_DEGREE = 111_320
const HOURS_PER_YEAR = 8760
const PEAK_FACTOR = 1.9

function meanOf(points: LngLat[]): LngLat {
  let lng = 0
  let lat = 0
  for (const [x, y] of points) {
    lng += x
    lat += y
  }
  const count = Math.max(1, points.length)
  return [lng / count, lat / count]
}

/** Vertex mean of a closed ring, ignoring the repeated closing vertex. */
function centroidOf(ring: LngLat[]): LngLat {
  return meanOf(ring.length > 1 ? ring.slice(0, -1) : ring)
}

/** Planar polygon area in square meters; accurate enough at district scale. */
export function ringAreaM2(ring: LngLat[]): number {
  const [originLng, originLat] = ring[0] ?? [0, 0]
  const metersPerLng = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180)
  let sum = 0
  for (let index = 1; index < ring.length; index++) {
    const [x1, y1] = ring[index - 1] ?? [originLng, originLat]
    const [x2, y2] = ring[index] ?? [originLng, originLat]
    sum +=
      (x1 - originLng) * (y2 - originLat) - (x2 - originLng) * (y1 - originLat)
  }
  return (Math.abs(sum) / 2) * metersPerLng * METERS_PER_DEGREE
}

type DistrictFootprint = { ring: LngLat[]; sourceRef: string; areaM2: number }

// Real footprint geometry from the bundled OpenStreetMap extract, in file
// order, which follows the street layout north to south.
const DISTRICT_FOOTPRINTS: DistrictFootprint[] = backBayBuildings.features.map(
  (feature) => {
    const ring = (feature.geometry.coordinates[0] ?? []).map(
      ([lng, lat]): LngLat => [lng ?? 0, lat ?? 0],
    )
    return {
      ring,
      sourceRef: `OpenStreetMap ${feature.properties.osm}`,
      areaM2: ringAreaM2(ring),
    }
  },
)

/** Source references of the bundled footprints, in building order (B0001 first). */
export const DISTRICT_SOURCE_REFS: readonly string[] = DISTRICT_FOOTPRINTS.map(
  (footprint) => footprint.sourceRef,
)

export const DISTRICT_BOUNDS = DISTRICT_FOOTPRINTS.flatMap(
  (footprint) => footprint.ring,
).reduce(
  (bounds, [lng, lat]) => ({
    west: Math.min(bounds.west, lng),
    east: Math.max(bounds.east, lng),
    south: Math.min(bounds.south, lat),
    north: Math.max(bounds.north, lat),
  }),
  { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
)

export const DISTRICT_CENTER: LngLat = [
  (DISTRICT_BOUNDS.west + DISTRICT_BOUNDS.east) / 2,
  (DISTRICT_BOUNDS.south + DISTRICT_BOUNDS.north) / 2,
]

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTHLY_WEIGHTS = MONTH_DAYS.map(
  (days, month) =>
    days * (1 + 0.06 * Math.cos(((month - 3) / 12) * 2 * Math.PI)),
)
const MONTHLY_WEIGHT_TOTAL = MONTHLY_WEIGHTS.reduce(
  (sum, weight) => sum + weight,
  0,
)

const TRANSFORMER_RATINGS_KVA = [12_000, 12_000, 9_000, 6_000]

const ARCHETYPES: Archetype[] = [
  {
    id: 'archetype:residential-pre-1980',
    name: 'Residential, built before 1980',
    use: 'residential',
    euiKwhPerM2: 165,
  },
  {
    id: 'archetype:residential-1980-on',
    name: 'Residential, built 1980 or later',
    use: 'residential',
    euiKwhPerM2: 115,
  },
  {
    id: 'archetype:office',
    name: 'Office',
    use: 'office',
    euiKwhPerM2: 210,
  },
  {
    id: 'archetype:retail',
    name: 'Retail',
    use: 'retail',
    euiKwhPerM2: 240,
  },
  {
    id: 'archetype:school',
    name: 'School',
    use: 'school',
    euiKwhPerM2: 140,
  },
]

export function unitRandom(index: number, salt: number): number {
  let t = (index * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function megawattHours(kwh: number): string {
  return `${round(kwh / 1000).toLocaleString('en-US')} MWh`
}

function fromStage(stageId: string, context: StageRunContext): Provenance {
  return {
    kind: 'stage',
    stageId,
    runId: context.runId,
    operationId: context.operationId,
  }
}

function forEachBuilding(
  state: WorkbenchState,
  visit: (building: Building, index: number) => void,
): void {
  state.buildingIds.forEach((id, index) => {
    const building = state.buildings[id]
    if (building) visit(building, index)
  })
}

/** 0 south-west, 1 south-east, 2 north-west, 3 north-east of the district center. */
function quadrantOf(building: Building): number {
  const [lng, lat] = centroidOf(building.footprint)
  return (lng < DISTRICT_CENTER[0] ? 0 : 1) + (lat < DISTRICT_CENTER[1] ? 0 : 2)
}

function applyOverrides(
  state: WorkbenchState,
  field: EditableBuildingField,
): number {
  let applied = 0
  for (const override of Object.values(state.overrides)) {
    if (override.field !== field) continue
    const building = state.buildings[override.entityId]
    if (!building) continue
    if (field === 'floors' && typeof override.value === 'number') {
      building.floors = override.value
    } else if (
      field === 'archetypeId' &&
      (override.value === null || typeof override.value === 'string')
    ) {
      building.archetypeId = override.value
    } else {
      continue
    }
    applied += 1
  }
  return applied
}

function makeResultSet(
  id: string,
  label: string,
  runId: string,
  byBuildingKwh: Record<string, number>,
): ResultSet {
  const totalKwh = Object.values(byBuildingKwh).reduce(
    (sum, value) => sum + value,
    0,
  )
  return {
    id,
    label,
    runId,
    totalKwh: round(totalKwh),
    peakKw: round((totalKwh / HOURS_PER_YEAR) * PEAK_FACTOR),
    monthlyKwh: MONTHLY_WEIGHTS.map((weight) =>
      round((totalKwh * weight) / MONTHLY_WEIGHT_TOTAL),
    ),
    byBuildingKwh,
  }
}

function matchArchetype(building: Building): string | null {
  switch (building.use) {
    case 'residential':
      return building.yearBuilt !== null && building.yearBuilt < 1980
        ? 'archetype:residential-pre-1980'
        : 'archetype:residential-1980-on'
    case 'office':
      return 'archetype:office'
    case 'retail':
      return 'archetype:retail'
    case 'school':
      return 'archetype:school'
    default:
      return null
  }
}

function captureFootprints(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  const provenance = fromStage(STAGE_IDS.location, context)
  const buildings: Record<string, Building> = {}
  const buildingIds: string[] = []
  DISTRICT_FOOTPRINTS.forEach((source, index) => {
    const id = `B${String(index + 1).padStart(4, '0')}`
    buildings[id] = {
      id,
      name: `Building ${index + 1}`,
      footprint: source.ring.map(([lng, lat]): LngLat => [lng, lat]),
      footprintAreaM2: round(source.areaM2),
      sourceRef: source.sourceRef,
      use: null,
      yearBuilt: null,
      floors: null,
      heightM: null,
      floorAreaM2: null,
      zoneCount: null,
      shadingFactor: null,
      pvYieldKwh: null,
      archetypeId: null,
    }
    buildingIds.push(id)
  })
  // Buildings a fused dataset added come back with the captured footprints.
  for (const building of addedBuildings(state)) {
    if (buildings[building.id]) continue
    buildings[building.id] = building
    buildingIds.push(building.id)
  }
  state.project.location = {
    name: 'Boston Back Bay (OpenStreetMap footprints, synthetic attributes)',
    center: DISTRICT_CENTER,
  }
  state.buildings = buildings
  state.buildingIds = buildingIds
  state.pendingEdits = {}
  state.selection = { entityType: null, ids: [] }

  upsertAsset(state, {
    id: 'asset:project-location',
    kind: 'location',
    name: 'Project location',
    parentId: GROUP.gisDatasets,
    provenance,
    summary: state.project.location.name,
  })
  upsertAsset(state, {
    id: 'asset:footprints',
    kind: 'gisDataset',
    name: 'Building footprints',
    parentId: GROUP.gisDatasets,
    provenance,
    capability: 'workflow.stageRuns',
    summary: `${buildingIds.length} footprints from OpenStreetMap (© OpenStreetMap contributors, ODbL)`,
  })
  return {
    ok: true,
    summary: `Captured ${buildingIds.length} building footprints from the bundled OpenStreetMap extract.`,
    warnings: [],
  }
}

function enrichFootprints(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.length === 0) {
    return {
      ok: false,
      message:
        'No footprints to enrich. Run "Location setup / footprint capturing" first.',
    }
  }
  const uses: BuildingUse[] = [
    'residential',
    'residential',
    'residential',
    'office',
    'retail',
    'school',
  ]
  forEachBuilding(state, (building, index) => {
    const use: BuildingUse =
      unitRandom(index, 3) < 0.05
        ? 'mixed'
        : (uses[Math.floor(unitRandom(index, 4) * uses.length)] ??
          'residential')
    building.use = use
    building.yearBuilt = 1920 + Math.floor(unitRandom(index, 5) * 100)
    building.floors =
      use === 'residential'
        ? 1 + Math.floor(unitRandom(index, 6) * 5)
        : 2 + Math.floor(unitRandom(index, 6) * 10)
  })
  // Precedence: synthetic values, then fused source records, then manual overrides.
  const imported = applySourceRecords(state)
  const kept = applyOverrides(state, 'floors')

  upsertAsset(state, {
    id: 'asset:enriched-footprints',
    kind: 'gisDataset',
    name: 'Enriched footprints',
    parentId: GROUP.gisDatasets,
    provenance: fromStage(STAGE_IDS.enrichment, context),
    capability: 'workflow.stageRuns',
    summary: 'Use, construction year, and floors (synthetic)',
  })
  return {
    ok: true,
    summary: `Enriched ${state.buildingIds.length} buildings with use, construction year, and floors.`,
    warnings: [
      ...(imported > 0
        ? [`${imported} buildings kept attributes from fused datasets.`]
        : []),
      ...(kept > 0 ? [`${kept} manual floor overrides were kept.`] : []),
    ],
  }
}

function matchSchema(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.some((id) => state.buildings[id]?.use === null)) {
    return {
      ok: false,
      message: 'Footprints are not enriched. Run "Geospatial data enriching".',
    }
  }
  upsertAsset(state, {
    id: 'asset:schema-rules',
    kind: 'schemaRules',
    name: 'Attribute mapping rules',
    parentId: GROUP.schemaRules,
    provenance: fromStage(STAGE_IDS.schema, context),
    capability: 'workflow.stageRuns',
    summary: '6 attribute mappings; 1 default applied',
  })
  return {
    ok: true,
    summary: 'Matched 6 attributes to the model schema.',
    warnings: [
      'Attribute "roof_type" has no schema match; flat roofs were assumed for all buildings.',
    ],
  }
}

/** One building's geospatial preprocessing, as a held item output; null when it lacks floors. */
export function preprocessBuilding(
  building: Building,
): HeldPreprocessingOutput | null {
  if (building.floors === null) return null
  const floors = building.floors
  const floorAreaM2 = round(building.footprintAreaM2 * floors)
  return {
    heightM: round(floors * 3.2, 1),
    floorAreaM2,
    zoneCount: Math.max(1, Math.round(floorAreaM2 / 450)),
  }
}

/** Why held preprocessing outputs cannot be published, or null when they can. */
export function validatePreprocessing(
  state: WorkbenchState,
  membership: string[],
  held: Record<string, HeldPreprocessingOutput>,
): string | null {
  for (const id of membership) {
    const output = held[id]
    if (!state.buildings[id]) return `building ${id} no longer exists`
    if (!output) return `building ${id} has no held result`
    if (
      !(output.heightM > 0) ||
      !(output.floorAreaM2 > 0) ||
      !Number.isInteger(output.zoneCount) ||
      output.zoneCount < 1
    ) {
      return `the held result for building ${id} is not valid`
    }
  }
  return null
}

/**
 * Applies a complete group's held outputs to the project at once. Call only
 * after `validatePreprocessing` accepts them.
 */
export function publishPreprocessing(
  state: WorkbenchState,
  membership: string[],
  held: Record<string, HeldPreprocessingOutput>,
  context: StageRunContext,
): StageRunResult {
  let zones = 0
  for (const id of membership) {
    const building = state.buildings[id]
    const output = held[id]
    if (!building || !output) continue
    building.heightM = output.heightM
    building.floorAreaM2 = output.floorAreaM2
    building.zoneCount = output.zoneCount
    zones += output.zoneCount
  }
  const provenance = fromStage(STAGE_IDS.preprocessing, context)
  upsertAsset(state, {
    id: 'asset:buildings',
    kind: 'buildings',
    name: 'Buildings',
    parentId: GROUP.buildings,
    provenance,
    capability: 'workflow.stageRuns',
    summary: `${state.buildingIds.length} buildings with heights and floor areas`,
  })
  upsertAsset(state, {
    id: 'asset:zones',
    kind: 'zones',
    name: 'Thermal zones',
    parentId: 'asset:buildings',
    provenance,
    capability: 'workflow.stageRuns',
    summary: `${zones} zones`,
  })
  return {
    ok: true,
    summary: `Derived heights, floor areas, and ${zones} thermal zones for ${membership.length} buildings.`,
    warnings: [],
  }
}

function estimateShadingAndPv(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.some((id) => state.buildings[id]?.heightM === null)) {
    return {
      ok: false,
      message: 'Building heights are missing. Run "Geospatial preprocessing".',
    }
  }
  let totalPvKwh = 0
  forEachBuilding(state, (building, index) => {
    const exposure = 0.65 + 0.35 * unitRandom(index, 7)
    building.shadingFactor = round(
      Math.min(1, exposure + (building.floors ?? 1) * 0.02),
      2,
    )
    const usableRoofM2 = building.footprintAreaM2 * 0.6
    building.pvYieldKwh = round(
      usableRoofM2 * 0.18 * 1250 * building.shadingFactor,
    )
    totalPvKwh += building.pvYieldKwh
  })
  const provenance = fromStage(STAGE_IDS.shading, context)
  upsertAsset(state, {
    id: 'asset:shading-result',
    kind: 'shadingResult',
    name: 'Roof shading factors',
    parentId: GROUP.shadingResults,
    provenance,
    capability: 'workflow.stageRuns',
    summary: 'Annual shading factor per roof (synthetic)',
  })
  upsertAsset(state, {
    id: 'asset:bipv',
    kind: 'pvYield',
    name: 'BIPV / rooftop PV yield',
    parentId: 'asset:buildings',
    provenance,
    capability: 'workflow.stageRuns',
    summary: `${megawattHours(totalPvKwh)}/yr potential (synthetic)`,
  })
  return {
    ok: true,
    summary: `Estimated ${megawattHours(totalPvKwh)}/yr of rooftop PV potential.`,
    warnings: [],
  }
}

function modelArchetypes(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.some((id) => state.buildings[id]?.use === null)) {
    return {
      ok: false,
      message: 'Building use is missing. Run "Geospatial data enriching".',
    }
  }
  state.archetypes = Object.fromEntries(
    ARCHETYPES.map((archetype) => [archetype.id, { ...archetype }]),
  )
  forEachBuilding(state, (building) => {
    building.archetypeId = matchArchetype(building)
  })
  applyOverrides(state, 'archetypeId')
  const unmatched = state.buildingIds.filter(
    (id) => state.buildings[id]?.archetypeId === null,
  ).length

  upsertAsset(state, {
    id: 'asset:archetype-library',
    kind: 'archetypes',
    name: 'Archetype library and assignments',
    parentId: GROUP.archetypes,
    provenance: fromStage(STAGE_IDS.archetypes, context),
    capability: 'workflow.stageRuns',
    summary: `${ARCHETYPES.length} archetypes; ${state.buildingIds.length - unmatched} buildings assigned`,
  })
  return {
    ok: true,
    summary: `Assigned archetypes to ${state.buildingIds.length - unmatched} buildings.`,
    warnings:
      unmatched > 0
        ? [
            `${unmatched} buildings have no matching archetype and are excluded from energy results. Assign one in the table.`,
          ]
        : [],
  }
}

function setUpBaseline(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (Object.keys(state.archetypes).length === 0) {
    return {
      ok: false,
      message: 'No archetypes are available. Run "Archetype modeling".',
    }
  }
  const byBuildingKwh: Record<string, number> = {}
  let excluded = 0
  forEachBuilding(state, (building) => {
    const archetype = building.archetypeId
      ? state.archetypes[building.archetypeId]
      : undefined
    if (!archetype || building.floorAreaM2 === null) {
      excluded += 1
      return
    }
    byBuildingKwh[building.id] = round(
      building.floorAreaM2 * archetype.euiKwhPerM2,
    )
  })
  if (Object.keys(byBuildingKwh).length === 0) {
    return {
      ok: false,
      message: 'No building has both an archetype and a floor area.',
    }
  }
  const baseline = makeResultSet(
    'result:baseline',
    'Baseline',
    context.runId,
    byBuildingKwh,
  )
  state.results.baseline = baseline

  const provenance = fromStage(STAGE_IDS.baseline, context)
  upsertAsset(state, {
    id: 'asset:weather-typical-year',
    kind: 'weather',
    name: 'Synthetic typical year (Boston stand-in)',
    parentId: GROUP.weather,
    provenance,
    capability: 'workflow.stageRuns',
    summary: 'Hourly weather stand-in; not measured data',
  })
  upsertAsset(state, {
    id: 'asset:baseline-model',
    kind: 'energyModel',
    name: 'Baseline energy model',
    parentId: GROUP.energyModel,
    provenance,
    capability: 'workflow.stageRuns',
    summary: `${Object.keys(byBuildingKwh).length} buildings modeled`,
  })
  upsertAsset(state, {
    id: 'asset:result-baseline',
    kind: 'energyResult',
    name: 'Baseline results',
    parentId: GROUP.energyResults,
    provenance,
    capability: 'dashboard.comparison',
    summary: `${megawattHours(baseline.totalKwh)}/yr, peak ${baseline.peakKw.toLocaleString('en-US')} kW (synthetic)`,
  })
  return {
    ok: true,
    summary: `Baseline demand is ${megawattHours(baseline.totalKwh)}/yr (synthetic).`,
    warnings:
      excluded > 0
        ? [`${excluded} buildings without an archetype were excluded.`]
        : [],
  }
}

function usesPvWithoutYield(state: WorkbenchState): boolean {
  const pvMeasureIds = new Set(
    Object.values(state.measures)
      .filter((measure) => measure.kind === 'pv')
      .map((measure) => measure.id),
  )
  const scenariosUsePv = Object.values(state.scenarios).some((scenario) =>
    scenario.measureIds.some((id) => pvMeasureIds.has(id)),
  )
  const hasYield = state.buildingIds.some(
    (id) => (state.buildings[id]?.pvYieldKwh ?? null) !== null,
  )
  return scenariosUsePv && !hasYield
}

function confirmScenarioDefinitions(state: WorkbenchState): StageRunResult {
  const scenarios = Object.values(state.scenarios)
  if (scenarios.length === 0) {
    return {
      ok: false,
      message:
        'Define at least one scenario before confirming definitions. Open Creator to add a measure and a scenario.',
    }
  }
  const warnings = usesPvWithoutYield(state)
    ? [
        'PV measures will have no effect because shading and PV yield were not estimated.',
      ]
    : []
  return {
    ok: true,
    summary: `Confirmed ${scenarios.length} scenario(s) using ${Object.keys(state.measures).length} measure(s).`,
    warnings,
  }
}

export type ScenarioResultOptions = {
  runId: string
  /** Overrides the scenario's saved adoption, for what-if previews. */
  adoptionPercent?: number
}

/**
 * Synthetic scenario demand against the baseline. Shared by the scenario
 * modeling stage and dashboard previews so both use exactly the same formula.
 */
export function computeScenarioResult(
  state: WorkbenchState,
  scenario: Scenario,
  options: ScenarioResultOptions,
): ResultSet | null {
  const baseline = state.results.baseline
  if (!baseline) return null
  const measures = scenario.measureIds.flatMap((id) => {
    const measure = state.measures[id]
    return measure ? [measure] : []
  })
  const adoption = (options.adoptionPercent ?? scenario.adoptionPercent) / 100
  const byBuildingKwh: Record<string, number> = {}
  for (const [buildingId, kwh] of Object.entries(baseline.byBuildingKwh)) {
    const building = state.buildings[buildingId]
    const applicable = measures.filter(
      (measure) =>
        measure.appliesTo === 'all' || measure.appliesTo === building?.use,
    )
    const savingsPercent = Math.min(
      60,
      applicable
        .filter((measure) => measure.kind !== 'pv')
        .reduce((sum, measure) => sum + measure.savingsPercent, 0),
    )
    const pvOffset = applicable.some((measure) => measure.kind === 'pv')
      ? (building?.pvYieldKwh ?? 0) * adoption
      : 0
    byBuildingKwh[buildingId] = Math.max(
      0,
      round(kwh * (1 - (savingsPercent / 100) * adoption) - pvOffset),
    )
  }
  return makeResultSet(
    `result:${scenario.id}`,
    scenario.name,
    options.runId,
    byBuildingKwh,
  )
}

function modelScenarios(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  const baseline = state.results.baseline
  if (!baseline) {
    return {
      ok: false,
      message: 'No baseline results. Run "Baseline model setup".',
    }
  }
  const scenarios = Object.values(state.scenarios)
  if (scenarios.length === 0) {
    return { ok: false, message: 'No scenarios are defined.' }
  }
  const provenance = fromStage(STAGE_IDS.scenarioModeling, context)
  state.results.scenarios = {}
  let bestReduction = 0
  for (const scenario of scenarios) {
    const result = computeScenarioResult(state, scenario, {
      runId: context.runId,
    })
    if (!result) continue
    state.results.scenarios[scenario.id] = result
    bestReduction = Math.max(
      bestReduction,
      1 - result.totalKwh / baseline.totalKwh,
    )
    upsertAsset(state, {
      id: `asset:result-${scenario.id}`,
      kind: 'energyResult',
      name: `${scenario.name} results`,
      parentId: GROUP.energyResults,
      provenance,
      capability: 'dashboard.comparison',
      summary: `${megawattHours(result.totalKwh)}/yr (synthetic)`,
      entityIds: [scenario.id],
    })
  }
  return {
    ok: true,
    summary: `Modeled ${scenarios.length} scenario(s); largest reduction ${round(bestReduction * 100, 1)}%.`,
    warnings: usesPvWithoutYield(state)
      ? ['PV measures had no effect because PV yield was not estimated.']
      : [],
  }
}

function defineGrid(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (state.buildingIds.length === 0) {
    return { ok: false, message: 'No buildings to connect to a grid.' }
  }
  const substation: LngLat = [
    DISTRICT_BOUNDS.west - 2 * SPACING_DEGREES,
    DISTRICT_CENTER[1],
  ]
  // North of the district, toward the river; the plant itself is synthetic.
  const utilityPv: LngLat = [
    DISTRICT_CENTER[0],
    DISTRICT_BOUNDS.north + 1.5 * SPACING_DEGREES,
  ]
  const buildingsByQuadrant: string[][] = [[], [], [], []]
  const centroidsByQuadrant: LngLat[][] = [[], [], [], []]
  forEachBuilding(state, (building) => {
    const quadrant = quadrantOf(building)
    buildingsByQuadrant[quadrant]?.push(building.id)
    centroidsByQuadrant[quadrant]?.push(centroidOf(building.footprint))
  })

  const elements: Record<string, GridElement> = {}
  const add = (element: GridElement) => {
    elements[element.id] = element
  }
  add({
    id: 'BUS-SUB',
    kind: 'bus',
    name: 'Substation bus',
    coordinates: [substation],
    ratingKva: null,
    buildingIds: [],
  })
  add({
    id: 'UPV-1',
    kind: 'utilityPv',
    name: 'Utility PV plant',
    coordinates: [utilityPv],
    ratingKva: 4_000,
    buildingIds: [],
  })
  add({
    id: 'L-UPV',
    kind: 'line',
    name: 'PV tie line',
    coordinates: [utilityPv, substation],
    ratingKva: null,
    buildingIds: [],
  })
  buildingsByQuadrant.forEach((buildingIds, quadrant) => {
    const number = quadrant + 1
    const centroids = centroidsByQuadrant[quadrant] ?? []
    const center: LngLat =
      centroids.length > 0 ? meanOf(centroids) : DISTRICT_CENTER
    add({
      id: `T${number}`,
      kind: 'transformer',
      name: `Transformer T${number}`,
      coordinates: [center],
      ratingKva: TRANSFORMER_RATINGS_KVA[quadrant] ?? 6_000,
      buildingIds,
    })
    add({
      id: `BUS-T${number}`,
      kind: 'bus',
      name: `Bus T${number}`,
      coordinates: [center],
      ratingKva: null,
      buildingIds: [],
    })
    add({
      id: `L-F${number}`,
      kind: 'line',
      name: `Feeder F${number}`,
      coordinates: [substation, center],
      ratingKva: null,
      buildingIds: [],
    })
    add({
      id: `LOAD-T${number}`,
      kind: 'load',
      name: `Load center ${number}`,
      coordinates: [center],
      ratingKva: null,
      buildingIds,
    })
  })
  state.gridElements = elements
  state.gridResult = null

  const provenance = fromStage(STAGE_IDS.gridDefinitions, context)
  const count = (kind: GridElement['kind']) =>
    Object.values(elements).filter((element) => element.kind === kind).length
  const groups: [string, string, string, GridElement['kind']][] = [
    ['asset:grid-lines', GROUP.gridLines, 'Lines', 'line'],
    ['asset:grid-buses', GROUP.gridBuses, 'Buses', 'bus'],
    [
      'asset:grid-transformers',
      GROUP.gridTransformers,
      'Transformers',
      'transformer',
    ],
    ['asset:grid-utility-pv', GROUP.gridUtilityPv, 'Utility PV', 'utilityPv'],
    ['asset:grid-loads', GROUP.gridLoads, 'Load centers', 'load'],
  ]
  for (const [id, parentId, name, kind] of groups) {
    upsertAsset(state, {
      id,
      kind: 'gridElements',
      name,
      parentId,
      provenance,
      capability: 'workflow.stageRuns',
      summary: `${count(kind)} synthetic ${name.toLowerCase()}`,
    })
  }
  return {
    ok: true,
    summary: `Defined ${Object.keys(elements).length} synthetic grid elements.`,
    warnings: [],
  }
}

function modelGrid(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  const transformers = Object.values(state.gridElements).filter(
    (element) => element.kind === 'transformer',
  )
  if (transformers.length === 0) {
    return {
      ok: false,
      message:
        'No grid elements are defined. Run "Grid definitions" or skip grid modeling.',
    }
  }
  const baseline = state.results.baseline
  if (!baseline) {
    return {
      ok: false,
      message: 'No baseline results. Run "Baseline model setup".',
    }
  }
  if (context.attempt === 1) {
    // Scripted failure so the failed state and recovery can be exercised.
    return {
      ok: false,
      message:
        'Simulated solver failure: the power flow did not converge on feeder F2. Run the stage again to continue.',
    }
  }
  const transformerLoadingPercent: Record<string, number> = {}
  const warnings: string[] = []
  for (const transformer of transformers) {
    const annualKwh = transformer.buildingIds.reduce(
      (sum, id) => sum + (baseline.byBuildingKwh[id] ?? 0),
      0,
    )
    const peakKw = (annualKwh / HOURS_PER_YEAR) * PEAK_FACTOR
    const loading = round((peakKw / (transformer.ratingKva ?? 1)) * 100)
    transformerLoadingPercent[transformer.id] = loading
    if (loading > 100) {
      warnings.push(
        `${transformer.name} is loaded to ${loading}% of its rating at baseline peak (synthetic).`,
      )
    }
  }
  state.gridResult = { runId: context.runId, transformerLoadingPercent }
  upsertAsset(state, {
    id: 'asset:grid-result',
    kind: 'gridResult',
    name: 'Transformer loading',
    parentId: GROUP.gridResults,
    provenance: fromStage(STAGE_IDS.gridModeling, context),
    capability: 'workflow.stageRuns',
    summary: `${transformers.length} transformers evaluated (synthetic)`,
  })
  return {
    ok: true,
    summary: `Estimated loading for ${transformers.length} transformers.`,
    warnings,
  }
}

function assembleDashboard(
  state: WorkbenchState,
  context: StageRunContext,
): StageRunResult {
  if (!state.results.baseline) {
    return { ok: false, message: 'No baseline results to visualize.' }
  }
  const resultCount = 1 + Object.keys(state.results.scenarios).length
  const provenance = fromStage(STAGE_IDS.dashboard, context)
  upsertAsset(state, {
    id: 'asset:view-dashboard',
    kind: 'view',
    name: 'Baseline and scenario dashboard',
    parentId: GROUP.views,
    provenance,
    capability: 'dashboard.comparison',
    summary: `${resultCount} result set(s)`,
  })
  upsertAsset(state, {
    id: 'asset:report-summary',
    kind: 'report',
    name: 'Summary report',
    parentId: GROUP.reports,
    provenance,
    capability: 'reports.export',
    summary: 'Content assembled from synthetic results; export is planned',
  })
  return {
    ok: true,
    summary: `Assembled a dashboard for ${resultCount} result set(s).`,
    warnings: [],
  }
}

const STAGE_RUNNERS: Record<
  string,
  (state: WorkbenchState, context: StageRunContext) => StageRunResult
> = {
  [STAGE_IDS.location]: captureFootprints,
  [STAGE_IDS.enrichment]: enrichFootprints,
  [STAGE_IDS.schema]: matchSchema,
  [STAGE_IDS.shading]: estimateShadingAndPv,
  [STAGE_IDS.archetypes]: modelArchetypes,
  [STAGE_IDS.baseline]: setUpBaseline,
  [STAGE_IDS.scenarioDefinitions]: confirmScenarioDefinitions,
  [STAGE_IDS.scenarioModeling]: modelScenarios,
  [STAGE_IDS.gridDefinitions]: defineGrid,
  [STAGE_IDS.gridModeling]: modelGrid,
  [STAGE_IDS.dashboard]: assembleDashboard,
}

/**
 * Applies a stage's synthetic outputs to the draft state. Each runner checks
 * its preconditions before mutating, so a failed run leaves earlier outputs intact.
 */
export function runSimulatedStage(
  state: WorkbenchState,
  stageId: string,
  context: StageRunContext,
): StageRunResult {
  const runner = STAGE_RUNNERS[stageId]
  if (runner) return runner(state, context)
  if (state.workflow.stages[stageId]?.custom) {
    return {
      ok: true,
      summary: 'Checkpoint recorded; custom stages produce no outputs.',
      warnings: [],
    }
  }
  return {
    ok: false,
    message: 'No simulated behavior is defined for this stage.',
  }
}
