# Handoff: planning the backend connection

Date: 2026-11-08. For the agent that will propose the architecture and implementation plan for connecting this UI
to RC's `EnergyAtlasWeb` (the ASP.NET backend that the `energyatlas` Python connector and `energyatlas-mcp` call).
This session only gathered evidence; no direction has been chosen.

## Short kickoff message

> Start EnergyAtlas from `master` in `D:/energyatlas-ui` and read
> `docs/20261108_backend-connection-planning-handoff.md`, then `docs/backend-connection/README.md`. Plan, do not
> implement: write the directions for connecting this UI to RC's `EnergyAtlasWeb` (two or three grounded options for
> each open decision, with a recommendation), then wait for the owner. RC and `D:/energyatlas-mcp` are read-only.
> Do not push, deploy, or merge `feature/agentic`.

## Starting state

| Item | State |
| --- | --- |
| This repository | `D:/energyatlas-ui`, `master`, remote `https://github.com/Energy-Atlas/energyatlas-ui.git`. On 2026-11-08 the owner had `master` pushed to `origin/master`; there is no other unpushed work except the unmerged `feature/agentic` (decision 0022). |
| Evidence | [docs/backend-connection/](backend-connection/README.md), from `master` at `c49dcff` plus the index commit |
| RCEnergySimulator | `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`, read-only. Checked out at `feature/archetype-library-schedule-registry` = `main26` = `7464c140` (2026-10-21); remote unchanged on 2026-11-08 |
| energyatlas-mcp | `D:/energyatlas-mcp`, read-only, `main` at `1b7e598` (2026-11-01) |
| Checks on 2026-11-08 | typecheck passed; 585 unit tests passed; lint and format pass on the repository's own files but fail on nested `.claude/worktrees/` checkouts (see the index, section 8) |

## Read in this order

1. [AGENTS.md](../AGENTS.md): reference boundary, Git and credential rules, the planning checkpoint.
2. [Evidence index](backend-connection/README.md): status, governing decisions, the UI-to-RC concept mapping,
   contract mismatches, the nine open decisions (section 6), documentation drift.
3. [Decision 0022](decisions/0022-backend-connections-inside-rc.md) and
   [decision 0023](decisions/0023-mock-server-and-fixture-picker.md): where connections are built and the mock seam
   that was designed to be replaced.
4. [Decision 0036](decisions/0036-owner-review-of-next-stages.md): zones as backend geometry and the four surfaces
   deferred until the connection.
5. [ui-seam.md](backend-connection/ui-seam.md), [rc-api-surface.md](backend-connection/rc-api-surface.md),
   [rc-runtime-hosting.md](backend-connection/rc-runtime-hosting.md) as needed, then the source they cite.
6. For background: [developer guide](developer-guide.md) (architecture, known gaps, deployment),
   [pre-connection roadmap](pre-connection-roadmap.md), [RC observations](roadmap-rc-observations.md).
7. In RC, before proposing contracts: `docs/api/api-call-sequences.md`, `docs/data-flow/s09-rest-signalr.md`,
   `docs/data-flow/s11-frontend-hosts-engine.md`, and the API tests in `tests/suites/EnergyAtlasWeb.ApiTests`. In
   `D:/energyatlas-mcp`: `docs/plans/2026-11-01-rcenergysimulator-issues.md`.

## What to produce

A directions document in `docs/` (for example `docs/backend-connection/directions.md`) that:

- answers each open decision in section 6 of the index with two or three grounded options, their costs, and a
  recommendation. Decision 0022 comes first, because it currently forbids real connections in this repository and
  leaves the location inside RC open;
- for the recommended path, outlines the stages, the contract each stage needs from RC (existing endpoints, or new
  ones RC would have to add), what stays mocked, and how each stage is verified;
- separates observed facts (with paths and revisions) from interpretation, as `AGENTS.md` requires, and re-checks any
  line number it relies on, since the index's line numbers were not all re-verified.

Then stop and wait for the owner. Record the owner's choices as new decision records in `docs/decisions/` (the next
number is 0037), and keep the alternatives they did not choose in the directions document.

## Boundaries

- Planning only. No implementation in this repository or in RC until the owner accepts a direction.
- RC and `energyatlas-mcp` are read-only: no edits, builds, runs, dependency installs, fetches into their refs, branch
  changes, or commits. Use `git --no-optional-locks`; `git ls-remote` is a safe way to check their remotes.
- Do not copy RC code, assets, or data into this repository (decision 0001). Never reproduce credentials: RC's
  `EnergyAtlasWeb/appsettings.json` holds a literal map token.
- Do not push, deploy, or create pull requests without the owner's explicit request; a `master` push deploys GitHub
  Pages. Commits carry no assistant, model, or vendor attribution (`CLAUDE.md`).
- `feature/agentic` stays unmerged (decision 0022).

## Known loose ends (not part of the planning task unless the owner says so)

- Documentation drift listed in section 7 of the index (`docs/README.md`, the developer guide, `AGENTS.md`'s zoning
  description).
- The lint and format scripts scan `.claude/worktrees/`; the four worktrees there hold merged branches.
- The Pages workflow run for decision 0029 (2026-10-27) failed in the browser tests (gallery axe check, two map
  tests, a lifecycle layout test timing out), so the published site was last updated on 2026-10-20. Both runs for the
  2026-11-08 pushes failed the same way (the terrain test and the lifecycle test timing out on the slower runner, and
  focus lost after removing the last view). Fixes followed the same day (`ConfirmDialog` waits for the dialog to
  unmount before placing focus; the lifecycle check split per appearance; every browser-test timeout three times
  longer on CI through `e2e/timeoutScale.ts`; see the developer guide's testing pitfalls); check
  `gh run list --branch master` for whether they deployed.
