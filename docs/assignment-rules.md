# Archetype assignment rules with RC's four parts: plan and status

Date: 2026-10-28. Stage 2 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed. Stage 3 reuses the shared rule engine and editor described
here for scenario rules: see [scenario rules](scenario-rules.md).

## The owner's decision

Archetype assignment rules assign RC's four parts separately: construction, systems, space loads, and external loads.
Rules are tried by priority, and each part takes the first enabled matching rule that sets it, so one building's parts
can come from different rules. A manual assignment on a building still wins. The demo's archetype model changes to
match. The rule editor is shared with stage 3.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded in the [next stages discussion](next-stages-discussion.md#archetype-assignment-rules); facts used here:

- `EnergyAtlasWeb/Controllers/TemplateAssignmentController.cs:2143-2169`: a rule has a type (builder or custom), logic
  (all, any, none), priority, enabled, name, conditions {field, source, operator, value}, and one GUID each for
  construction, systems, space loads, and external loads.
- `EnergyAtlasLib/Templates/TemplateAssignment.cs:151-192`: rules sorted by descending priority; for each part, the
  first rule whose selection matches and that sets the part.
- `EnergyAtlasLib/Scenarios/GISSelection.cs:14-22, 120-150`: operators larger, smaller, equals, contains, does not
  contain; values compare as upper-case text, larger and smaller parse both sides as numbers and are strict, and a
  missing or null property never matches (does not contain included).
- `TemplateAssignmentController.cs:1654-1760`: disabled rules and rules that set no part are skipped; an empty
  condition list matches every building; a rule whose conditions are all blank (no field) is skipped with
  `blank_conditions_skipped`; blank conditions beside real ones are dropped with `partial_conditions_dropped`; custom
  rules with a formula are skipped (`custom_rule_skipped`); "at least" becomes larger than the value minus one.
- `TemplateAssignmentController.cs:1444-1538`: default rules per building type and vintage at priority 1 and a
  priority-0 fallback without conditions; the page shows "Unassigned (n)" (`wwwroot/js/templateAssignment.js:1648-1655`).
- No per-building editor in RC; completing keeps a part already on a building (`TemplateAssignmentController.cs:923-949`).

## What was built

| Part | Where |
| --- | --- |
| Shared rule evaluation (fields, operators, logic, coded warnings, per-slot first match) | `src/domain/rules/conditions.ts` |
| Parts, the synthetic demand formula, effective parts, archetype labels | `src/domain/archetypes/parts.ts` |
| Default rules, ordered rules, the preview | `src/domain/archetypes/assignment.ts` (`defaultRuleDrafts`, `previewAssignment`, `assignBuilding`) |
| Parts library and archetypes as bundles | `src/domain/archetypes/library.ts` (`PART_LIBRARY`, `ARCHETYPE_LIBRARY`, `FALLBACK_ARCHETYPE_ID`) |
| Commands | `part.save`, `archetype.save` (parts), `archetype.addFromLibrary` (with parts), `rule.save`, `rule.move`, `rule.setEnabled`, `rule.duplicate`, `rule.remove`, `rule.generateDefaults`; `edits.propose`/`edits.apply` with part fields (`src/domain/commands.ts`); all server and model commands (`src/server/server.ts`) |
| Assignment job | `stageItem` (held per-building parts), `validateAssignment`, `publishAssignment` (`src/domain/simulation.ts`) |
| Baseline from parts | `setUpBaseline` uses `buildingIntensity` (`src/domain/simulation.ts`) |
| Saved state and migration | `src/server/projectSchema.ts` (parts, rules, building parts), `src/server/migrateArchetypes.ts` |
| Shared components | `RuleList` (on `ReorderableList` and `Toolbar`), `ConditionBuilder`, `ruleList.module.css` in `src/app/components/`; both in the gallery at `/?gallery` |
| Page | `src/app/pages/archetypes/ArchetypesPage.tsx`: rules, preview, archetypes, parts, library, schedules |
| Properties | `src/app/properties/RuleProperties.tsx`, `PartProperties.tsx`, `ArchetypeProperties.tsx` (parts) |
| Table | part columns, the Archetype label, and Assigned by in `src/app/pages/TablePage.tsx` |
| Building properties | parts with provenance, linked parts and rules (`src/app/panels/inspection.ts`) |
| View operation | `archetypes.setPreviewPart` (`src/app/view/viewOperations.ts`) |
| Agent | the "Add an assignment rule" session (`assignmentRules` in `src/app/agent/sessions.ts`); every rule and part command is an agent tool through `src/app/agent/tools.ts` with the usual approval |

### Model

- `ArchetypePart`: one of `construction` (wall, roof, and window U-values, window ratio, infiltration), `systems` (fuel,
  heating efficiency or COP, cooling COP, hot water need), `spaceLoads` (lighting and equipment W/m², m² per person,
  occupancy schedule), `externalLoads` (exterior lighting and process loads per m²). `state.parts`.
- `Archetype`: a named bundle of one part of each kind for a use and an optional year range; default rules come from
  archetypes. It no longer has an intensity or a schedule (the schedule belongs to space loads).
- `AssignmentRule`: `name`, `enabled`, `logic`, `conditions` ({field or null, operator, value}), `parts` (a part id or
  null per kind), `origin` (`default` or `project`). `state.rules` and `state.ruleIds` (top first).
- `Building.parts`: the published rule result per kind, `{partId, ruleId, ruleName}`. A manual part is an override
  `{entityId}:{kind}` in `state.overrides`; `effectiveParts` lays it over the published part.
- Held output of Archetype modeling: `{ kind: 'assignment', parts }` per building.

### Evaluation

1. Rules in list order; disabled rules are skipped.
2. Blank conditions (no field) are dropped; a rule with only blank conditions is skipped (`blank_conditions_skipped`);
   a rule with some is applied without them (`partial_conditions_dropped`). A part the rule sets that no longer
   exists is left to later rules (`missing_target_skipped`). No enabled rule gives `no_enabled_rules`.
3. A rule matches when all, any, or none of its complete conditions match; no conditions match every building.
4. Each part takes the first matching rule that sets it.
5. Manual parts win when parts are read; they are counted as manual in the preview, not as taken by a rule.

The preview reports, per rule, the buildings it matches and the parts it takes, unassigned and manual parts per kind,
the buildings with all four parts, how many buildings would change from the published parts, and the warnings. The job,
the page, and the agent's view operation use the same function, so the preview and a run never disagree.

### Synthetic demand from parts

`partsIntensity` (kWh/m² a year, delivered), with fixed demo geometry (0.6 m² of facade and 0.25 m² of roof per m² of
floor, 3.2 m storeys) and a synthetic year (62 kKh of heating degree hours, 70 kWh/m² of solar gain on glazing):

- heat loss H = facade × ((1 − window ratio) × wall U + window ratio × window U) + roof × roof U + 0.34 × ACH × 3.2;
- gains = (lighting + equipment + 80 W per person) × the schedule's full-load hours (4,380 without a schedule);
- heating = max(0, H × 62 − 0.3 × gains) / heating efficiency; cooling = (0.35 × gains + solar) / COP;
- hot water / heating efficiency, plus lighting, equipment, exterior lighting, and process loads.

Library parts were tuned so the library archetypes land near their old single intensities (old → new kWh/m²:
residential before 1980 165 → 180, residential 1980 on 115 → 123, office 210 → 192, retail 240 → 214, school 140 →
132, mixed 185 → 199, office before 1950 255 → 280). Schedules now change demand.

## States

| State | What the user sees |
| --- | --- |
| No rules, never run | An info alert: the first run generates default rules (and adds the default library archetypes); Generate default rules and New rule work now. |
| No rules after a run, or every rule off | A warning alert; Run assignment explains why it cannot run (`definitionsBlocker`). |
| A rule that matches nothing | Its row says "Matches no building"; its Properties offers Select matched buildings as unavailable with the reason. |
| A rule shadowed by rules above | Its row says it matches n but takes fewer; Properties explains. |
| Warnings | A warning alert above the list with RC's coded messages; the rule's Properties repeats its own. |
| Invalid rule fields | Per field in Properties: name clash, a condition's operator for its field type, a non-number value, an unknown part of the wrong kind, no part set. |
| Preview stale while held | "Archetype modeling is running" (info) or "Assignments are held" (warning) while a run group is open; "The preview differs from the published parts" when the stage is outdated and buildings would change. |
| Request in flight | Rule actions explain "Waiting for the server to answer: the rules are being changed." |
| Server error | Refusals (demo condition Input rejected, a run holding the project) land on the form's field or as a toast. |
| Keyboard | The rule list is a grid list: arrows choose, Space switches a rule, Enter on the handle starts a keyboard move; Move up, Move down, Duplicate, and Remove are toolbar buttons. |

## Real, mocked, deferred

- **Real**: rule evaluation with RC's order, logic, operators, and warnings; per-part first match; manual parts that
  win and can follow the rules again; the preview; per-field validation; rules, parts, and archetypes as undoable
  server commands saved with the project; migration of older saves; assignment as an item job with held per-part
  outputs, retry, and input signatures (rules and parts are inputs through Archetype modeling's edit revision);
  agent tools and a scripted session.
- **Mocked**: the parts library values and the demand formula from parts (synthetic, deterministic); the condition
  fields are the demo's building attributes, not RC's GIS property names.
- **Deferred**: RC's custom (formula) rules and the `custom_rule_skipped` warning; numeric priorities (the demo uses list
  order); importing RC's library or EnergyPlus objects; a part library browser (library parts arrive with library
  archetypes); deleting parts or archetypes; colouring the map by rule or part (see decisions below); per-zone parts
  (stage 6 keeps zones display only).

## Decisions taken for review

1. **Archetypes stay, as named bundles of four parts.** Default rules are generated from them; the archetype's
   intensity and schedule are gone (the schedule moved to space loads). Saving or adding an archetype does not change
   rules or outdate assignment; "Generate default rules" picks it up, as RC generates defaults on request.
2. **Order, not numbers.** Rules are ordered top first (RC: descending priority). New rules go to the top; Duplicate
   places the copy below the original; Generate default rules replaces generated rules below the project's own.
3. **Generated rules.** One per project archetype: use equals the archetype's use, plus "year built larger than
   from − 1" and "smaller than to + 1" (RC's at-least conversion), narrowest year range first within a use, then a
   fallback without conditions that sets the Mixed use library archetype's parts (copied into the project if missing).
   Editing a generated rule makes it the project's own (`origin: project`), so regenerating keeps it, and the default
   of the same name is left out (the summary names the rules kept) so rule names stay unique.
4. **First run.** As before, a first Archetype modeling run adds the default library archetypes the project lacks;
   with no rules it also generates the default rules. Mixed-use buildings now get the fallback's parts instead of none,
   so the Complete fixture models all 464 buildings (446 before); its baseline is 105,155 MWh (105,173 MWh before).
5. **Missing values never match** any operator, does not contain included (RC). A residential building without a
   year now falls to the fallback rather than to the narrowest open range, as the earlier demo matcher did.
6. **Typed operators.** Numbers: larger, smaller, equals (numeric); use: equals, does not contain; name: contains, does
   not contain, equals. A condition with a field must have a valid value to be saved; only field-less conditions are
   kept as blank (RC's blank and partial warnings).
7. **A rule must set at least one part** (RC skips such rules silently; the demo refuses them on save).
8. **All four parts are needed for demand.** Buildings missing a part are excluded from the baseline with a warning,
   as buildings without an archetype were.
9. **Manual parts.** Set per part in the Table (the existing pending-edit path); "By rules" removes the manual part and
   the published rule part applies again at once. Old manual archetypes migrate to four manual parts; an old manual
   "none" is dropped (the rules decide).
10. **Migration.** Library archetypes take the library entry's parts; project archetypes take the parts of the library
    archetype of the same use with the nearest old intensity, plus a space-loads copy when their schedule differs.
    Buildings keep their old archetype's parts, attributed to a migrated rule `rule:migrated:<archetype id>`; default
    rules are generated where Archetype modeling had run. Open assignment runs saved before parts are invalidated.
    A library id whose saved intensity, schedule, or provenance differs from the old library entry is an edited copy
    and migrates like a project archetype, keeping its schedule. Where Archetype modeling had run, its output
    revision is bumped, so the baseline and everything after it show as outdated, with a warning issue on Baseline
    model setup explaining that results came from the old single intensities.
11. **Map colouring by rule or part is deferred.** The layer stack's `colorBy` is a sequential ramp over numeric
    metrics; colouring by rule would need a categorical palette and legend for any number of rules, beyond the three
    validated categorical slots. The rule's Properties offers "Select matched buildings" instead, which the map shows.
12. **Preview part is view state, not saved in layouts.** `archetypes.previewPart` is a working choice like the chosen
    job; saved layouts leave it out.
13. **The Table draws all its columns** (`suppressColumnVirtualisation`) so the four part columns are reachable without
    scrolling first; the table has 16 columns.
14. **Parts in use outdate assignment when saved**; a new or unused part, or an unused schedule, does not.

## Review

An independent review on 2026-10-28 found nothing high-severity. Fixed:

1. **Edited library archetypes in old saves** lost their saved schedule (they took the library branch). They now
   migrate like project archetypes, with a space-loads copy for their schedule; `legacySave` includes one.
2. **Generate default rules after editing a generated rule** added a second rule of the same name. Defaults whose
   name is taken are now left out and named in the summary; the rule editor finds a created rule by its new id, not
   its name.
3. **`rule.save` re-enabled a rule** when `enabled` was left out, and ignored `position` on an update. Left out, a
   changed rule keeps its switch; a position moves it. The agent session switches an existing rule on explicitly and
   says so, and "move it to the top" is now true.
4. **Migrated projects showed old results as current.** Migration bumps Archetype modeling's output revision and adds
   a warning issue (see decision 10).
5. **The rule engine was tied to building fields and parts.** `conditions.ts` and `ConditionBuilder` now take a field
   registry for every lookup (`FieldRegistry`, `Condition<Field>`, `ConditionSubject<Field>`), and `prepareRules`
   takes the slot noun for its warnings ("part", "measure"); an unknown field is refused on save and never matches.
   A test runs the engine over a measure-like registry for stage 3.
6. **The Manual parts and Unassigned preview rows** were selectable but did nothing. Choosing one selects those
   buildings for the parts shown (or says why there are none), and a note under the table explains it.
7. **Condition errors.** The logic error is now shown under its field; the value field is a React Aria `TextField`
   with `isInvalid`. Not changed: the field, operator, enumerated value, and logic choices stay native selects with
   `aria-invalid`, as `SelectProperty` in `src/app/properties/PropertyForm.tsx` does for every select in Properties;
   React Aria `Select` would bring a popover list unlike every other select in the panel.
8. **Tests** for each: migration of an edited library archetype and the outdated downstream stages
   (`src/server/projectSchema.test.ts`), regenerating after editing a generated rule and the fallback and saving a
   rule without `enabled` or with a position (`src/domain/archetypes/archetypes.test.ts`), another field registry
   (`src/domain/rules/conditions.test.ts`), and Generate default rules and the preview rows through the UI
   (`e2e/assignment-rules.spec.ts`).

## Review fixes (2026-10-29)

1. **Regenerating put catch-alls first.** `generateDefaultRules` kept the project's own rules above the fresh
   defaults, so an edited or duplicated fallback (no conditions) took every building. After regenerating, every rule
   whose conditions are all blank goes below every rule with conditions, in its existing order (`isCatchAll` in
   `src/domain/rules/conditions.ts`).
2. **Switching or moving a generated rule** left it generated, so regenerating dropped the switch or the order.
   `rule.setEnabled` and `rule.move` now make it the project's own, as `rule.save` does.
3. **`rule.save` without a change** (agent or API) is refused with "No unsaved edits …", with no field path, and
   outdates nothing.
4. **The Synthetic library showed part ids** in a new project, whose parts are not yet copied in; part names fall back
   to the library's.
5. **Controls the server refuses while a job is queued or running** (rules, parts, archetypes, schedules, and adding a
   library archetype) are unavailable up front with the reason, as on Schema matching (`definitionLockReason` in
   `src/domain/archetypes/assignment.ts`, used by the page and the four Properties forms).
6. **A switched-off rule in the preview** read as matching 0; its row now says "(switched off)" and leaves the counts
   empty. Selecting one floor or zone now names it in the summary ("Selected floor 2 of Building 439.").
7. **Tests**: order after regenerating with an edited and a duplicated fallback, switch and move kept, and the refused
   no-op save (`src/domain/archetypes/archetypes.test.ts`); the selection summary (`src/domain/zoning/zoning.test.ts`,
   `e2e/floors-zones.spec.ts`, `e2e/per-building-zoning.spec.ts`).

Verification (2026-10-29, three agents sharing the checkout): `npm run typecheck`, `npm run lint`, and `npm run
format:check` clean; `npx vitest run` 586 passed; the archetypes, assignment rules, schema matching, scenarios,
scenario rules, calibration, floors and zones, and per-building zoning specs passed against the review server on port
5180 (`tmp/playwright.5180.config.ts`), after load-related timeouts and trace-file errors passed on a rerun with a
longer timeout.

## Known issues and limits

- Rule names are unique per project; parts and archetypes too. Removing a rule leaves published parts that name it
  until Archetype modeling runs again (Properties shows the rule name recorded at publication).
- The preview counts per rule are per building, not per building-part pair, in the list row ("takes parts of n" is the
  largest count over the parts it sets); the preview table shows each part.
- Keyboard moves in the rule list follow React Aria's drop-gap model, as the map's layer stack does: the first arrow
  press can move a row past its neighbour.

## Verification

On the stage's final commit, after the review fixes (2026-10-28, Edge, 4 workers, development specs on port 5180 with the ignored
`tmp/playwright.5180.config.ts`): `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `npm test` 419
passed (395 before this stage); `npm run test:e2e` 112 passed (106 before: adds `e2e/assignment-rules.spec.ts` with 6
tests; `e2e/archetypes.spec.ts` rewritten for parts and default rules); `npm run test:e2e:preview` 3 passed;
the gallery's six-appearance axe test now has a 90 s timeout (it took 22 s alone and timed out at 30 s under 4
workers once the rule components joined the gallery); `project-lifecycle.spec.ts` "start and creation render in every
appearance" timed out under 4 workers in two full runs and passed alone (1.5 min of its 120 s), unrelated to this stage;
`git diff --check` clean. Screenshots of the Archetypes page in six appearances at 1280 px and at 900 px were reviewed
from ignored `tmp/archetypes-*.png`.
