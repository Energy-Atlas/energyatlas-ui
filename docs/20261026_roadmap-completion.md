# Roadmap slices 3–8: completion report

Date: 2026-10-26. Scope and authority: [autonomous handoff](20261026_autonomous-roadmap-handoff.md),
[rollout plan](jobs-rollout-plan.md) D1–D10, decisions [0025](decisions/0025-jobs-list-and-detail-pane.md) and
[0026](decisions/0026-autonomous-roadmap-through-results.md). Work ran in the worktree
`D:/energyatlas-ui/.claude/worktrees/autonomous-roadmap-slices-9210de`, one branch per slice, each fast-forwarded into
local `master` in `D:/energyatlas-ui` after an independent review and the required checks passed.

Nothing was pushed or deployed, no pull request was created, `feature/agentic` was not merged, and the RC checkout was
only read (`git --no-optional-locks show/ls-tree` at `7464c140`). No package was added.

## Slices

| Slice | Branch | Merged at | Record |
| --- | --- | --- | --- |
| 3 Jobs | `claude/slice-3-jobs` | `805c23d` | [Jobs execution plan and status](jobs-execution-plan.md) |
| 4 Data intake | `claude/slice-4-data-intake` | `a9be786` | [Data intake](data-intake.md) |
| 5 Archetypes and schedules | `claude/slice-5-archetypes` | `081f25e` | [Archetypes and schedules](archetypes-schedules.md) |
| 6 Measures and scenarios | `claude/slice-6-scenarios` | `8d5c3ea` | [Measures and scenarios](measures-scenarios.md) |
| 7 Calibration | `claude/slice-7-calibration` | `ad0574a` | [Calibration](calibration.md) |
| 8 Results | `claude/slice-8-results` | `e35e0cf` | [Results](results.md) |

Read-only RC facts for slices 4–8 are in [RC observations](roadmap-rc-observations.md). The one material difference
from RC is recorded there: RC fuses geometrically, while the approved demo rule (D9) matches stable source IDs.

## What the shared job contract now covers

- Every stage run, data fusion, and calibration fit is a run group with an input signature (upstream revisions and
  edit revisions, the stage's edit revision, item membership, and run options), checked at start, retry, and
  publication. Fusions and fits are side runs that do not make their stage look running.
- Item stages (geospatial preprocessing, archetype assignment, scenario modeling) and fusions hold item outputs until
  every item succeeds, then publish once; failed items retry with unchanged inputs; changed inputs need a fresh run.
- One job runs at a time, FIFO; cancellation publishes nothing; saves keep history and held outputs; reopening
  interrupts active work; older saves migrate.

## Verification

Each slice record lists its own final verification. On the final Results commit: `npm run typecheck`, `npm run lint`,
and `npm run format:check` clean; `npm test` 299 passed (34 files); `npm run test:e2e` 87 passed; `npm run test:e2e:preview`
3 passed. The baseline before slice 3 was 224 unit, 69 development browser, and 2 preview tests. The Edge-based
browser suites cover every new page in light and dark engineering with axe, keyboard paths, narrow layouts, the base
path, and a real CSV download.

## Known limits and next steps

- Computation is synthetic everywhere; values are not engineering results. Real connections are built inside RC
  later (decision 0022).
- Roadmap, Dashboard, and empty-state Run controls rely on the server to explain item-input refusals; Workflow, Jobs,
  and actions show them before sending.
- Dashboard chart slots are numbered across all scenarios, including ones left out of the comparison set.
- A full district benchmark (10,000 buildings) remains the separately recorded cross-cutting deliverable; slices
  paginate long tables and lists instead of rendering every row.
- Job history is saved in full; pruning, notices persistence, and a generic job-schema runner are not built.
- The owner may review the merged slices and decide whether to publish `master`; nothing here pushed it.
