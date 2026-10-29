# Review of `claude/next-stages` before the owner's review (2026-10-29)

The owner asked, on 2026-10-29, for hollow floors with nested selection
([decision 0035](decisions/0035-hollow-floors-and-nested-selection.md)) to be built together with every change on the
branch that the owner had not yet reviewed or approved, and for another agent to review them and collect the results
for the owner. This record is that collection. Nothing here is merged into `master` or pushed.

## Scope

Everything on `claude/next-stages` since local `master` (`27e8a1f`): the six next stages of
[decision 0032](decisions/0032-next-stages-directions.md), layouts kept with the project and the Scenarios rename
([0033](decisions/0033-project-layouts-panel-and-scenarios-page.md)), per-building zoning and 3D zones
([0034](decisions/0034-per-building-zoning-and-3d-zones.md)), and hollow floors with nested selection (0035). The
Calibration panel is already in `master`, but the owner had not reviewed its content, so it was reviewed too.

## Method

Four reviewers worked independently and read only: each read the code at `9daf66d`, ran the unit tests of its area,
and drove the running app at 1440 × 900 on the review server (port 5180) with its own Playwright scripts. Their
screenshots are in the ignored `tmp/review/agent-review/` (`archetypes/`, `scenarios/`, `viewer/`, `zones/`).

| Area | Reviewed |
| --- | --- |
| Layouts, Scenarios, Calibration | Layouts panel (0033), scenario rules and the Scenarios page (0032 stage 3), Calibration content |
| Archetypes, schema matching | Assignment rules with RC's four parts (stage 2), schema matching and Data intake (stage 4) |
| Viewer | Handover packages and the viewer page (stage 5), the viewer's agent and Layouts panel, zoning in the viewer |
| Floors and zones | Stage 6, decision 0034 (after its earlier review fixes in `bd573e4`), decision 0035 |

The viewer reviewer found no path by which the viewer can change the model: it tried the server's refusal, the
agent's tool filter, undo, drafts, shortcuts, the palette, the Table's editors, URL parameters, and forged packages.

Three agents then fixed the confirmed defects, each in its own files, and the full check list ran once on the
combined result.

## Fixed

### Archetypes and schema matching ([assignment-rules.md](assignment-rules.md), [schema-matching.md](schema-matching.md))

- **High.** Generate default rules placed an edited or duplicated fallback (a rule with no conditions) above every
  default, so it took all 464 buildings. Catch-all rules now stay below every rule with conditions.
- Switching off or moving a generated rule now makes it the project's own, so regenerating keeps the choice.
- Saving an unchanged rule (agent or API) is refused with "No unsaved edits" and outdates nothing.
- A no-op `schema.mapValue` no longer writes an empty value map into the project.
- A new project's Synthetic library shows part names, not ids.
- Rule, part, archetype, and schedule controls and forms are unavailable while a job is queued or running, with the
  reason, as Schema matching already did.
- A single selected floor or zone is named in the selection message ("Selected floor 2 of Building 439.").

### Scenarios and Calibration ([scenario-rules.md](scenario-rules.md), [calibration.md](calibration.md))

- After a calibration Adopt, the Scenarios comparison shows the note that savings are against the baseline the
  scenario was modeled with, so its numbers no longer contradict each other.
- A switched-off rule reads "(switched off)" instead of matching 0 buildings, in previews and in Properties.
- The "taken by rules above" note lists each category taken, not only when every category is.
- Scenario Properties rounds energy as the comparison does.
- Calibration names the variant choice and the variant whose monthly residuals are shown; the unit field is marked
  invalid when it contradicts the series.

### Layouts ([saved-layouts.md](saved-layouts.md))

- A layout chosen in the Assets tree is no longer marked for good: applying, saving, updating, deleting, opening
  another project, or the viewer's reset clears it.
- Keep it, Delete layout, and Rename return keyboard focus to the row's menu (or the table); Escape cancels Rename and
  the delete confirmation.
- Updated and Created sort by time.
- The delete confirmation stacks its message above its buttons in the narrow panel.
- A malformed stored `layouts` value is kept aside as unreadable and saved back, not erased.

### Viewer and handover ([viewer-handover.md](viewer-handover.md))

- File > Hand over… became unavailable after one hand over until something else re-rendered; it now updates, and a
  failed hand over no longer leaves it busy.
- The viewer's agent and the package removal confirmation no longer mention personal layouts (removed by 0033); the
  status document now describes the current code.
- An unreadable catalog shows a proper empty state; waiting buttons explain why.
- The viewer's agent refuses a message that mixes a model change with a session keyword ("Reset the baseline
  results"); its zones answer names the three per-building overrides; counts are singular where needed.
- The viewer's Layouts panel uses viewer wording, wraps its empty text, and drops the Default column.
- An asset with no page (for example Attribute mapping rules) now says so and shows its Properties, in the viewer and
  the modeller, instead of doing nothing.

### Floors, zones, and nested selection ([per-building-zoning.md](per-building-zoning.md))

- **High.** Shift-click never reached the app: MapLibre's box zoom swallowed it, so "Shift adds at the same level"
  (and the older Shift-adds-buildings on `master`) did nothing. Box zoom is off; Shift-drag no longer zooms to a box.
- A selected whole-building zone (most fixture buildings) is drawn in the selection colour on every storey.
- Hover labels update after a click or key and name the item under the pointer.
- Keys and clicks that cannot act say why in the status bar and Messages: Page Up on the top floor, Page Down on the
  bottom, either key on a building, a second click on a whole-building zone.
- A hit on the selected floor wins only over nearer hits on the same building.
- In the dark appearances, the other zones on a selected zone's floor use a new `hollow.muted` token, raising the
  contrast of the selected zone from about 1.6:1 to 3.3:1.

## Known issues left

- In the dark appearances, hollow floors below a selected floor read as a dark box against the dark ground; more
  opacity started to veil the selected floor from above.
- In Monochrome and Lieflat the selection colour is about as light as the muted grey (about 1.5:1).
- From straight above, floors over the selected floor cover it and cannot be clicked there.
- Zone edges and hollow floors are checked by screenshot only.
- Scenario controls are not locked up front while a job runs; the server refuses the commands and says why.
- At 1440 px with both side panels open, some actions sit in columns that scroll into view: the measure library's Add,
  Calibration's Adopt and Revert, the comparison's Currentness, and the Layouts table's details.
- Drawn-zone validation samples edges and adds areas (from the 0034 review).

## Questions for the owner

Collected from the four reviews, most consequential first.

1. **Calibration.** Should Run fit be refused when the unit contradicts the meter series, instead of publishing a
   variant that can never be adopted? Should Adopt ask for confirmation when a variant misses the ASHRAE thresholds?
2. **Comparison after Adopt.** Show savings against the baseline the scenario was modeled with, with the note (as
   built), or mark the reduction outdated until Scenario modeling reruns?
3. **Wide tables in side panels.** Should key actions come first in their tables (as Layouts does), or should
   panels show the details of the chosen row instead of extra columns?
4. **Mixed use.** The fallback copies the Mixed use archetype's parts but not the archetype, so 18 buildings read
   "Mixed parts". Should it copy the archetype so they read "Mixed use"?
5. **Regenerating rules.** Should a regenerate that changes nothing still outdate Archetype modeling and later stages?
6. **Nested selection.** With several buildings selected, should a click on one first narrow the selection to it
   rather than go to its floor? Should Page Down (or Enter) on a selected building go to its ground floor?
7. **Viewer.** Should the viewer keep its own view changes (map layers, table settings) between visits, or say they
   reset? Should it offer to remove stored packages it cannot read, or prune the catalog (storage fills after about
   8 Complete packages)? Should its toolbar Reset layout go to the handed-over layout, leaving one reset instead of
   three?
8. **Box zoom.** Is losing Shift-drag box zoom acceptable now that Shift is part of selection?

## Commits

- `8f2f5fd` fix(rules): archetypes, schema matching, scenarios, and calibration
- `a99fcd3` fix(map): nested selection and hollow floors
- `0651265` fix(layouts, viewer): the Layouts panel and the viewer

The checks ran once on the three sets of fixes together, before they were split into these commits; the commits in
between were not checked on their own.

## Verification (2026-10-29, on the combined fixes)

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check` | clean |
| `npm test` | 586 passed in 53 files |
| Dev e2e on port 5180, 4 workers | 134 of 140 passed; 6 timed out while the machine was under load (about 85% CPU) and passed when rerun: `assignment-rules.spec.ts:260` and `context.spec.ts:43` alone, then `appearance.spec.ts:109`, `assignment-rules.spec.ts:69`, `gallery.spec.ts:33`, and the three widths of `project-lifecycle.spec.ts:259` with 2 workers |
| `npm run test:e2e:preview` | 4 passed |

One earlier dev e2e run was invalid: its Playwright output went to `tmp/` inside the checkout, which the dev server
watches, so trace files reloaded the page and the server crashed. Playwright output for runs against the dev server
belongs outside the checkout.
