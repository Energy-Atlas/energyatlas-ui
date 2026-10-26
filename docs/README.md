# Documentation index

- [Autonomous implementation handoff, 2026-10-26](20261026_autonomous-roadmap-handoff.md): next agent starts here; approved scope through Results, local-merge authority, kickoff message, repository/worktree locations, and verification baseline.
- [Measures and scenarios plan and status](measures-scenarios.md): roadmap step 6 as built: measure library, editing, composition rule, comparison sets, modeled comparison.
- [Archetypes and schedules plan and status](archetypes-schedules.md): roadmap step 5 as built: definitions, schedules, library, coverage, assignment jobs.
- [Data intake plan and status](data-intake.md): roadmap step 4 as built: synthetic datasets, mapping, validation, stable-ID fusion jobs.
- [RC observations for slices 4–8](roadmap-rc-observations.md): read-only reference facts at `7464c140` for data intake, archetypes, scenarios, calibration, and results.
- [Jobs execution plan and status](jobs-execution-plan.md): roadmap step 3 as built: run groups, held item results, retry rules, FIFO runner, UI, verification.
- [Jobs rollout plan](jobs-rollout-plan.md): bundled cross-stage decisions, bounded slices through Results, and proposed autonomous execution scope.
- [Jobs discussion](jobs-discussion.md): read-only RC observations, accepted list/detail pane and held-result retry rules (decision 0025), and remaining cross-stage choices.
- [Project lifecycle design](project-lifecycle-design.md): accepted start screen and job confirmation (decision 0024), implemented behavior, boundaries, verification, and remaining limitations.
- [Project lifecycle implementation plan](project-lifecycle-plan.md): service, shared guards, UI, and verification stages.
- [Review and project lifecycle discussion, 2026-10-25](20261025_review-and-project-lifecycle.md): local integration, review fixes, final verification, and pending directions for roadmap step 2.
- [Handoff, 2026-10-25](20261025_handoff.md): session state before review: branches, what was built, verification, next steps, and open questions.
- [Developer guide](developer-guide.md): start here to take over the code; architecture, extension recipes, test conventions, storage, and known gaps.
- [Source handoff](20260913_product-ui-experiment-agent-handoff.md): complete initiation brief, preserved unchanged.
- [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md): current visual and interaction guidance supplied by the user on 2026-09-15 and maintained by the user (decision 0009); the Geist typeface was added at the user's request (decision 0010).
- [Design alignment](design-alignment.md): the build compared with the design guidelines; decisions from discussion, the implemented plan, verification, and remaining gaps.
- [Family alignment](design-alignment-family.md): the alignment with the EnergyAtlas family of decision 0021 (the family look winning); audit, translation, contrast evidence, implementation, and verification.
- [Reference UI audit](reference-ui-audit.md): stack/hosting map, UI inventory, source evidence, legacy risks, reuse assessment, and limitations.
- [Source manifest](reference-source-manifest.json): hashes of principal inspected reference files; no implementation copied.
- [UI directions](ui-directions.md): three product approaches, technical comparison, recommendation, proposed slice boundaries, and two pending decisions.
- [First-slice plan and status](first-slice-proposal.md): layout details, state model, workflow stages, working/simulated/planned boundary, per-stage implementation status with verification evidence, deviations, and next steps.
- [Package selection proposal](package-selection.md): researched package recommendations, fallbacks, constraints, spikes, and rejected candidates.
- [Pre-connection roadmap](pre-connection-roadmap.md): the UI work to build and test before real backend connections, which are built inside RCEnergySimulator later (decision 0022).
- [Decision records](decisions/README.md): accepted constraints and future product/technical decisions.

Current phase (2026-09-15): first-slice implementation; stages 1 to 3c and the design alignment pass built on `master`; stage 4 (scripted agent, [decision 0011](decisions/0011-agent-view-specs-and-missing-state.md)) built on the `feature/agentic` branch. History: setup and source audit complete; UI stack accepted in [decision 0002](decisions/0002-web-react-typescript-vite.md) (web-only, React/TypeScript/Vite); combined product shell, workbench layout with docking, and first-slice workflow accepted in decisions [0003](decisions/0003-combined-product-shell.md), [0004](decisions/0004-workbench-layout-and-docking.md), and [0005](decisions/0005-first-slice-workflow-and-panel-scope.md); scripted agent and layout details in [0006](decisions/0006-scripted-agent-and-layout-details.md). Packages accepted in [0007](decisions/0007-package-selection.md); app scaffolded, and package spikes run 2026-09-14 ([results](package-selection.md#spike-results-2026-09-14)). FlexLayout accepted for docking in [0008](decisions/0008-flexlayout-docking.md). First slice in progress: stages 1 (domain state and commands), 2 (workbench shell), 3a (assets, creator, roadmap), 3b (map and table), and 3c (dashboard) are complete; see [implementation status](first-slice-proposal.md#implementation-status). UI design guidance accepted in [decision 0009](decisions/0009-ui-design-guidelines.md) and the Geist typeface in [decision 0010](decisions/0010-geist-typeface.md); the design alignment pass implements them, with evidence and remaining gaps in [design alignment](design-alignment.md). The OpenFreeMap basemap over Boston Back Bay OpenStreetMap footprints ([decision 0012](decisions/0012-openfreemap-basemap-back-bay.md)) is built on the `feature/basemap` branch, together with 3D building extrusion ([decision 0013](decisions/0013-3d-building-extrusion.md)) and live terrain for display ([decision 0015](decisions/0015-terrain.md)).

## Verification recorded 2026-09-13

- Source handoff SHA-256 still matches the original recorded in decision 0001.
- All local Markdown links resolve; audit-stage staged diff passes `git diff --cached --check`.
- `.env.local` exists and is ignored; credential variants were checked with `git check-ignore`. The tracked template contains comments only because no integration is configured.
- Staged content was reviewed for credentials; a supplemental credential-pattern scan found none.
- All 40 reference-file hashes match the audit manifest; the reference's 28 pre-existing Git status entries remain unchanged.
- Initial handoff includes intentional Markdown hard-break spaces. The initialization diff check used `git -c core.whitespace=-blank-at-eol diff --cached --check` to preserve the supplied file unchanged.
- No application build, runtime test, or screenshot verification was performed; this milestone contains documentation and repository configuration only.

## Second-machine check recorded 2026-09-13

Machine paths: this repository at `E:/Coding/eaui`, reference at `E:/Coding/RCEnergySimulator` (decision 0001 and the audit record the audit machine's `C:/github/...` paths). Read-only inspection only.

- Reference is on the audited branch and HEAD (`backup/code-review-local-2026-09-06`, `545751dd`) but its working tree is clean; the 28 audited status entries are absent here.
- Manifest: 38 of 40 hashes match. `EnergyAtlasWeb/README.md` differs only by line endings. `EnergyAtlasWeb/Controllers/SimulationController.cs` differs in content, consistent with the audit having hashed its uncommitted local modification. Audit findings about that file describe the audit machine's working copy.
- Handoff: committed blob matches the decision 0001 SHA-256. The worktree file hashes differently only because `core.autocrlf=true` converts line endings on checkout; `git status` is clean.
- `.env.local` was created from `.env.example` per README setup and confirmed ignored by `git check-ignore`.
- Added `CLAUDE.md`, which imports `AGENTS.md` so Claude Code loads the repository rules automatically.

## Reference drift check recorded 2026-09-14

Audit machine (`C:/github/...`), read-only inspection only.

- Reference branch unchanged (`backup/code-review-local-2026-09-06`), but HEAD advanced one commit from audited `545751dd` to `436a76a7` (2026-09-14, "refactor(ubem)!: merge UbemSimplePC into UbemSimple as a streaming run mode"). Working tree is now clean; the 28 audited status entries were committed or removed.
- Within `EnergyAtlasWeb` and `EnergyAtlasDesktopEto`, only `Controllers/SimulationController.cs` differs: `/api/simulation/run` accepts `options.executionMode` = `streaming` (default) or `chunked` and returns 400 otherwise. UI surfaces in the audit are unaffected; the run-API description should be read with this addition.
- Confirmed for the technical-lane discussion: `WebAppFactory.cs` serves `wwwroot` with `UseDefaultFiles`/`UseStaticFiles` and has no SPA fallback route; `Connectors/python/src/energyatlas/` is a Python HTTP client of the web API; no `package.json`, TypeScript, or Razor files exist outside build/dependency folders.

## Scaffold verification recorded 2026-09-14

- Based on the `create-vite` 9.2.1 `react-ts` template, generated outside the repository and merged by hand. The template's demo assets and README were not copied, and its oxlint setup was replaced by ESLint and Prettier per decision 0007.
- `npm install` with exact versions: 0 vulnerabilities reported.
- `npm run build` (typecheck plus Vite build) passed; the scaffold bundle is 219.92 kB JS (68.77 kB gzip).
- `npm run lint` and `npm run format:check` passed.
- `npm test`: 1 Vitest component test passed.
- `npm run test:e2e`: 1 Playwright test passed in the installed Microsoft Edge at 1280x800, with no axe violations.
- The scaffold page implements no workflow; it states that the workbench, workflow, and agent are not implemented yet.

## Node 24 baseline recorded 2026-09-15

Machine paths `E:/Coding`. Design alignment verification is in [design alignment](design-alignment.md#verification-2026-09-15).

- Node.js 20.11.1 was active and could not run Vitest or Vite (`node:util` has no `styleText`). nvm-windows now selects Node.js 24.21.0.
- A running `npm run dev` locked rolldown's native binding and interrupted `npm ci`; it passed after the dev server was stopped.
- Baseline on unchanged code: typecheck, lint, and 38 unit tests passed. With the default Playwright worker count, 25 of 30 browser tests passed and 5 timed out; those passed with 4 workers, which the configuration now uses locally.
- `core.autocrlf=true` makes `npm run format:check` report 97 files; `npx prettier --check . --end-of-line auto` passes.

## Reference location check recorded 2026-10-25

Machine paths: this repository at `D:/energyatlas-ui` (worktrees under `.claude/worktrees/`), reference at
`C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`. Read-only inspection only (`git --no-optional-locks`).

- The reference's main checkout was on `claude/mcp-design-setup-3a8705` (`2f35683b`). The most recent development is
  `feature/archetype-library-schedule-registry` at `7464c140` (2026-10-21), 1,015 commits ahead of the default branch
  `origin/main24` (`f86f1849`, 2026-06-06).
- `EnergyAtlasWeb` still serves plain `wwwroot` pages through `UseDefaultFiles`/`UseStaticFiles` and maps two SignalR
  hubs; `EnergyAtlasDesktopEto` hosts it in-process behind WebView2. Facts and the resulting choice are in
  [decision 0022](decisions/0022-backend-connections-inside-rc.md).
