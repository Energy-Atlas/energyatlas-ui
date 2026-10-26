# Archetypes and schedules (roadmap slice 5): plan and status

Date: 2026-10-26. Branch: `claude/slice-5-archetypes`, from local `master` at `a9be786` (Data intake merged).
Authority: [rollout plan](jobs-rollout-plan.md) slice 5, [decision 0026](decisions/0026-autonomous-roadmap-through-results.md).
Read-only RC facts: [RC observations](roadmap-rc-observations.md#archetypes-and-schedules-slice-5).

## Task plan

1. Model: archetypes gain an optional construction-year range, a schedule, and provenance (`DefinitionSource`);
   schedules are 24 hourly fractions for a weekday and a weekend day (`state.schedules`).
2. Library and rules: a synthetic library of seven archetypes and four schedules (`src/domain/archetypes/library.ts`);
   matching by use and year range, narrowest range first, then ID (`src/domain/archetypes/assignment.ts`).
3. Commands: `archetype.save`, `archetype.addFromLibrary`, and `schedule.save` validate per field, are undoable, and
   are refused while jobs hold the project; each outdates Archetype modeling through its `editRevision`.
4. Jobs: Archetype modeling is an item stage. Definitions are validated before submission; each building's
   assignment is held and the group publishes together, reapplying manual archetype overrides.
5. UI: Archetypes page (`page.archetypes`) with definition lists, compact archetype and schedule editors, the library,
   coverage by use, and Run assignment; Workflow entry on Archetype modeling.
6. Persistence: archetypes saved before ranges take them from the library entry of the same ID and bring its schedule.

## Status

Real: definition editing with validation and undo, library copies with provenance, deterministic matching,
coverage preview, assignment as an item job with held results, failed-item retry, changed-definition refusal, manual
override precedence, and migration. Mocked: the library values and energy use intensities are synthetic. Deferred:
RC library import, EnergyPlus object editing, calendar exceptions, holidays, daylight saving, and use of schedules in
energy results (disclosed by the `archetypes.schedules` capability).

Behavior notes:

- The first assignment run adds the default library archetypes the project lacks, so existing projects and fixtures
  keep their assignments; mixed-use buildings stay unassigned until an archetype covers them.
- Year bounds are inclusive; a building without a construction year matches the narrowest range open at one end.
- Schedule statistics count five weekdays and two weekend days a week and 52 weeks plus one weekday a year.

Review: an independent review found nothing serious and eight smaller items, addressed as follows. A first run now
adds the default library archetypes the project lacks (not only when it has none), and the coverage preview shows
what that run will do; copied library schedules take a "(library)" suffix when their name is taken; an unknown
construction year again matches the narrowest range open at one end, as the earlier runner did; Workflow, Jobs, and
action Run controls use `stageSubmitBlocker`, which includes definition checks (Roadmap, Dashboard, and empty-state
Run controls still rely on the server's explanation); an edited library copy shows its origin; saving a schedule
outdates assignment only when an archetype uses it; ties compare IDs by code point; blank or mistyped numbers are
refused in the editor instead of being sent. Old-save retry wording after the format change was left as is.

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 275 passed; `npm run test:e2e` 81 passed; `npm run test:e2e:preview`
3 passed. Archetypes screenshots in light and dark engineering at 1280 px and at 900 px were reviewed from ignored
`tmp/archetypes-*.png`.
