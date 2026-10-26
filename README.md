# Product UI Experiment

A standalone experiment for a coherent EnergyAtlas urban/building energy-modeling product UI. The repository is [Energy-Atlas/energyatlas-ui](https://github.com/Energy-Atlas/energyatlas-ui) and publishes to <https://energy-atlas.github.io/energyatlas-ui/> ([decision 0017](docs/decisions/0017-github-pages-deployment.md)); the local working folder is still `eaui`, and the final product name is not yet decided. This is separate from `json-render-playground`.

## Status

2026-10-25: a browser-only workbench takes one synthetic project through a 12-stage workflow with docked panels, map, table, dashboard, roadmap, creators, and scripted Reasoning sessions. The Account page, shell updates, and mock-server foundation (decision 0023) have been reviewed and integrated into local `master`, with 200 unit, 60 end-to-end, and 2 production-preview tests passing. Nothing from this review has been pushed. Additional language-model work on `feature/agentic` stays unmerged (decision 0022). Next: discuss project lifecycle, step 2 of the [pre-connection roadmap](docs/pre-connection-roadmap.md); pending directions and verification are in the [review record](docs/20261025_review-and-project-lifecycle.md). New contributors start with the [developer guide](docs/developer-guide.md).

Accepted decisions: web-only React + TypeScript + Vite ([0002](docs/decisions/0002-web-react-typescript-vite.md)); a combined shell ([0003](docs/decisions/0003-combined-product-shell.md)) in a docking workbench layout ([0004](docs/decisions/0004-workbench-layout-and-docking.md)) with a 12-stage default workflow ([0005](docs/decisions/0005-first-slice-workflow-and-panel-scope.md)) and a scripted agent ([0006](docs/decisions/0006-scripted-agent-and-layout-details.md)); packages ([0007](docs/decisions/0007-package-selection.md)) with FlexLayout for docking ([0008](docs/decisions/0008-flexlayout-docking.md)). The reference audit and package spikes are recorded in `docs/`.

Core workflows must remain useful without an LLM. Favor explicit state, revisitable workflows, progressive disclosure, desktop information density, keyboard access, and traceable changes/results. Identify mocks clearly.

## Setup and commands

Requires Node.js 24 LTS (22.12 or newer works) and npm. Browser tests use the locally installed Microsoft Edge by default; on machines without Edge, run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`.

```powershell
npm ci                 # install the exact locked dependencies
npm run dev            # start the Vite dev server
npm run build          # typecheck, then build to dist/
npm run preview        # serve the built bundle
npm run typecheck
npm run lint
npm run format:check   # npm run format rewrites files
npm test               # Vitest unit and component tests
npm run test:e2e       # Playwright + axe; starts the dev server on 127.0.0.1:5173
```

Package spikes: run `npm run dev` and open `/?spike=` with `map`, `chart`, `grid`, `flow`, or `flexlayout`.

Before committing, also run `git status --short --branch`, `git diff --check`, and `git diff --cached`.

`.env.example` is the tracked configuration template; `.env.local` is its ignored local counterpart. It lists `OPENAI_API_KEY` and `OPENAI_MODEL`, reserved for a future model provider behind the agent adapter; the first slice reads no variables ([decision 0006](docs/decisions/0006-scripted-agent-and-layout-details.md)). Never expose keys through `VITE_`-prefixed variables, which Vite bundles into client code. On another machine, create the local counterpart if absent:

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
git check-ignore .env.local
```

Before any credential-bearing integration, document its exact variable names, add safe placeholders to the template, and let the user populate local values. Never put private keys in browser-exposed configuration.

## Documentation

- [Documentation index](docs/README.md)
- [Developer guide](docs/developer-guide.md): architecture, extension recipes, tests, known gaps
- [Operating instructions](AGENTS.md) (imported by [CLAUDE.md](CLAUDE.md) for Claude Code)
- [Reference UI audit](docs/reference-ui-audit.md)
- [Three UI directions and technical comparison](docs/ui-directions.md)
- [First-slice proposal](docs/first-slice-proposal.md)
- [Package selection proposal](docs/package-selection.md)
- [Complete source handoff](docs/20260913_product-ui-experiment-agent-handoff.md)

The reference is `../RCEnergySimulator`, primarily `EnergyAtlasWeb`, with `EnergyAtlasDesktopEto` inspected for hosting context. It is view-only and is not a dependency of this repository. If unavailable on another machine, ask for its exact path or URL.
