# Data intake (roadmap slice 4): plan and status

Date: 2026-10-26. Branch: `claude/slice-4-data-intake`, from local `master` at `805c23d` (Jobs merged).
Authority: [rollout plan](jobs-rollout-plan.md) slice 4 and D9, [decision 0026](decisions/0026-autonomous-roadmap-through-results.md).
Read-only RC observations and the one difference from the demo rule are in
[RC observations for slices 4–8](roadmap-rc-observations.md#data-intake-slice-4).

## Task plan

1. Domain: synthetic dataset fixtures (`src/domain/intake/datasets.ts`); target fields, suggested mapping, schema-wide
   mapping issues, per-row validation, stable-ID matching, and a pure fusion preview (`src/domain/intake/fusion.ts`).
2. Jobs: `intake.applyDataset` queues a fusion run group (kind `fusion`, shown under Schema matching) whose items are
   the valid records' source keys; the signature adds the dataset and mapping (`options`) and the valid record set.
   `task.processItems` holds record plans; `task.complete` validates and publishes them once.
3. Model: `state.sourceRecords`, `sourceRecordIds`, and `datasets` keep provenance; published fusion bumps Location
   setup's revision when buildings are added and Geospatial data enriching's when attributes change.
4. Reruns: footprint capture rebuilds added buildings; enrichment applies synthetic values, then fused records,
   then manual overrides.
5. UI and parity: Data intake page (`page.intake`), view operations `intake.chooseDataset` and `intake.mapField`,
   agent approval for `intake.applyDataset`, Workflow entry on Schema matching, Inspection provenance.
6. Persistence: defaults for the new fields; cross-checks for source records and fusion groups.

## Status

Real: mapping review, validation, ambiguity rejection, stable-ID fusion with manual override precedence, retained
unmatched buildings, no implicit deletion, held records with failed-record retry and publication-only retry, changed
mapping as an input change, save/reopen, and agent parity through view operations and the server command. Mocked:
datasets are synthetic code fixtures (60 assessor rows, 10 infill records, 12 rows without identifiers); faults come
from demo conditions. Deferred: native file pickers, server uploads, real format parsing, geometric matching (RC's
approach), unit conversion, and deletion of buildings.

Behavior notes:

- Missing Source ID, a model field mapped twice, or only an identifier mapped blocks the whole dataset, shown on the
  field or as an alert; Apply explains why it is unavailable.
- Rejected rows are listed with their reasons and are never applied; duplicated source IDs reject every copy.
- A manual floor override wins over an imported value; the preview lists it as a kept override.
- Added buildings get the next free `BX####` IDs at preparation; the same IDs are planned again at processing and
  publication because inputs are locked by the signature and the edit lock.

Review: an independent review found no held-output, signature, ID-determinism, migration, or circular-import defect
and eight lower-severity items, all addressed: added buildings use their own `BX####` ID namespace so a regenerated
footprint extract cannot take their IDs; Apply warns when it discards a partly failed fusion's held results;
footprint capture rebuilds added buildings like captured ones (attributes return with enrichment); Inspection no
longer calls imported values synthetic; the enrichment warning counts only records that supply values; Apply names
missing prerequisites before record problems; fusion messages use the job label; the options check is documented.

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 265 passed (31 files); `npm run test:e2e` 78 passed; `npm run
test:e2e:preview` 3 passed. Intake screenshots in light and dark engineering at 1280 px and at 900 px were reviewed
from ignored `tmp/intake-*.png`.
