# Calibration (roadmap slice 7): plan and status

Date: 2026-10-26. Branch: `claude/slice-7-calibration`, from local `master` at `8d5c3ea` (Scenarios merged).
Authority: [rollout plan](jobs-rollout-plan.md) slice 7 and D10, [decision 0026](decisions/0026-autonomous-roadmap-through-results.md).
Read-only RC facts: [RC observations](roadmap-rc-observations.md#calibration-slice-7). RC's calibration page is a
placeholder and RC computes no CV(RMSE) or NMBE, so the metrics and thresholds below are the demo's own.

## Task plan

1. Meter series: synthetic monthly district totals (`METER_SERIES` in `src/domain/calibration/calibration.ts`): a kWh
   year, the same kind of year in MWh, and a partial year with a missing month.
2. Validation: twelve months of one calendar year, every value present and non-negative; the unit is chosen
   explicitly (kWh or MWh) and a mismatch with the stated unit is warned about.
3. Fit job: `calibration.fit` queues one whole-run job (run group kind `calibration`, shown under Baseline model
   setup). The fit is one coupled least-squares factor over the twelve months; it is not split into items.
4. Variant: completion publishes a separate calibrated variant with the factor, CV(RMSE) and NMBE before and after,
   and monthly residuals. The working baseline is unchanged.
5. Adoption (D10): `calibration.adopt` makes a variant the working baseline, keeps the modeled baseline, and bumps
   Baseline model setup's revision so dependent results become outdated; `calibration.revert` restores the modeled
   baseline. A variant fitted to an older modeled baseline cannot be adopted; a baseline rerun clears adoption.
6. UI: Calibration page (`page.calibration`) with series choice, unit, preview, fit, variants with Adopt/Revert, and
   residuals; Workflow entry on Baseline model setup.

## Status

Real: validation, unit conversion, fit jobs with retry, variant publication without touching the working baseline,
explicit adoption and revert with staleness, outdated-variant refusal, and persistence. Mocked: meter data is
synthetic and the fit is a single scaling factor, a stand-in for real calibration. Deferred: live meters, per-building
or per-fuel calibration, credentials, and automatic baseline replacement.

Behavior notes:

- Thresholds follow ASHRAE Guideline 14 for monthly data (CV(RMSE) at most 15%, NMBE within ±5%); with one factor
  and a seasonal mismatch, a fit may honestly miss them.
- Fits and data fusions are side runs: they appear under their stage in Jobs but do not make the stage or its
  dependents look running or outdated; a fit cannot be queued while a baseline run or another fit is active.
- A variant is identified with the modeled baseline it was fitted to by that baseline's run ID, so reverting and
  adopting again work; a baseline rerun outdates earlier variants.
- A fit whose unit contradicts the export's stated unit is published with that note and cannot be adopted.

Review: an independent review found two real problems and four smaller ones, all fixed. Revert bumped the stage
revision that variants were compared against, so earlier variants could not be adopted again; variants now record the
modeled baseline's run ID. A running fit made Baseline look running and its dependents outdated; tasks now carry
`sideRun`, which `hasActiveTask` ignores. Also: wrong-unit fits cannot be adopted; Adopt and Revert explain the run
lock; the schema requires the kept modeled baseline exactly while a variant is adopted, and saved fusion jobs from
before side runs are migrated to side runs;
before-fit metrics use all months as degrees of freedom and an all-zero series is rejected.

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 291 passed; `npm run test:e2e` 85 passed; `npm run test:e2e:preview`
3 passed. Calibration screenshots in light and dark engineering at 1280 px and at 900 px were reviewed from ignored
`tmp/calibration-*.png`.
