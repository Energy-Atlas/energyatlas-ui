# Schema matching as a mapping review: plan and status

Date: 2026-10-28. Stage 4 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed. It replaces the simulated Schema matching run and gives
[Data intake](data-intake.md) the same mapping component.

## The owner's decision

"Schema matching as a real mapping review, sharing the mapping component with Data intake." From the
[discussion](next-stages-discussion.md) (2a): target fields in RC's tiers (compulsory, computed, optional, custom), one
source per target, suggested matches to review, an example value and a value distribution per source field,
unrecognised values of enumerated fields with counts, and rule sets that can be saved and loaded. Unit conversion and
transforms are deferred, as in RC.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded in the [next stages discussion](next-stages-discussion.md#schema-matching) and the
[RC observations](roadmap-rc-observations.md); facts used here:

- `EnergyAtlasWeb/wwwroot/schemaMatching.html`, `js/schemaMatching.js`: a source attribute table (name, type, example)
  beside rule tabs Compulsory, Overrides (computed), Optional in six groups, and Custom; "Fuzzy Match All"; a map and
  charts (histogram or donut) for the chosen attribute; load and save of rule sets; save to the DataHub.
- `js/schemaMatching.js:1006-1015, 1581`: a rule is valid when enabled, with a source and a target, and no other
  enabled rule maps the same target; Next is blocked with "n compulsory rule(s) invalid or missing".
- `Controllers/SchemaMatchingController.cs:30-81, 666-812`: targets carry required, default, unit, type, tier, optional
  group, and description; the compulsory targets are SelectForSim, YearBuilt, and BldgHeight (metres); computed targets
  include area, perimeter, facade areas, and floors; transforms are skipped with `transform_not_supported`; units are
  reported, not converted; enumerated targets warn `enum_values_unrecognised` with counts, examples, and the allowed
  names. Rule sets are `{version, mappings[{target, source, tier, transform}]}` in
  `UserData/Rulesets/SchemaMatchingRules.json`. Completing returns the applied count and warnings; mapping copies
  values and keeps the original attributes.

## What was built

| Part | Where |
| --- | --- |
| Shared mapping rules: tiers, target specs, source profiles and distributions, the suggester (RC's Fuzzy Match All), typed value reading, enumerated values with aliases and value maps, per-target checks, compulsory issues and the run blocker | `src/domain/mapping/mapping.ts` |
| Schema targets in RC's tiers, custom targets, the built-in rule set | `src/domain/schema/registry.ts` |
| Source attributes: synthetic OpenStreetMap-like tags per captured footprint | `src/domain/schema/footprintTags.ts` |
| The review, the published mapping, attribute layers, and the stage run | `src/domain/schema/matching.ts` (`sourceCollection`, `reviewSchema`, `schemaRunBlocker`, `mappedValuesFor`, `computedOverrides`, `applyAttributeLayers`, `runSchemaMatching`) |
| Rule sets in RC's shape, file parsing, load checks | `src/domain/schema/ruleSets.ts` |
| Commands | `schema.mapTarget`, `schema.reviewSuggestions`, `schema.suggest`, `schema.mapValue`, `schema.addCustomTarget`, `schema.removeCustomTarget`, `schema.saveRuleSet`, `schema.loadRuleSet`, `schema.deleteRuleSet` (`src/domain/commands.ts`); all server and model commands (`src/server/server.ts`) |
| Saved state and migration | `state.schemaMatching` in `src/server/projectSchema.ts`; `src/server/migrateSchemaMatching.ts` |
| Shared component | `src/app/components/MappingReview.tsx` (+ `mappingReview.module.css`); gallery `src/app/gallery/MappingSpecimen.tsx` |
| Pages | `src/app/pages/schema/SchemaMatchingPage.tsx` (page id `schema`, from the Workflow panel's Mapping button and the command palette); `src/app/pages/intake/IntakePage.tsx` now uses `MappingReview` |
| Properties | "Attribute sources" (which layer each value comes from) and "Captured tags" for a building (`src/app/panels/inspection.ts`, `PropertiesPanel.tsx`) |
| View operations | `schema.inspectSource`; Data intake's `intake.chooseDataset` (now leaves suggestions to review), `intake.mapTarget` (replaces `intake.mapField`), `intake.reviewSuggestions`, `intake.inspectField` (`src/app/view/viewOperations.ts`) |
| Agent | The "Review the schema mapping" session (`schemaMatching`) in `src/app/agent/sessions.ts`; every schema command is an agent tool and waits for approval |

### Targets

| Tier | Target | Type | Without a value |
| --- | --- | --- | --- |
| Compulsory | Use | One of residential, office, retail, school, mixed; RES, OFF, RET, SCH, MIX recognised | keeps the enriched use |
| Compulsory | Year built | Year, 1600 to 2030 | keeps the enriched year |
| Compulsory | Floors | Whole number, 1 to 60 | keeps the enriched floors |
| Computed (overrides) | Height | Number, 1 to 400 m | preprocessing computes 3.2 m per floor |
| Computed (overrides) | Floor area | Number, 1 to 1,000,000 m² | preprocessing computes footprint area times floors |
| Optional, Identity | Name | Text, up to 80 characters | keeps "Building n" |
| Custom | user named | Text, up to 200 characters | none; kept with the building, read by nothing |

Data intake's targets on the same component: Source ID compulsory; Name, Use, Year built, Floors (group Attributes)
and Footprint (group Geometry) optional.

### Source attributes

Each captured footprint has seven tags: `osm_id`, `building`, `building:levels`, `start_date`, `height`, `name`, and
`roof:shape`. They are synthetic and deterministic per footprint, never real OSM values, and they agree with the
synthetic enrichment where both have a value: `building` writes the enriched use as `apartments`, `house`,
`commercial`, `university`, or the generic `yes` part of the time; about 15% lack `building:levels`; about 28% lack a
plain year (22% have no date and 6% read `c. 1925`); about 40% lack `height` and 5% give it in feet (`48 ft`); about 12% have a `name`;
`roof:shape` has no model target. Buildings a dataset added have no tags.

### Applying the mapping and precedence

The Schema matching run reads every building's tags through the accepted mapping and value maps, publishes the
mapping (`schemaMatching.published`: run, operation, mapping, value maps, custom targets, applied counts, coded
warnings), and applies the attribute layers in order:

1. synthetic enrichment (use, year, floors) and the captured name;
2. the published mapping (name, use, year, floors);
3. fused source records from Data intake;
4. manual overrides (floors).

Geospatial data enriching applies the same layers, so a rerun of it keeps mapped values. Mapped heights and floor
areas are used by Geospatial preprocessing instead of the computed values. Tags are read when needed and never
changed, so the original attributes are kept. Mapping edits bump Schema matching's edit revision: the stage and every
later stage become outdated until it runs again. Fusion run groups stay under Schema matching and keep working.

## States

| State | What the user sees |
| --- | --- |
| No source attributes | Before Location setup: "No source attributes yet" with Run Location setup and Show Workflow. |
| Not applied yet | "The mapping is not applied yet": buildings keep the enrichment until the stage runs. |
| Suggestions pending | Suggested rows are tinted, with Accept and Reject; an info alert counts them; Accept all and Reject all in the toolbar. A suggestion is not used until accepted. |
| Compulsory missing | The row is tinted with its issue; "Schema matching cannot run" names the fields; Run explains why and the stage refuses it too (`stageSubmitBlocker`). |
| Warnings | Per target: values taken, missing, not valid with examples, unrecognised values with counts and a "Read as" choice, units not converted. After a run: RC's coded warnings (`enum_values_unrecognised`, `values_invalid`, `values_missing`, `unit_not_converted`). |
| Outdated | "The mapping differs from the applied one" when the stage is outdated. |
| Running or a job active | The mapping stays readable; changes explain that a job is queued or running. |
| Request in flight | "Waiting for the server to answer: the mapping is being changed." |
| Server error | Refusals (demo condition Input rejected, a run holding the project) land on the target's row or the custom form; other refusals above the targets. |
| Rule set skipped entries | The selected rule set lists what loading would skip; a loaded file's result lists what was skipped. |
| Keyboard | Native selects (arrows, Home, type-ahead), the source list (arrows, type-ahead), the toolbar (arrows). |

## Real, mocked, deferred

- **Real**: tiers, one source per target, suggestions with review, typed value checks, enumerated values with counts
  and value maps, compulsory blocking in the page, the stage, and the agent; the mapping applied as a stage job with
  applied counts and coded warnings; precedence with fused records and manual overrides; computed overrides used by
  preprocessing; custom targets; rule sets saved with the project, loaded with checks, downloaded and read as files;
  provenance in Properties; save and reopen with migration; agent tools and a session; Data intake on the same
  component and suggester.
- **Mocked**: the source attributes are synthetic tags generated per footprint; the suggester is name matching
  (synonyms, normalised names, edit distance), not RC's fuzzy matcher.
- **Deferred**: unit conversion and transforms (as in RC); the map of the chosen attribute and donut charts (a bar
  table instead); RC's six optional groups (the demo has one model field there); a per-user rule set file; saving to a
  DataHub; value maps and rule sets for Data intake; mapping fused dataset fields in Schema matching.

## Decisions taken for review

1. **Compulsory Use, Year built, and Floors instead of RC's SelectForSim, YearBuilt, and BldgHeight.** The demo
   simulates every building (no selection flag) and derives height from floors, while the archetype rules need Use;
   Height and Floor area are the computed tier, as RC computes floors and areas.
2. **Source attributes are synthetic OSM-like footprint tags**, deterministic per footprint and in agreement with the
   enrichment where present, so the built-in mapping reproduces the existing synthetic values and every fixture
   result. Fused dataset fields are not offered as Schema matching sources: Data intake maps them with the same
   component and they win over mapped values.
3. **A built-in rule set ("OSM building tags (built in)") maps the compulsory fields in new projects**, with value maps
   for `apartments`, `house` (residential), `commercial` (office), and `university` (school), as RC loads its saved
   rule set; Name and Height start as suggestions to review. A run of the whole workflow therefore needs no review,
   while the review states show from the start. `yes` stays unrecognised on purpose.
4. **Missing, invalid, or unrecognised values keep the previous layer's value** (the enrichment, the computed value, or
   the captured name) and are reported, rather than blanking a field; RC's default values play the same role.
5. **Value maps are light and real**: an unrecognised enumerated value can be read as an allowed one in Schema
   matching (`schema.mapValue`); in Data intake unrecognised values are listed and their records rejected as before.
6. **Rule sets are kept with the project and moved as files.** RC keeps one rule set file per user; project rule sets
   are saved, handed over, and reachable by the agent, and Download plus Open rule set file carry one to another
   project. Saving under an existing name replaces that rule set; the built-in one cannot be replaced or deleted.
   Loading replaces the mapping and drops pending suggestions, applying what exists and listing what it skips.
7. **One source per target is structural**: each target row has one source. A source may feed several targets in
   Schema matching (RC allows it); in Data intake a dataset field feeds one target, so mapping it elsewhere moves it.
8. **Suggestions in Data intake wait for review too** (Accept all once), so both pages behave alike; nothing is applied
   either way until Apply.
9. **Suggestions are model state** in Schema matching (saved, shared with the agent) but do not outdate the stage;
   only accepted mappings, value maps, and custom targets do.
10. **Height in feet is not valid** (units are reported and never converted); those buildings keep the computed
    height.
11. **Migration**: a save from before the mapping gets the built-in mapping, unpublished; where Schema matching had run,
    its edit revision is bumped (outdated) with an info issue saying to run it again.
12. **Mapping edits are refused while any job is queued or running**, like other model commands; the page says so
    before a change is attempted.
13. **The distribution is a bar table** (value, count, share) for categories, integers, and number bins, with a
    Missing row; a map of the chosen attribute is deferred.

## Review

An independent review on 2026-10-28 found no serious defect and eight lower-severity items, all fixed:

1. **Mapping edits discarded a partly failed fusion's held results.** Fusion run groups belong to Schema matching, so
   their input signature held that stage's edit revision, which every mapping edit now bumps; Retry failed records was
   refused. A fusion's signature now leaves the stage's edit revision out (`captureSignature` in
   `src/domain/jobs/runGroups.ts`): its inputs are its dataset, mapping, and records.
2. **Properties could credit a computed height to Schema matching** after a run that preprocessing had not followed
   (the tags differ from the computed height by under 0.8 m). `preprocessingUsedPublished` now checks that
   preprocessing's last run consumed the Schema matching revision that published the mapping.
3. **Accept all in Data intake could undo a field mapped by hand**: a suggestion whose field already feeds another
   model field is dropped and named in the summary.
4. **Loading a rule set skipped the custom name checks**; `customNameIssue` in `src/domain/schema/registry.ts` is now
   the one check for adding and loading (pattern, and no clash ignoring case with model fields or other custom
   targets).
5. **Loading the mapping already in place outdated every later stage**; `schema.loadRuleSet` now compares
   (`sameMappingConfig`) and bumps only on a change.
6. **Per-field errors**: the rule set name is a React Aria `TextField` with `isInvalid` and the refusal under it; the
   custom target's source select has `aria-invalid` and `aria-describedby`.
7. **The agent session understated "yes" as mixed use**: it now says how many buildings change use (the retail ones
   tagged `yes`) and that their archetypes and results change.
8. **Doc mismatches** in the year share and in [Data intake](data-intake.md)'s task plan.

Added tests (`src/domain/schema/schema.test.ts`): a fusion retry after a mapping edit, height provenance before and
after preprocessing, Accept all keeping a hand-mapped field, custom names on load, a reload that outdates nothing, and
the server refusing a mapping change while a job is queued or running.

## Known issues and limits

- The page shows one attribute's distribution at a time; numbers are binned in eight equal bins.
- Custom target values are visible in a building's Properties only; no Table column or map layer reads them.
- `schemaMatching.published` stores the mapping, not the values; values are read from the tags when layers are
  applied, which is valid because the tags are deterministic per footprint.
- Removing a custom target leaves its values in Properties until Schema matching runs again.

## Verification

On the stage's final commit (2026-10-28, Edge, 4 workers, development specs on port 5180 with the ignored
`tmp/playwright.5180.config.ts`): `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `npm test` 465
passed (442 before; adds 22 in `src/domain/schema/schema.test.ts`: registry, profiles and distributions, value reading,
the suggester, tag agreement with the enrichment, the empty and blocked reviews, unrecognised values and value maps,
refused sources and targets, suggestion review, the built-in mapping reproducing the fixtures, outdated propagation and
a run with tags kept, computed heights in preprocessing, precedence with fused records and manual overrides, custom
targets, rule sets saved, loaded, checked, and read from files, migration and saved-state round trip, approvals and the
view operation, and Data intake's suggestions, mapping, and checks; plus one agent session test in
`scriptedAgent.test.ts`); `npm run test:e2e` 121 passed (adds `e2e/schema-matching.spec.ts` with 4 tests; the
`intake` and `robustness` specs accept suggestions first); `npm run test:e2e:preview` 3 passed; `git diff --check`
clean. Screenshots of the Schema matching page at 1400 px (light), 1280 px (Dark engineering), and 900 px, and of the
Data intake page, were reviewed from ignored `tmp/schema-*.png` and `tmp/intake-new-*.png`; the first review moved each
target's values into a row under it so the "Read as" column fits a 740 px pane.

After the review fixes (2026-10-28, same setup): typecheck, lint, and format clean; `npm test` 471 passed (adds 6 in
`src/domain/schema/schema.test.ts`); `npm run test:e2e` 121 passed in a full run; `npm run test:e2e:preview` 3
passed; `git diff --check` clean. In an earlier full run, `e2e/assignment-rules.spec.ts` "reorders rules by keyboard"
(stage 2) timed out at 30 s under four workers and passed alone in two of three runs; it now has a 60 s timeout, and
the spec passed three times in a row before the clean full run.
