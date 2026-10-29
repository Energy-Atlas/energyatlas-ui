# Scenario rules with adoption at aggregation: plan and status

Date: 2026-10-28. Stage 3 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed. It reuses the shared rule engine and editor of stage 2
([archetype assignment rules](assignment-rules.md)).

## The owner's decision

"Scenarios: RC's shape, kept light." In RC a scenario is a query and aggregation over results: each building is
simulated with an alternative version for the scenario, and buildings are sampled deterministically at random when
results are aggregated; for the UI demo this is not too important. Scenario rules follow RC's rule shape (conditions
choose buildings; each rule assigns at most one measure per measure category). Adoption, where the demo models it,
samples deterministically with a fixed seed when results are aggregated, not inside the rules. Stage 2's engine and
editor are reused rather than new machinery.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded in the [next stages discussion](next-stages-discussion.md#scenario-assignment-rules); facts used here:

- `EnergyAtlasWeb/Controllers/ScenarioDesignerController.cs:946-978`: `MeasureRuleDto` shares the archetype rule shape
  (id, type, logic all/any/none, priority, enabled, name, conditions) and assigns at most one measure per category:
  envelope, heating system, cooling system, hot water, plug load, gas equipment, PV.
- `EnergyAtlasLib/Scenarios/Scenario.cs`, `MeasurePackage.cs`: a scenario is prioritized measure packages with
  selections.
- `EnergyAtlasWeb/Controllers/SimulationResultsController.cs:258-278`: a result selection is exactly one of baseline,
  explicit assignments, or `penetration {versionKey, fraction, seed}`; the seed defaults to "0" there and to 42 in
  the result viewer (`wwwroot/js/capResultViewer.js:43`).
- `EnergyAtlasWeb/Services/Cap/CapRealizationSampler.cs`: each eligible building with an upgrade version is selected
  when a hash of `"{seed}|{buildingId}"` (SHA-256, first eight bytes as a fraction of 2^64) is below the fraction;
  every other building keeps its baseline version. No phasing by year.

## What was built

| Part | Where |
| --- | --- |
| Scenario rules, per-category first match, alternative versions, adoption sampling, aggregation, the preview | `src/domain/scenarios/rules.ts` (`prepareScenarioRules`, `assignMeasures`, `alternativeKwh`, `adoptionUnit`, `isAdopted`, `modelScenarioVersions`, `aggregateScenario`, `previewScenarioRules`) on the shared `src/domain/rules/conditions.ts` |
| Scenario modeling items, publication, re-aggregation | `src/domain/scenarios/modeling.ts` (`scenarioItem`, `validateScenarioResults`, `publishScenarioResults`, `reaggregateScenario`) |
| The modeled comparison with its aggregation | `src/domain/scenarios/comparison.ts` (`compareScenarios`) |
| Commands | `scenarioRule.save`, `scenarioRule.move`, `scenarioRule.setEnabled`, `scenarioRule.duplicate`, `scenarioRule.remove`; `scenario.create` (optional first rule), `scenario.update` (adoption and seed re-aggregate), `scenario.setAdoption`; `measure.create`/`measure.update` without "applies to" (`src/domain/commands.ts`); all server and model commands (`src/server/server.ts`) |
| Saved state and migration | `src/server/projectSchema.ts` (rules, seeds, versions), `src/server/migrateScenarios.ts` |
| Page | `src/app/pages/MeasuresPage.tsx`: scenarios, the chosen scenario's rules (shared `RuleList`), the preview, measures, the library, the comparison (`ScenarioComparison.tsx`, now with "Aggregated at") |
| Properties | `src/app/properties/ScenarioRuleProperties.tsx` (shared `ConditionBuilder`), `ScenarioProperties.tsx` (adoption, seed, a first rule when creating), `MeasureProperties.tsx` (the rules that assign the measure) |
| Results | Source line, an Adoption column, and CSV `# aggregated at:` and `adoption` (`src/app/pages/results/`) |
| Dashboard | What-if adoption re-aggregates the published versions (`src/app/pages/dashboardData.ts`) |
| Building properties | Each modeled scenario's measures with their rules, and whether the building adopts (`src/app/panels/inspection.ts`) |
| View operation | `scenarios.setPreviewScenario` (`src/app/view/viewOperations.ts`) |
| Agent | The "Add a scenario rule" session (`scenarioRules`) and the rewritten "Propose a scenario change" (`modelChange`) in `src/app/agent/sessions.ts`; every rule command is an agent tool with the usual approval |

### Model

- `Measure`: name, category (`kind`: envelope, heating, lighting, PV), savings, provenance. It no longer has "applies
  to": rules choose the buildings.
- `ScenarioRule` (`state.scenarioRules`): `scenarioId`, `name` (unique in its scenario), `enabled`, `logic`,
  `conditions` (the building attribute registry `CONDITION_FIELDS`, as archetype rules use), and `measures` (a measure
  id or null per category). `Scenario.ruleIds` orders a scenario's rules, top first.
- `Scenario`: `ruleIds`, `adoptionPercent`, `adoptionSeed` (default 42), `included`.
- `ScenarioVersions` (`state.results.scenarioVersions`): per modeled scenario, the run, the baseline run it modeled
  against with every modeled building's baseline demand (`baseKwh`), each affected building's alternative demand
  (`alternativeKwh`), and the measure each affected building took per category with the rule that set it.
- `state.results.scenarios` stays the aggregated `ResultSet` every result view reads; it is always the aggregation of
  the versions at the scenario's saved adoption and seed.
- Held output of Scenario modeling: `{ kind: 'scenarioVersions', versions }` per scenario.

### Evaluation and aggregation

1. Rules in a scenario's order; disabled rules are skipped; blank and partial conditions and missing measures give
   RC's coded warnings (`prepareRules` with the slot noun "measure").
2. Each category takes the first matching rule that sets it, so one building's envelope and heating measures can come
   from different rules.
3. A building that takes at least one measure is affected. Its alternative version is synthetic: non-PV savings add
   up to at most 60% of its baseline demand, and a PV measure subtracts the roof's estimated yield, at full effect.
4. Adoption is applied only when results are aggregated: an affected building adopts when `adoptionUnit(seed,
   buildingId)` (a 32-bit FNV-1a hash of `"seed|buildingId"` with Murmur3's finalizer, as a fraction of 2^32) is
   below the adoption fraction. Adopting buildings take their alternative, every other building its baseline. Raising
   adoption only adds buildings, and the same seed always picks the same ones.
5. The preview, the job, aggregation, the Dashboard, and the agent use these functions, so the preview's estimate is
   what Scenario modeling and aggregation publish.

## Currentness and provenance

- Rules, measures, names, and inclusion are inputs of Scenario definitions: changing them outdates Scenario
  definitions and Scenario modeling, as before.
- Adoption and seed are not inputs of any stage. Saving them (Properties, the Dashboard's Apply, the agent) re-aggregates
  the published result at once from the same versions; the result keeps its run ID, no stage becomes outdated, and the
  command is undoable. A run that is open when adoption changes publishes at the adoption saved when it publishes.
- The aggregation is named wherever a scenario result is read: "Aggregated at 60% adoption, seed 42: 252 of 464
  affected buildings adopt" in the modeled comparison, the Results Source line and CSV header, the result asset's
  summary, and per building in the Results table and CSV (`adopted`, `not adopted`, `not affected`) and in building
  Properties.

## States

| State | What the user sees |
| --- | --- |
| No scenario | "Create a scenario first; its rules appear here." |
| No rules | A warning in place of the list: the scenario changes no building and its results equal the baseline; New rule works. Scenario definitions confirms with a warning naming such scenarios. |
| Every rule off | A warning under the list. |
| A rule that matches nothing | Its row says "Matches no building"; Select matched buildings explains why it cannot. |
| A rule shadowed by rules above | Its row says it matches n but takes no measure (or fewer); Properties explains. |
| Warnings | RC's coded messages above the list; the rule's Properties repeats its own. |
| Invalid fields | Per field in Properties: name clash in the scenario, a condition's operator or value, a measure of another category, no measure set, a seed that is not a whole number; a kind change of a measure a rule assigns is refused on Category. |
| No baseline yet | The preview counts buildings and says estimates need baseline results; Properties says the same. |
| Held or stale results | "Scenario modeling is running" (info), "Scenario results are held" (warning), or "The preview differs from the published results" when the stage is outdated and buildings would take other measures. |
| Saved before scenario rules | Results stay readable but outdated with an issue; the Dashboard's what-if slider is off with the reason. |
| Request in flight | Rule actions explain "Waiting for the server to answer: the rules are being changed." |
| Server error | Refusals (demo condition Input rejected, a run holding the project) land on the form's field or as a toast. |
| Keyboard | The shared rule list: arrows choose, Space switches a rule, Enter on the handle starts a keyboard move; Move up, Move down, Duplicate, and Remove are toolbar buttons. |

## Real, mocked, deferred

- **Real**: per-category first match with RC's rule shape, logic, operators, and warnings; alternative versions per
  affected building; deterministic seeded adoption at aggregation with re-aggregation and no rerun; the preview with
  an exact estimate; per-field validation; rules, adoption, and seeds as undoable server commands saved with the
  project; migration of older saves; Scenario modeling as an item job with held versions, retry, and input
  signatures; provenance of the aggregation in every result view and export; agent tools and two sessions.
- **Mocked**: savings and PV offsets are synthetic and replace a simulation of each alternative version; the hash is
  not RC's SHA-256, so the same seed picks other buildings than RC would.
- **Deferred**: RC's seven categories (see decisions); RC's custom formula rules and numeric priorities; measure
  packages shared between scenarios; explicit per-building version assignments (RC's `assignments` selection);
  phasing by year; colouring the map by rule or adoption; deleting measures or scenarios.

## Decisions taken for review

1. **Four measure categories, not RC's seven.** The demo keeps envelope, heating, lighting, and PV. RC's heating system
   and PV map one to one, and envelope too; lighting has no RC category (its nearest is plug load). Cooling, hot water,
   plug load, and gas equipment would each need library measures and a demand component in the synthetic savings
   model, and empty categories would show slots no measure can fill. Adding a category later is a change to
   `MEASURE_KINDS`, the library, and the schema.
2. **"Applies to" moved into rules.** A measure-level filter would decide buildings in two places. Migration turns each
   scenario's measure list into one rule per distinct "applies to": "use equals" that use (named "Residential
   buildings" and so on) for specific uses first, then "All buildings" without conditions; a scenario had at most one
   measure per kind, so the rules set disjoint categories and every building keeps the measures it took. Rule ids are
   `scenarioRule:migrated:<scenario>:<use or all>`.
3. **Rules belong to one scenario.** RC's measure packages can be shared; the demo keeps rules per scenario, ordered
   top first (RC's descending priority), with names unique in their scenario.
4. **A scenario may have no rules** (its results equal the baseline, with a warning when definitions are confirmed).
   Creating a scenario can start it with one "All buildings" rule from chosen measures (`scenario.create`'s optional
   `measureIds`), which keeps the old quick path and the fixtures.
5. **RC's per-building hash threshold.** Each affected building adopts independently, so the realized share differs
   from the target by sampling noise: the Complete fixture adopts 159 of 464 buildings at 40% with seed 42, and 252 at
   60%. Exact counts (ranking by hash) were rejected because a building's choice would then depend on which other
   buildings are affected, unlike RC. Every view states the realized count.
6. **Sampling among affected buildings**, as RC samples eligible buildings with an upgrade version.
7. **Seed 42 by default, editable** (a whole number from 0 to 999999), as in RC's result viewer.
8. **Adoption is not a stage input.** Changing it re-aggregates and leaves Scenario modeling's revision unchanged;
   bumping it would outdate Grid definitions, Grid modeling, and the Dashboard stage, which follow it in the workflow
   but do not read scenario values. Adoption commands stay model commands: undoable, saved, and refused while a run
   holds the project.
9. **Versions keep the baseline they were modeled against**, so re-aggregating after the working baseline changes
   (calibration Adopt) never mixes a new baseline with old alternatives, and every saving or reduction of a scenario
   with versions (the modeled comparison, Results rows and CSV, the Dashboard, building Properties, the map's
   reduction metric) compares with that baseline (`scenarioBaseline`); Results, the CSV, and the Dashboard say so when
   the working baseline has moved on. Scenario modeling is outdated then anyway.
10. **Adoption no longer scales savings.** The old formula blended every building's savings by the adoption share and
    scaled PV yield by it; now a building either adopts its full alternative or keeps its baseline. Saves from before
    keep their results readable but outdated (Scenario definitions' edit revision is bumped, with a warning issue), a
    new adoption cannot re-aggregate them and outdates them instead, and open Scenario modeling runs are invalidated.
11. **A measure's category is fixed while a rule assigns it**, since each rule slot holds one category; the refusal
    names the rules.
12. **One scenario's rules at a time on the page**: the chosen rule's scenario, else the scenario chosen with the
    `scenarios.setPreviewScenario` view operation (also set by choosing a scenario row), else the first. It is working
    view state and saved layouts leave it out, like the archetype preview part.
13. **The preview evaluates modeled buildings** (those with baseline results) once a baseline exists, and every
    building before, so its counts match what modeling would affect.
14. **Map colouring by scenario rule or adoption is deferred** for the reason stage 2 gave (a categorical legend for
    any number of rules); "Select matched buildings" and "Select adopting buildings" select them for the Map and
    Table instead.
15. **Agent sessions.** "Propose a scenario change" proposes an adoption change and reports that no stage became
    outdated and the new reduction from the same versions (or, without a scenario, creates one with an "All buildings"
    rule as before). A new session, "Add a scenario rule", adds the library heat pumps, proposes "Older homes: heat
    pumps" (residential and built before 1980, heating only) at the top of an included scenario, previews it with the
    view operation, and models it after a second approval.
16. **Adoption of a scenario without a result changes nothing else.** A scenario left out of the comparison, or not
    modeled yet, has nothing to re-aggregate; saving its adoption or seed outdates no stage. Only a result saved before
    versions is outdated by a new adoption.

## Review

An independent review on 2026-10-28 found nothing serious. Fixed:

1. **Adoption of a scenario without versions outdated the others** through `scenario.update` (left out of the
   comparison, for example). It now outdates only when a result saved before versions exists, as
   `scenario.setAdoption` did (decision 16); test in `src/domain/scenarios/scenarios.test.ts`.
2. **Scenario savings compared with the current baseline.** After a calibration Adopt, buildings that did not adopt
   showed a saving, the CSV named the wrong baseline run, and the Dashboard mixed baselines. `scenarioBaseline` and
   `baselineChangeNote` in `src/domain/scenarios/rules.ts` now give the baseline the versions were modeled against to
   the comparison, Results (a "Compared with" line), the CSV (`# compared to baseline run:` and `# baseline:`), the
   Dashboard (a note on the stat), building Properties, and the map's reduction metric (decision 9); tests in
   `scenarios.test.ts`, `resultsView.test.ts`, and `dashboardData.test.ts` (helper `src/testing/movedBaseline.ts`).
3. **The agent said no stage became outdated for a result saved before versions.** "Propose a scenario change" now
   says such a result is outdated instead, and reports "No stage became outdated" only when the scenario had versions
   and no stage became newly outdated; `src/app/agent/sessions.test.ts`.
4. **Saving a rule sent its switch from the last render**, which could undo a switch still in flight. Scenario rule
   Properties leaves `enabled` out for an existing rule, so the server keeps the switch; the archetype rule form had the
   same pattern and was changed too. Test: saving without `enabled` keeps a rule off.
5. **The run summary's "largest reduction at the saved adoption"** went stale after re-aggregation. It now names the
   scenario, adoption, and seed it was computed at, "as published".
6. **The PV warning counted rules of scenarios left out of the comparison.** `usesPvWithoutYield` now reads included
   scenarios only; test.

Not changed: charts the agent adds from specifications (`src/app/view/chartSpec.ts`) plot the working baseline beside
scenario series without a computed reduction, so they show no mixed saving; they still draw the current baseline line
after a calibration Adopt, while Scenario modeling is outdated.

## Review fixes (2026-10-29)

1. **The modeled comparison after a calibration Adopt** showed the new baseline beside reductions computed against
   the baseline each scenario was modeled with. Rows now carry `baselineNote` (`baselineChangeNote`, as Results, the
   CSV, and the Dashboard use), and the comparison shows it in a warning above the table
   (`src/domain/scenarios/comparison.ts`, `src/app/pages/ScenarioComparison.tsx`; test in `scenarios.test.ts`).
2. **A switched-off scenario rule** read "Matches no building" in Properties and 0 in the preview; the preview row
   says "(switched off)" and Select matched buildings explains that the rule is off.
3. **The shadowed note** appeared only when every category was taken by earlier rules; it now names each category the
   rules above take, with how many buildings.
4. **Scenario Properties** gave the estimate to one decimal (96,204.5 MWh) while the comparison rounds to whole MWh;
   both now read whole MWh through `formatEnergy`.

Verification (2026-10-29, three agents sharing the checkout): `npm run typecheck`, `npm run lint`, and `npm run
format:check` clean; `npx vitest run` 586 passed; the archetypes, assignment rules, schema matching, scenarios,
scenario rules, calibration, floors and zones, and per-building zoning specs passed against the review server on port
5180 (`tmp/playwright.5180.config.ts`), after load-related timeouts and trace-file errors passed on a rerun with a
longer timeout.

## Known issues and limits

- The realized adoption share is noisy at district size (decision 5).
- Removing a rule leaves published versions naming it until Scenario modeling runs again.
- A rule row's "takes measures of n" is the largest category count; the preview table shows each category.
- Keyboard moves in the rule list follow React Aria's drop-gap model, as stage 2 noted.
- Dashboard what-if previews stay unlogged drafts until Apply.

## Verification

On the stage's final commit (2026-10-28, Edge, 4 workers, development specs on port 5180 with the ignored
`tmp/playwright.5180.config.ts`): `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `npm test` 434
passed (419 after stage 2: `src/domain/scenarios/scenarios.test.ts` rewritten for rules, per-category first match,
sampling determinism and fraction accuracy over 20,000 ids, aggregation, and re-aggregation without a run; migration
in `src/server/projectSchema.test.ts`; CSV aggregation in `resultsView.test.ts`; two agent sessions in
`scriptedAgent.test.ts`); `npm run test:e2e` 117 passed (adds `e2e/scenario-rules.spec.ts` with 3 tests;
`dashboard`, `pages`, and `scenarios` specs updated); `npm run test:e2e:preview` 3 passed; `git diff --check` clean.
The reorder test failed once in a run of the new spec alone (not reproduced in nine further runs, three of them with
3 workers and six with 4); it now has a 60 s timeout. Screenshots of the Measures and scenarios page with a scenario
rule in Properties at 1280 px (`tmp/scenario-rules-1280.png`) and in six appearances and at 900 px
(`tmp/creator-*.png`) were reviewed.

After the review fixes (2026-10-28, same setup): typecheck, lint, and format clean; `npm test` 442 passed (adds 8:
four in `scenarios.test.ts`, one each in `resultsView.test.ts` and `dashboardData.test.ts`, and two in the new
`src/app/agent/sessions.test.ts`); `npm run test:e2e` 117 passed; `npm run test:e2e:preview` 3 passed;
`git diff --check` clean.
