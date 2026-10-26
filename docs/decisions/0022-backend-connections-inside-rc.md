# 0022: Real backend connections are built inside RCEnergySimulator, after the demo is refined

Date: 2026-10-25

Status: decided by the user (the owner) on 2026-10-25, after a discussion of where to plug this UI into the real
RCEnergySimulator (RC) backend. The owner also decided that `feature/agentic` is not merged for now.

## Context

Observed on 2026-10-25, read-only (`git --no-optional-locks`), nothing changed in RC:

- **Location on this machine:** `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`, not `../RCEnergySimulator` as
  `AGENTS.md` assumes. Its main checkout was on `claude/mcp-design-setup-3a8705` (`2f35683b`, 2026-10-04).
- **Latest development:** `feature/archetype-library-schedule-registry` at `7464c140` (2026-10-21, "Merge pull request
  #241 from EnvironmentalSystemsLab/feature/mcp"), 1,015 commits ahead of the default branch `origin/main24`
  (`f86f1849`, 2026-06-06). "Latest" here means the most recent commit; which branch the RC team integrates on is not
  confirmed.
- **`EnergyAtlasWeb` (at `7464c140`)** is one .NET 8 project holding both the backend and the current UI:
  - about 24 controllers under `/api/...` (project and workflow, data fusion, schema matching, geometric
    preprocessing, archetype imports, template assignment, the schedule registry, shading, weather, simulation,
    results, calibration, scenario designer, jobs), Swagger/OpenAPI, and two SignalR hubs (`/jobHub`,
    `/workflowProgressHub`), built in `WebAppFactory.cs`;
  - plain HTML and JavaScript pages in `wwwroot/` with no npm build, calling relative `/api/...` URLs, including
    `workflow-pages/` for setup, model, simulation, retrofit scenarios, and results.
- **`EnergyAtlasDesktopEto`** hosts the same Kestrel server in-process and points a WebView2 at it.
  `WebAppFactory.Build(..., localExecutionMode: true)` sets `ExecutionMode=local`, which adds a native bridge for file
  pickers; the browser mode uploads files instead.
- **`D:/energyatlas-mcp`** (a separate repository) exposes EnergyAtlas to MCP clients and reaches the same backend over
  HTTP through RC's Python connector.

## Decision

1. **No real connections in this repository.** The demo keeps running on in-browser state and mock services.
2. **Real connections are built inside RC** when that work starts, so the UI and the API it calls change together and
   the desktop host serves the UI without a copy step. That work needs its own decision: until then RC stays a
   read-only reference, as `AGENTS.md` says.
3. **The demo is refined first.** The work to do before any connection is the
   [pre-connection roadmap](../pre-connection-roadmap.md).
4. **`feature/agentic` stays unmerged for now.** Its five commits beyond `master` (the language-model agent, the four
   fictional districts, the conversation and view surviving a reload, and decision 0020) remain on that branch. Demo
   refinement continues from `master` without them.

## Rationale

- Plugging in early would tie the demo's pace to RC's long chain of stacked branches and bring a Node toolchain into a
  .NET repository before the UI is settled.
- The UI is meant to be served by RC's Kestrel and embedded by the Eto host, so its final home is beside the API it
  calls.

## Alternatives

- **Connecting from this repository through an adapter first** (the dev server proxying `/api` and the hubs to a local
  `EnergyAtlasWeb`): proposed in the discussion, not chosen. Connections wait for the move into RC.
- **Replacing RC's `wwwroot` outright:** not chosen. It would drop working pages (calibration, the archetype editor,
  job lists) in one step.
- **Where inside RC:** not decided. The recommendation from the discussion is a sibling frontend project (for example
  `EnergyAtlasWeb/ClientApp`, built into `wwwroot/app/`) served beside the existing pages, which are then retired one
  by one. This is pending until connections start.

## Consequences

- Backend-shaped behaviour (latency, server errors, rejected input, conflicts, long jobs) is designed now against a mock
  service layer whose resources follow RC's names (project, workflow, jobs) and its error shape, so the later swap is
  small. RC's API is read as a reference for shapes only; no RC implementation, assets, or data are copied (decision
  0001).
- Interfaces that RC will fill later are defined in the demo but stay mocked: file picking (browser upload or desktop
  native picker), sign-in, live progress, and API types.
- Work started on `master` does not include the language-model agent.
