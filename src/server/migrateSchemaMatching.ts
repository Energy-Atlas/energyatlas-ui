import { createSchemaMatching } from '../domain/schema/registry.ts'
import { STAGE_IDS } from '../domain/workflow.ts'

// Saved projects from before Schema matching mapped attributes (decision
// 0032, stage 4) ran a simulated stage that applied nothing. Such a save gets
// the built-in mapping a new project starts with, unpublished. Where Schema
// matching had run, a new edit revision marks it outdated, and an issue says
// why: running it again applies the mapping (whose built-in values agree with
// the enrichment, so later results change only where the mapping is edited).

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The issue a migrated project shows about its unpublished mapping. */
export const SCHEMA_MIGRATION_ISSUE_ID = 'issue:migrated-schema-matching'

/**
 * Migrates a save from before the Schema matching mapping; other values pass
 * through unchanged for the schema to check.
 */
export function migrateSchemaMatching(value: unknown): unknown {
  if (!isObject(value) || 'schemaMatching' in value) return value
  const state: Raw = structuredClone(value)
  state.schemaMatching = createSchemaMatching()
  const workflow = isObject(state.workflow) ? state.workflow : {}
  const stages = isObject(workflow.stages) ? workflow.stages : {}
  const stage = stages[STAGE_IDS.schema]
  if (isObject(stage) && isObject(stage.lastRun)) {
    const next = typeof state.nextId === 'number' ? state.nextId : 1
    stage.editRevision = next
    state.nextId = next + 1
    const issues = Array.isArray(state.issues) ? state.issues : []
    issues.push({
      id: SCHEMA_MIGRATION_ISSUE_ID,
      severity: 'info',
      message:
        'This project was saved before Schema matching mapped footprint attributes. It now has the built-in mapping of OpenStreetMap building tags; run Schema matching again to apply it.',
      stageId: STAGE_IDS.schema,
      createdAt: new Date().toISOString(),
    })
    state.issues = issues
  }
  return state
}
