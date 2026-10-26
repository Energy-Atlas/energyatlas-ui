# 0024: A dedicated project start screen

Date: 2026-10-26

Status: entry flow and confirmation before cancelling active jobs accepted by the owner on 2026-10-26. The
[lifecycle design](../project-lifecycle-design.md) distinguishes those choices from implementation details.
Project lifecycle is roadmap step 2, implemented on `codex/project-lifecycle` for review.

## Decision

- Choose or create a project on a dedicated start screen before entering the workbench.
- The start screen provides Recent projects, Open, and Create.
- Return to project choice through File in the workbench.
- Before leaving or switching with active jobs, explain that continuing cancels those jobs and let the user continue
  or stay. Staying leaves the jobs running. Accepted by the owner on 2026-10-26.
- Follow the existing application appearance tokens and family alignment (decision 0021).
- Keep the mock server as the project owner, and manual and agent operations on shared service paths
  (decision 0023). Real backend connections remain deferred to RCEnergySimulator (decision 0022).

## Alternatives discussed

| Direction | Tradeoff |
| --- | --- |
| Dedicated start screen, chosen | Makes project choice and the no-project state explicit; requires a session boundary around the workbench. |
| Projects page inside the workbench | Reuses docking, but the shell exposes model controls while no project is loaded. |
| Chooser dialog at launch | Compact, but browsing recent work and cancelling with no project are less clear. |

## Basis and next step

The owner selected the dedicated start screen from these three alternatives. The RC reference already distinguishes
an unloaded project from an open session (`EnergyAtlasWeb/Controllers/ProjectController.cs` at `7464c140`), while this
demo currently restores one saved snapshot directly into the workbench. Exact reference context is in the
[review record](../20261025_review-and-project-lifecycle.md#step-2-evidence-and-pending-directions).

The [lifecycle design](../project-lifecycle-design.md) describes the proposed create/open/save flow, storage,
guards, mock boundary, and acceptance coverage. The owner also accepted confirmation before cancelling jobs on exit.
