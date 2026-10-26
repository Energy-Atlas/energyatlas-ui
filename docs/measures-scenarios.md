# Measures and scenarios (roadmap slice 6): plan and status

Date: 2026-10-26. Branch: `claude/slice-6-scenarios`, from local `master` at `081f25e` (Archetypes merged).
Authority: [rollout plan](jobs-rollout-plan.md) slice 6, [decision 0026](decisions/0026-autonomous-roadmap-through-results.md).
Read-only RC facts: [RC observations](roadmap-rc-observations.md#measures-and-scenarios-slice-6).

## Task plan

1. Library and provenance: a synthetic measure library (`src/domain/scenarios/library.ts`); measures record whether
   they came from the library, the project, or an edited library copy.
2. Editing: `measure.update`, `measure.addFromLibrary`, and `scenario.update` beside the existing creators; a scenario
   combines at most one measure of each kind (RC's per-category rule), checked on create, update, and measure kind
   changes; each change outdates Scenario definitions.
3. Comparison set: `Scenario.included` selects the scenarios Scenario modeling models; definitions need at least one.
4. Jobs: Scenario modeling is an item stage with one item per included scenario; held results publish together,
   with one run ID, and results of scenarios left out are withdrawn.
5. UI: Creator gains a measure library, Edit for measures and scenarios, an inclusion checkbox, a live
   affected-building preview, and a modeled comparison with currentness (`src/app/pages/ScenarioComparison.tsx`).
6. Persistence: measures without provenance and scenarios without inclusion load with defaults.

## Status

Real: library copies, validated editing with undo, the composition rule, inclusion, previews computed with the same
formula as modeling, held per-scenario results, failed-scenario retry, atomic set publication, and currentness.
Mocked: savings are synthetic percentages and results come from the synthetic model. Deferred: optimization, real
physics, costs and payback, prioritized rule cards, and per-building measure assignment.

Behavior notes:

- The preview is an estimate against current baseline results and is labeled synthetic; it never writes results.
- Withdrawn results are derived outputs of a scenario left out of the set; the scenario itself stays.
- Dashboard what-if previews are unchanged and still read published results.

Review: an independent review found one real issue and seven smaller ones. On the domain path, an edit to scenario or
measure definitions during a modeling run did not change the run's signature (the server's edit lock already refuses
such edits); signatures now also record upstream edit revisions (`ancestorEdits`, default empty for older saves), with a
regression test. Also fixed: the invalidation message names the comparison set; `scenario.update` requires
`included`; `scenario.setAdoption` keeps the asset's inclusion note; the agent's scenario session prefers an included
scenario; the preview counts applicable buildings before a baseline exists; Jobs shows scenario names for failed
items; an edit form whose item disappears returns to create mode. Chart slots numbered across excluded scenarios
predate this slice and remain.

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 281 passed; `npm run test:e2e` 83 passed; `npm run test:e2e:preview`
3 passed. Creator screenshots in light and dark engineering at 1280 px were reviewed from ignored `tmp/creator-*.png`.
