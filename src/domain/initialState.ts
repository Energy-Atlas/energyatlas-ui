import { createAssetSkeleton } from './assets.ts'
import { createSchemaMatching } from './schema/registry.ts'
import type { WorkbenchState } from './types.ts'
import { createDefaultWorkflow } from './workflow.ts'
import { initialZoning } from './zoning/zoning.ts'

/** An empty synthetic project: the asset skeleton and the default workflow, nothing run yet. */
export function createInitialState(): WorkbenchState {
  const { assets, rootAssetIds } = createAssetSkeleton()
  return {
    project: {
      id: 'project:synthetic-district',
      name: 'Synthetic district (demo)',
      location: null,
    },
    assets,
    rootAssetIds,
    buildings: {},
    buildingIds: [],
    archetypes: {},
    parts: {},
    rules: {},
    ruleIds: [],
    schedules: {},
    measures: {},
    scenarios: {},
    scenarioRules: {},
    results: { baseline: null, scenarios: {}, scenarioVersions: {} },
    gridElements: {},
    gridResult: null,
    overrides: {},
    workflow: createDefaultWorkflow(),
    tasks: {},
    taskIds: [],
    runGroups: {},
    runGroupIds: [],
    sourceRecords: {},
    sourceRecordIds: [],
    datasets: {},
    schemaMatching: createSchemaMatching(),
    zoning: initialZoning(),
    calibration: {
      variants: {},
      variantIds: [],
      adoptedVariantId: null,
      modeled: null,
    },
    issues: [],
    selection: { entityType: null, ids: [] },
    pendingEdits: {},
    nextId: 1,
  }
}
