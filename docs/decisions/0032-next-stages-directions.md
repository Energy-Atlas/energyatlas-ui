# 0032: Next stages: saved layouts, RC-shaped assignment rules, a viewer page, and floors and zones

Date: 2026-10-28

Status: accepted by the owner (2026-10-28, answering the [next stages discussion](../next-stages-discussion.md)).
Nothing is built yet.

## Context

The owner proposed four features: buildings per floor and per zone, interfaces for schema matching and for
archetype and scenario assignment rules and result versions, a view-only page for handing a project over, and saved
layouts for the modeller and the viewer. The discussion recorded RC's behaviour at `7464c140` and asked seven
questions.

## Decision

- **Floors and zones: in the map and Properties (direction A).**
  - A zoning setting in RC's three modes: one zone per building, one per floor, or perimeter and core per floor.
  - The map draws floors as slabs in 3D and the selected buildings' zones.
  - Properties lists the selected building's floors and zones, which share the selection with the Table page.
  - Zones are display only for now: no zone types or per-zone archetype parts to edit.
  - Demo-grade geometry is acceptable. The demo writes its own footprint inset for perimeter-and-core zones, falls
    back to one zone per floor where the inset fails, and adds no geometry package.
- **Archetype assignment: RC's four parts.** Rules assign construction, systems, space loads, and external loads
  separately. Rules are tried by priority, and each part takes the first enabled matching rule that sets it, so one
  building's parts can come from different rules. A manual assignment on a building still wins. The demo's archetype
  model changes to match.
- **Scenarios: RC's shape, kept light.** In RC a scenario is a query and aggregation over results: each building gets
  an alternative version for the scenario, and adoption samples buildings deterministically when results are
  aggregated. The owner considers this not too important for the UI demo. Scenario rules follow RC's rule shape
  (conditions choose buildings, at most one measure per category). If the demo models adoption, it samples
  deterministically, with a fixed seed, when results are aggregated, not inside the rules.
- **Result versions: discussed later.** Not part of the current order.
- **Viewer: a separate page opening a frozen handover package (directions B and C).**
  - A second entry built from the same components, view operations, layout controller, and project client, with its
    own shell.
  - It opens a handover package: the published model and results, the project's layouts and views, and provenance,
    without held outputs, drafts, or job logs.
  - The mock server refuses every model change from a viewer session.
  - The viewer has the agent for questions, interpretations, and view changes, never model changes.
  - Features the viewer cannot use are left out of its page, not shown disabled.
- **Saved layouts: project layouts and personal layouts (direction C).** A layout holds the panel arrangement and
  view settings (such as table settings, map layers and camera, filters, and chosen results). Project layouts are
  saved with the project and included in a handover; personal layouts stay in the browser. A viewer's changes are
  personal and never alter the handed-over layouts, so resetting always returns to them.
- **No 10,000-building benchmark now.**

## Order

1. Saved layouts, personal and project. Built on `claude/next-stages`, not merged ([status](../saved-layouts.md)).
2. Archetype assignment rules with four parts, on a shared rule editor. Built on `claude/next-stages`, not merged
   ([status](../assignment-rules.md)).
3. Scenario assignment rules on the same editor. Built on `claude/next-stages`, not merged
   ([status](../scenario-rules.md)).
4. Schema matching as a real mapping review, sharing the mapping component with Data intake. Built on
   `claude/next-stages`, not merged ([status](../schema-matching.md)).
5. The viewer page and handover package. Built on `claude/next-stages`, not merged
   ([status](../viewer-handover.md)).
6. Floors and zones.

Each stage states what is real, mocked, and deferred before it is built, as `AGENTS.md` requires.

## Execution (2026-10-28)

The owner asked for all six stages to be built unsupervised and reported back with decisions, issues, and review
items, and answered four execution questions:

- **One branch, no merges.** All stages are built in order on `claude/next-stages`; local `master` stays at
  `27e8a1f` until the owner reviews. Nothing is pushed or deployed.
- **Handover by catalog and file.** "Hand over" saves a frozen package in the browser catalog, which the viewer page
  lists, and can download it as a file that the viewer page opens with a browser file input.
- **Left out, not disabled.** Features a viewer cannot use are absent from the viewer page; its shell shows a View only
  badge.
- **Decide and report.** Choices these decisions do not cover get a grounded default (from RC where it has one),
  recorded in the stage's document and listed in the final report for review.

Each stage passes the full check list in `AGENTS.md` and an independent review, whose findings are fixed or
recorded, before the next stage starts.

## Consequences

- The viewer's handover includes the current published results only, because result versions are deferred.
- Archetype definitions gain four part kinds, which changes the Archetypes page, archetype modeling, saved-project
  validation (`src/server/projectSchema.ts`), and the agent's tools.
- The viewer is the first page whose server session is read-only. Its refusals use the same command path as the edit
  lock, so no model change can reach the server from it.
