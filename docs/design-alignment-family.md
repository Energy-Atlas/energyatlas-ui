# Family alignment

Date: 2026-10-20

Aligns the build with the EnergyAtlas family, the visual language of the dev-skills and BEMGen documentation sites, under [decision 0020](decisions/0020-energyatlas-family-ui-alignment.md). In this variant the family look wins every conflict with the [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md); the decision record lists the conflicts and the guideline amendments they would need. The earlier pass against the guidelines alone is in [design alignment](design-alignment.md).

## Observed facts

From the source at `563b152`, with `python style_audit.py src --tokens src/app/appearance/appearances.ts src/index.css --exclude "src/spikes/*" "*.test.ts" "*.test.tsx"` (90 files) and by reading the files named.

| Measure | Before | Source |
| --- | --- | --- |
| Colour literals outside the token files | 3: a swatch outline `rgb(127 127 127 / 40%)`, a second copy of the popover shadow, and the dialog scrim `rgb(0 0 0 / 35%)` | `src/app/pages/pages.module.css:109`, `src/app/panels/reasoning.module.css:437`, `src/app/shell/shell.module.css:342` |
| Colour literals in the token files | 288 | `appearances.ts`, `index.css` |
| Font sizes | the three tokens (45 uses), plus `TEXT_SIZE`, `12`, and `13` in canvas and grid code | `src/app/pages/dashboardCharts.ts`, `src/app/grid/agGrid.ts` |
| Font families | `var(--font-sans)` and `var(--font-mono)` only; mono is Cascadia Code | `src/index.css` |
| Border declarations | 33 in 12 stylesheets (FlexLayout and AG Grid draw their own) | shell 9, reasoning 5, forms 4, roadmap 4, the rest at most 2 |
| Radii | 10 distinct: `--radius-sm` 4 px (18 uses), `--radius-md` 6 px (10), `--radius-pill` (8), `50%` (6), `2px`, `1px`, split-button corners | `src/app/global.css` |
| Shadows | 10 distinct, one of them the popover shadow token | |
| Transitions | 4; no `prefers-reduced-motion` query | |
| Font host or CDN URLs | 0 | |
| Control borders | inputs and buttons use `--color-border`, 1.2 to 1.5:1 on their surfaces in every appearance (below the 3:1 for control edges) | `src/app/components/*.module.css` |
| First frame | no inline script; `index.css` holds Light tokens only, so a stored dark appearance paints light first | `index.html`, `src/index.css` |
| Panel headers | `h2` at the title size with the right-aligned Simulated note; no rule | `src/app/panels/panels.module.css` |
| Active tabs | FlexLayout: selected tab on the content surface; Table sub-tabs: accent underline | `src/app/layout/flexlayout-theme.css`, `src/app/pages/table.module.css` |
| Dashboard tiles | aligned values on spacing, no outlines | `src/app/pages/dashboard.module.css` |

Baseline screenshots of every appearance at 1280x800 and 1920x1080 are kept outside the repository.

## Translation

The reference column is the family as built on the dev-skills site; the decision column applies decision 0020 (family wins).

| Reference element | App equivalent | Decision |
| --- | --- | --- |
| Near-black (dark) or white (light) page, off-white text, grey metadata | Panes, ribbon, chart surface | Panes on the base (`#000000`, `#ffffff`); surface-1 for strips and overlays |
| Content column framed by vertical rules | Pane boundaries, splitters, side border bars | Rules in `border` |
| Horizontal rules between sections | Tab strips, ribbon, status bar, panel header strips, panel sections, dashboard rows | Ruled |
| `+` registration marks | Shell corners | Dropped |
| Low header with a bottom rule; mono nav labels; vertical dividers | Ribbon with menus, search, quick buttons | Ruled; menu names as mono labels; dividers kept |
| Active nav item: inverted block in an accent outline | Selected tab in FlexLayout centre and border strips, Table sub-tabs, open ribbon menu | Inverted block; outline separated by a gap (contrast) |
| Primary action: inverted block | Run ▾, agent Send, primary form buttons | Inverted block, accent on hover |
| Section strip with a right-aligned note | Panel and page headers with Simulated notes and counts | Header strips, mono uppercase muted labels |
| Hero headline with a serif phrase | Welcome or empty state | Dropped (no welcome screen) |
| Feature row of cells sharing borders | Dashboard stat tiles, chart cards | Shared-border grid, closed on four sides |
| Square outlined buttons with mono labels | Toolbar and panel buttons | Mono uppercase in toolbars and panels; sentence case in forms and dialogs |
| Data-sheet tables | AG Grid, plain tables | Mono uppercase headers, row and column rules, accent-tint hover |
| Admonitions with a coloured edge and a mono title | Notices, stale and warning banners | Ruled cells with a tone edge |
| Code blocks in the mono | Tool call details, operation log, keyboard hints, identifiers | Geist Mono |
| Muted footer meta line | Status bar | Mono at the label size |
| Square corners, no shadows | Everything | Radius 0; one overlay shadow |
| 150 ms colour transitions | Hover and focus | Kept; none under reduced motion |

Only the app has: selection (one `selectedBg` and the accent outline), focus inside composite widgets (2 px accent ring, inset in tab strips, grid cells, and tree rows), disabled with a reason (dashed edge, muted label, a reason in the title or menu description), invalid fields (danger edge and message), splitters (a rule at rest, the accent on hover and drag), scrollbars (muted thumb, now square), and canvases (chart and map colours from the resolved tokens).

## Contrast evidence

`scripts/contrast.py check --suggest` of the `app-ui-alignment` skill, run on the proposed Light and Dark tokens and on the curated appearances' control borders before implementation. The [decision record](decisions/0020-energyatlas-family-ui-alignment.md#6-colour-roles-and-contrast) has the values used.

- 78 of 84 pairs passed with the family values as given. The failures: the accent outline on the inverted active-tab fill (2.08:1 Dark, 2.50:1 Light; 1.00:1 in Technical monochrome), the Light success text on a 10 % tint (4.38:1), and the Light warning text on a 10 % tint (4.29:1).
- Fixes: the outline sits on the surface behind a 2 px gap, not on the fill; Light tints at 8 %; Light warning text `#946300`.
- The curated appearances had no interactive border: controls used `border` at 1.19 to 1.49:1. Each now has `borderInteractive` at 3:1 or more on its ground, surface, and raised surface.

## Deviations

- **Pane surface.** The skill's family table maps surface-1 (`#1a1a1a`, `#f8fafc`) to the pane surface. The reference sets content on its base, so the panes use the base and surface-1 goes to strips, the status bar, and overlays.
- **Grid headers wrap.** Mono uppercase headers are wider than Geist, and at the app's fixed column widths "Year built", "Floor area (m²)", and "PV yield (kWh/yr)" were cut off. The grids now share `workbenchColumnDefaults` (`wrapHeaderText`, `autoHeaderHeight`) in `src/app/grid/agGrid.ts`, so long headers take a second line; the column widths are unchanged, and the header tracking is 0.04em rather than 0.08em.
- **Agent suggestions stay sentence case.** They are prompts the agent reads, not commands, so they keep the sans although they are buttons in a panel.
- **Status bar.** Its items are mono uppercase at the label size; the last-operation notice at the right stays a sentence in the sans, because it is a message.
- **First frame.** `index.html` gained an inline script that applies the stored appearance's scheme before the bundle runs, and `src/index.css` the family dark tokens for it and for `prefers-color-scheme: dark`. Before this pass a stored dark appearance painted light first.
- **The dialog scrim** `rgb(0 0 0 / 35%)` in `src/app/shell/shell.module.css` stays a literal: a translucent black, the same in every appearance.
- **Labels in Geist (2026-10-20).** The owner replaced the mono uppercase labels with Geist as written ([decision 0020, section 12](decisions/0020-energyatlas-family-ui-alignment.md#12-label-style-2026-10-20)); every label rule now reads the label tokens. Grid headers keep `wrapHeaderText`, now rarely needed.
- **Titles keep their earlier design (2026-10-20).** The first build turned page and panel titles into raised header strips with muted labels; the owner asked for the earlier titles back. Titles inside a panel's content have no backdrop and use the title style; strips remain only on docked tab strips and side handles.
- **Tab hover (2026-10-20).** FlexLayout's hover rule set an unselected tab's label to the selected-tab colour, the strip's own colour after the inversion. Unselected tabs and side handles now show the text colour, the pane surface, and an interactive edge on hover.
- **Control grammar (2026-10-20).** Inputs, selects, and secondary buttons shared one look. Fields are now wells with a heavier bottom edge, selects add a chevron cell, buttons are raised blocks, and quiet ribbon buttons show an edge and a fill on hover, whose old raised-surface hover was one step from the ribbon ([decision 0020, section 13](decisions/0020-energyatlas-family-ui-alignment.md#13-control-grammar-2026-10-20)).
- **Basemap roads.** The basemap takes its road colour from the pane surface and its land from the background; with both at the family base, roads matched the land. Where the two are equal, roads now take the raised surface (`src/app/pages/basemapStyle.ts`). The trial screenshots did not show this, because the browser tests stub the basemap tiles.
- **Licence text.** `src/assets/fonts/OFL-GeistMono.txt` is kept byte for byte as distributed, including trailing spaces on some lines, so `git diff --check` reports them for that file only.

## Implementation status

Built on the `trial/app-ui-alignment-family-wins` branch, 2026-10-20.

| Layer | Commit | What changed |
| --- | --- | --- |
| Record | `31d2430` | [Decision 0020](decisions/0020-energyatlas-family-ui-alignment.md), this record, the `AGENTS.md` rule, decision 0010 marked superseded in part |
| Tokens and contrast test | `9aeab36` | Family palette for Light and Dark; `borderInteractive` in every appearance; Light and Dark chart scaffolding; first-frame tokens and script; `appearances.test.ts` extended |
| Fonts | `3dfff41` | Geist Mono vendored in `src/assets/fonts/` with its licence and a provenance note; `--font-mono` and `--font-size-label` |
| Shell | `757811a` | Ruled ribbon and status bar; mono menu names with the inverted open menu; the inverted Run ▾; square, ruled menus, palette, and dialogs with header strips |
| Docking | `5e5dc34` | FlexLayout tab strips and side ribbons in mono labels with the inverted active tab and gapped accent outline; square docking chrome; accent drop indicators |
| Controls | `444994e` | Square buttons, inputs, steppers, and checkboxes on `borderInteractive`; inverted primary buttons; mono toolbar buttons; page header strips; ruled tables, notices, and empty states |
| Panels | `01158e2` | Section-strip headers for Assets, Workflow, Reasoning; ruled stage list and Inspection sections; ruled approvals with a tone edge |
| Data surfaces | `8aaab65` | AG Grid as a data sheet; dashboard tiles, controls, and charts as a shared-border grid; square chart bars and tooltips; ruled map header, controls, and legend; Roadmap nodes |
| Fixes | `7e99576` | The app's focus ring on MapLibre controls; reduced motion on splitters; sentence-case agent suggestions |
| Test | `a672423` | `e2e/appearance.spec.ts` checks that Geist Mono labels the tab strips and that no font comes from another origin |

Not changed: the wording of every label (case is CSS only, so accessible names are unchanged), the curated appearances' palettes, the data palettes, the column widths, the row and control heights, and all behaviour.

## Verification (2026-10-20)

Node.js 24 and Microsoft Edge on Windows. The trial branch runs its browser tests on port 5473 and the preview on 4473 (local trial configurations, not committed).

| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npm run lint` | passes on the repository's files; the two uncommitted trial Playwright configurations are outside the TypeScript project and fail to parse, so the run used `npx eslint . --ignore-pattern "playwright.trial*.config.ts"` |
| `npm run format:check` | passes |
| `npm test` | 175 tests in 20 files pass (the contrast test has 6 more checks per appearance) |
| Playwright, dev server | 51 tests pass, including axe with no serious or critical violation in all six appearances and the new Geist Mono test |
| `npm run build`, then the production spec | 1 test passes; the bundle carries `geist-mono-latin` (23.12 kB) and `geist-mono-latin-ext` (14.69 kB) |
| Style audit after | 1 colour literal outside the token files (the scrim, explained above), down from 3; font sizes from the four tokens plus the grid's and charts' numeric pixel values; 68 border declarations (the framing this variant asks for); one `prefers-reduced-motion` rule driving `--transition`; no font host or CDN URL |
| Browser checks | In Light, Dark, Technical monochrome, and Dark engineering at 1280x800 and 1920x1080: Geist and Geist Mono loaded, no font request to another origin, no horizontal page overflow, no clipped label on the Map, Table, Dashboard, Roadmap, and Creator pages, and no serious or critical axe violation on those pages at 1280x800. A stored Dark appearance paints black from the first frame. Switching from Light to Dark through the command palette restyles the chrome, the selected tab, the grid header, and both charts without a reload. Every control reached by Tab in Dark shows the 2 px accent ring; transitions are 0 s under reduced motion |
| Screenshots | Before and after of every appearance at both sizes (Map, Dashboard, Table) and of Light and Dark on the Table with Inspection, Roadmap with Workflow, Creator, Settings, the View and Run menus, the command palette, Issues, Tasks, Reasoning, the empty Dashboard, and the shortcuts dialog; kept outside the repository |

## Remaining gaps

- **Map basemap labels** keep OpenFreeMap's Noto Sans glyphs (decision 0012); MapLibre cannot use Geist without generated glyphs.
- **Canvas text** in charts stays Geist (guidelines section 2); axis labels are not mono labels.
- **Guidelines:** decision 0020, section 11, lists the amendments the user would need to make to the guidelines for this variant.
- **Package policy:** Geist Mono is vendored rather than installed from `@fontsource-variable/geist-mono`; the choice is open (decision 0020, section 4).
