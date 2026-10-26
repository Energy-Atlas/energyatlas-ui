# Results (roadmap slice 8): plan and status

Date: 2026-10-26. Branch: `claude/slice-8-results`, from local `master` at `ad0574a` (Calibration merged).
Authority: [rollout plan](jobs-rollout-plan.md) slice 8, [decision 0026](decisions/0026-autonomous-roadmap-through-results.md).
Read-only RC facts: [RC observations](roadmap-rc-observations.md#results-slice-8).

## Task plan

1. View model (`src/app/pages/results/resultsView.ts`): published result sets only (the working baseline, noting an
   adopted calibrated variant, and each modeled scenario) with stage, run, publication time, and currentness from
   derived stage states; per-building rows with use, archetype, floor area, demand, EUI, and saving against the
   baseline; monthly series for the district or a building's share; a typical weekday by hour from the building's
   archetype schedule.
2. Export: `resultCsv` writes identifying header lines (result, run, publishing stage and time, currentness, project,
   export time), units in column names, one row per building, and a total row equal to the summary; text that a
   spreadsheet would evaluate is neutralized. Exports are logged as `results.export` operations.
3. UI and parity: Results page (`page.results`) with result choice, provenance, Export CSV, chart with a data table,
   and a paged building table with Show and Select; view operations `results.select`, `results.showBuilding`, and
   `results.setResolution`; Workflow entry on Dashboard / visualization.

## Status

Real: result listing, provenance and currentness, drill-down, series derivation, the browser CSV download, and
logging. Mocked: every value comes from the synthetic model; hourly values are a typical weekday derived from a
schedule, not simulated hours. Deferred: a native report generator, exports of held or partial results, daily
resolution, and export of reference data.

Behavior notes:

- Held outputs, unadopted calibrated variants, and scenarios left out of the comparison set never appear.
- Outdated results can still be read and exported; the page and the CSV header say they are outdated.
- The agent can choose results and buildings through view operations; downloading a file stays a manual action.

Review: an independent review found no path for held or unpublished output into the page or the export, and raised
provenance, view-operation, and export points, all addressed: publication time now comes from the succeeded job with
the result's run ID and currentness distinguishes outdated, a newer failed run, and a run in progress; an adopted
baseline names the calibration fit; drill-down and resolution operations validate against the shown result and
choosing another result clears a building it lacks; text cells that a spreadsheet would evaluate are neutralized and
header values are kept to one line; scenario exports name the baseline run they compare against and that building
attributes are current values; calibrated baselines total the sum of their buildings; downloads revoke their object
URL after starting; chart titles use building names; paging resets on a new result; an all-zero schedule falls back
to a flat profile.

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 299 passed (34 files); `npm run test:e2e` 87 passed; `npm run
test:e2e:preview` 3 passed. Results screenshots in light and dark engineering at 1280 px were reviewed from ignored
`tmp/results-*.png`; the downloaded CSV was read back in the browser test.
