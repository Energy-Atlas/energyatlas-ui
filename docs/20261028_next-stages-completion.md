# Next stages completion report (decision 0032)

Date: 2026-10-28. Branch `claude/next-stages`, from local `master` at `27e8a1f`. Not merged and not pushed. Local
`master` stays where it was until the owner reviews.

The owner asked for the six stages of [decision 0032](decisions/0032-next-stages-directions.md) to be built
unsupervised, then reported back with decisions, issues, and review items. Each stage was built, reviewed
independently against `AGENTS.md` and the decision, and its review findings fixed before the next stage started.

## Stages and commits

| Stage | Status document | Build commits | Review fixes |
| --- | --- | --- | --- |
| 1. Saved layouts, project and personal | [saved-layouts.md](saved-layouts.md) | `93888a1`, `55a36b3` | `4a7f921` (8 findings) |
| 2. Archetype assignment rules with RC's four parts | [assignment-rules.md](assignment-rules.md) | `c7f444a`, `f3c5039`, `cbefb95` | `35780da` (8) |
| 3. Scenario rules, adoption at aggregation | [scenario-rules.md](scenario-rules.md) | `d5fefe0`, `750638e`, `a0fd031` | `e0e8cdd` (6) |
| 4. Schema matching as a mapping review | [schema-matching.md](schema-matching.md) | `f0dc725`, `1bcc8b4`, `deea796` | `a5ab1fb` (8) |
| 5. Viewer page and handover package | [viewer-handover.md](viewer-handover.md) | `a2a789a`, `b5ceec5`, `039db27` | `1f0a6f2` (8 + 1 latent) |
| 6. Floors and zones | [floors-zones.md](floors-zones.md) | `96604ae`, `a69d7cd`, `6c5f9e4`, `64e9577` | `ae7c4af` (11) |

Earlier commits on the branch: `d61d4ea`, `b8b1f81`, `61e7f83`, `f2ba992` (discussion and decision 0032) and
`06ae856` (the lifecycle appearance test split per width, which had timed out under 4 workers).

All 29 commits carry the configured identity, Cheng Xuan Li, and no attribution trailers.

## Owner's review (2026-10-28)

The owner reviewed the saved layouts, the page name, and floors and zones, and will review the Scenarios,
Archetypes, Schema matching, Calibration, and viewer panel content afterwards.

- [Decision 0033](decisions/0033-project-layouts-panel-and-scenarios-page.md): layouts are kept with the project only
  (no personal layouts), in a Layouts panel whose table holds each layout's details and actions; a layout is saved
  from the panel by name or from View > Layouts > Save layout… through a name prompt. Measures and scenarios is
  renamed Scenarios. Items 3 below and the saved-layouts scope choices are replaced.
- Floors and zones in 3D on the map, with one case each of real zoning, each floor as a zone, and perimeter and
  core: answered in the [discussion](floors-zones-3d-discussion.md) and accepted as
  [decision 0034](decisions/0034-per-building-zoning-and-3d-zones.md); built in `0b8e061`
  ([plan and status](per-building-zoning.md)). A building can override the project's zoning in its Properties;
  B0439 (drawn zones, a synthetic hand-authored plan), B0427 (each floor a zone), and B0426 (perimeter and core) are
  the fixture's three cases, so the Partway, Failed stage, and Complete fixtures now publish 510 zones instead of
  464 (results unchanged); Show zones in 3D, exploded floors (a building layer setting), and WebGL zone edges are on
  the Map. Its 15 decisions taken for review are in the status document. Verification: 555 unit, 133 dev e2e, and 4
  preview tests passed.

## Review items for the owner

Every stage document has a "Decisions taken for review" section, and those sections are the complete list. These
items change behaviour you already know or read your words in a particular way:

1. **Handover packages the saved copy only** (viewer decision 2, resolved by the owner on 2026-10-28). Unsaved
   model, view, and layout changes and drafts stay out, the dialog warns about them, and a project never saved cannot
   be handed over. Built after the report in a follow-up commit on the same branch.
2. **The viewer leaves out Roadmap** because every stage card has run controls; stage states appear in About this
   handover. **Demo conditions stay** on the viewer so its loading and error states can be shown, which differs
   from direction B. **The Dashboard's what-if adoption preview stays** without Apply (viewer decisions 7–9).
3. *(Replaced by decision 0033: no personal layouts.)* **Viewer personal layouts are kept per package**, so a new handover of the same project starts without them
   (viewer decision 11).
4. **Archetypes became bundles of RC's four parts**, and a fallback rule gives mixed-use buildings parts. The Complete
   fixture now models 464 buildings instead of 446; its baseline is 105,155 MWh instead of 105,173 MWh (assignment
   decisions 1–4).
5. **The demo keeps four measure categories**, not RC's seven, and "applies to" moved into scenario rules. Adoption
   now picks whole buildings with RC's per-building hash (seed 42), so the realized share is noisy: 159 of 464 at
   40% (scenario decisions 1, 2, 5).
6. **Schema matching's compulsory fields are Use, Year built, and Floors**, not RC's SelectForSim, YearBuilt, and
   BldgHeight. Data intake suggestions now wait for review, so a user presses Accept all once per dataset (schema
   decisions 1, 6).
7. **Zoning defaults to one zone per building** (RC's default), with a 4.5 m perimeter depth. At that depth only 79
   of 464 Back Bay buildings get perimeter and core zones; most row houses are too narrow and fall back to one zone
   per floor. Zone counts now follow the zoning, so the fixtures show 1 zone per building instead of the old
   floor-area estimate; no result reads zone counts (zoning decisions 1, 2, 5, 7).
8. **The perimeter is split along corner bisectors**, not RC's Voronoi split. Short edges merge into the zone before
   them (zoning decision 6).
9. **Map colouring by rule, part, or adoption is deferred**, because it needs a categorical legend for any number of
   rules; "Select matched buildings" stands in (assignment decision 11, scenario decision 14).

## Known issues and limits

- The viewer's agent tells model changes from view changes with a keyword heuristic; "what would change if…" can get
  the view-only answer.
- Handover packages are about the size of a saved project (about 550 KB for the Complete fixture) and share browser
  storage with saved projects. A refused save names the space packages take, and both the modeller and the viewer
  can remove them.
- The viewer's server session is read-only because the viewer page asks for it. There is no access control.
- Rule lists move rows by keyboard with React Aria's drop-gap model, so the first arrow press can pass a neighbour.
- "Changed since applied" for layouts compares the whole arrangement, so a splitter drag counts as a change.
- After a floor-count edit, floors and zones keep the last run's storeys until Geospatial preprocessing runs again.
- Custom schema fields show only in Properties.
- Three browser tests sat near their 30 s limit under 4 workers and were given 60 s: stage 2's and stage 3's rule
  reorder tests and the map-table "2D and 3D" test. Each passed repeatedly on its own.

## Deferred

These were left out on purpose:
- result versions, which the owner will discuss later;
- the 10,000-building benchmark;
- zone editing and per-zone archetype parts;
- RC's zoning sampling resolution and courtyards;
- unit conversion and transforms in schema matching;
- the map camera in layouts;
- RC's remaining measure categories.

## Verification (2026-10-28, on `ae7c4af`)

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | clean |
| `npm test` | 523 passed in 50 files |
| `npm run test:e2e` (all specs, 4 workers) | 128 passed |
| `npm run test:e2e:preview` | 4 passed, including the viewer under the Pages base path |
| `git diff --check` | clean |

After the saved-copy handover change: the same checks passed again, with 526 unit tests (3 new), 128 development browser tests, and 4 production-preview tests.

Port 5173 on this machine is held by the owner's RC build, so the development browser specs ran through an ignored
throwaway Playwright config on port 5180 (`tmp/playwright.5180.config.ts`). The specs and the committed config are
unchanged.

## Next steps

1. The owner reviews the items above and the stage documents.
2. On approval, fast-forward local `master` to `claude/next-stages`, the same way earlier work was merged. Merge only
   on the owner's request, and do not push.
3. Discuss result versions, the remaining item of the owner's proposal.
