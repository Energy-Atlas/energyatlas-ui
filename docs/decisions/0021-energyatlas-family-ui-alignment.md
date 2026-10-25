# 0021: UI alignment with the EnergyAtlas family, the family look winning

Date: 2026-10-20

Status: decided by the user (the owner) on 2026-10-20 as the "family wins" variant. Where this record and the reference disagree, this record wins. Where this record and the [UI design guidelines](../20260915_energyatlas_ui_design_guidelines.md) disagree, section 1 says which wins: in every conflict listed there, the EnergyAtlas family look wins. The guidelines are maintained by the user and are not edited here; section 11 lists the amendments this variant would need.

## Context

- **Reference:** the EnergyAtlas family as built on the dev-skills documentation site: its specification `design/ui-design-spec.md` (section 0 wins over its body) and its stylesheet `docs/assets/stylesheets/energyatlas.css`, both in the `dev-skills` repository. Neither is kept in this repository; section 9 describes the reference in words.
- **Palette source:** the "EnergyAtlas family palette" table of the `app-ui-alignment` skill (`references/token-recipes.md`), identical to sections 0.5 and 0.6 of the reference spec, as of 2026-10-20. Contrast fixes override it (section 6).
- **The app's own rules:** the [UI design guidelines](../20260915_energyatlas_ui_design_guidelines.md) ([decision 0009](0009-ui-design-guidelines.md)), the Geist typeface ([decision 0010](0010-geist-typeface.md)), the appearance token module `src/app/appearance/appearances.ts`, the first-frame tokens in `src/index.css`, and the earlier [design alignment](../design-alignment.md).
- **Audit:** the counts, the translation table, and the contrast evidence are in the [family alignment record](../design-alignment-family.md), taken at `563b152`.

## 1. Precedence

| Conflict | Reference | App rule | Decision |
| --- | --- | --- | --- |
| Borders and framing | A continuous rectilinear grid: rules on every frame, strip, and cell; shared borders | Guidelines 1: major pane boundaries only; internal grouping by spacing and surface tone | **Family.** Rules on pane boundaries, tab strips, the ribbon and status bar, and between panel sections; panel headers ruled below; dashboard tiles as a shared-border grid closed on four sides |
| Panel headers | Section strips: small mono uppercase muted label, optional right-aligned note, ruled | Titles in the title size and weight | **Family.** Panel and page headers are section strips; the right-aligned note keeps whatever the header already shows (capability, count) |
| Labels | Mono uppercase tracked labels | Sans throughout (guidelines 2: Geist on every surface) | **App** (owner, 2026-10-20; section 12). Labels keep the family's places, weight, and muted colour, but are set in Geist as written. The first build used mono uppercase |
| Type sizes | Editorial display sizes (48 to 64 px), 16 px body | Two or three sizes | **Family by role, app density.** The three sizes stay; one mono label size role is added (section 5); no display sizes |
| Monospace | Geist Mono | Cascadia Code ([decision 0010](0010-geist-typeface.md)) | **Family.** Geist Mono for labels, code, identifiers, and the operation log, against decision 0010 (section 4) |
| Active tab | Inverted block (text-coloured fill) in a thin accent outline | Text colour and an accent edge | **Family**, with the outline separated from the fill by a surface-coloured gap so it keeps 3:1 (section 6) |
| Primary action | Inverted block; accent on hover and focus | Accent fill (Run ▾) | **Family.** Run ▾ and the agent's send control are inverted blocks; the Run ▾ shape and wording of guidelines 9 stay |
| Corners and elevation | Square, no shadows | 4 and 6 px radii, a popover shadow | **Family.** Radius 0 everywhere; one overlay shadow kept for menus, popovers, and dialogs (section 7) |
| Theme set | Light and dark | Six appearances and System (guidelines 4) | Light and Dark take the family palette; the four curated appearances keep their palettes and take the structure |
| Serif accent | Cormorant Garamond italic in a hero | No serif | **Not used.** No working surface is a welcome screen; the dense app has no place for it |

## 2. Brand

- The app stays **EnergyAtlas UI**: name, favicon, and wording unchanged.

## 3. Themes

- **Light and Dark** take the family palette (section 6). **Technical monochrome, Lieflat-inspired, Clean technical light, and Dark engineering** keep their palettes and take the structure: square corners, rules, mono labels, the active-tab block, inverted primary actions, and an interactive border of at least 3:1 (section 6).
- Default: System, which follows the operating system between Light and Dark. The switch stays; nothing is forced.
- The stored appearance's scheme is applied before the first paint by an inline script in `index.html`, and `src/index.css` carries the family Light tokens, with the family Dark tokens for `prefers-color-scheme: dark` and `data-theme='dark'`, so the first frame matches the scheme.

## 4. Fonts

- **Geist** (interface, content, charts, tables): unchanged, from `@fontsource-variable/geist` 5.3.0 (decision 0010).
- **Geist Mono** (labels, code, identifiers, the operation log, keyboard hints): replaces Cascadia Code. Delivered as vendored variable WOFF2 files, Latin and Latin Extended subsets, copied from the dev-skills site's `docs/assets/fonts/` into `src/assets/fonts/` with their licence (`OFL-GeistMono.txt`, SIL Open Font License 1.1), and declared with `@font-face` in `src/index.css`, so Vite bundles them. No font host at runtime. Fallbacks: `ui-monospace`, Cascadia Code, Consolas, `monospace`.
- **Package policy:** decision 0010 preferred npm packages for version pinning and licence tracking, and `AGENTS.md` asks for packages outside decisions 0007, 0008, and 0010 to be recorded. Vendoring adds no package, but the files are now tracked by hand: their source and date are in `src/assets/fonts/README.md`. The alternative, `@fontsource-variable/geist-mono` pinned exactly, is open for the user to choose later; it would change only the import.
- **Cormorant Garamond:** not used (section 1).
- Tabular numerals stay on grids, meters, tiles, and inspection facts.

## 5. Type scale

| Token | Size | Roles |
| --- | --- | --- |
| `--font-size-label` (added) | 0.6875rem (11 px) | Mono uppercase labels: tab strips, panel and page header strips, table headers, status bar, tile labels |
| `--font-size-small` | 0.75rem (12 px) | Metadata, descriptions, hints, badges |
| `--font-size-base` | 0.8125rem (13 px) | Content and controls |
| `--font-size-title` | 0.9375rem (15 px) | Dialog titles, Inspection object titles, tile values |

Labels are Geist Mono, weight 600, uppercase, tracked 0.08em (tab strips, headers) to 0.12em (strip labels), in the muted text colour.

## 6. Colour roles and contrast

Light and Dark:

| Token | Dark | Light | Family role |
| --- | --- | --- | --- |
| `bg`, `surface` | `#000000` | `#ffffff` | base: the panes, ribbon, and chart surface, as content sits on the base in the reference |
| `surfaceRaised` | `#1a1a1a` | `#f8fafc` | surface-1: tab strips, header strips, status bar, hover, raised tiles, overlays |
| `text` | `#e5e5e5` | `#18202c` | text-primary |
| `textMuted` | `#999999` | `#5f6b7a` | text-muted (already contrast-adjusted in the family) |
| `border`, `borderSubtle` | `#404040` | `#cfd8e5` | border-subtle: every decorative rule |
| `borderInteractive` (added) | `#6b6b6b` | `#768599` | border-interactive: edges of inputs, buttons, checkboxes |
| `accent`, `accentText`, `focus` | `#4da3ff` | `#125dae` | accent |
| `onAccent` | `#000000` | `#ffffff` | text on an accent fill |
| `selectedBg` | `#0c1a29` | `#e7eff7` | accent at 16 % (dark) and 10 % (light) over the base |
| tone success / info / warning / danger text | `#28a745` / `#4da3ff` / `#ffc107` / `#f44336` | `#188038` / `#125dae` / **`#946300`** / `#c5221f` | state colours |
| tone tints | tone at 16 % over `#000000` | tone at 8 % over `#ffffff` | derived; the family has none |
| tone neutral | `#b0b0b0` on `#1a1a1a` | `#3f4b5b` on `#f8fafc` | text-secondary on surface-1 |

Contrast fixes against the family values:

| Token | Theme | Family value | Used value | Contrast of used value |
| --- | --- | --- | --- | --- |
| `toneWarningText` | Light | `#9a6700` (4.29:1 on its 10 % tint) | `#946300` | 4.69 on its 8 % tint `#f7f3eb`, 4.96 on `#f8fafc`, 5.19 on `#ffffff` |
| tone tints | Light | none | 8 % mixes | success 4.52 on `#edf5ef`; danger 5.08 on `#faeded`; info 5.82 on `#ecf2f9` |
| `borderInteractive` | monochrome / lieflat / cleanLight / darkEngineering | none (controls used `border`, 1.2 to 1.5:1) | `#878784` / `#88837b` / `#85898d` / `#6c7075` | at least 3:1 on each appearance's ground, surface, and raised surface |

- **The active-tab outline is not drawn on the inverted fill.** The accent on the text-coloured fill is 2.08:1 in Dark and 2.50:1 in Light (1.00:1 in Technical monochrome, whose accent is its text colour). The outline is drawn on the tab's surface with a 2 px surface-coloured gap between it and the fill, where it measures at least 3:1 against the surface it sits on.
- **Brand fill** `#003978` is not used: the app has no branded fill.
- **Red** only for errors, destructive actions, and failures; amber for warnings, green for success, blue for links, information, focus, and selection.
- **Data colours:** each appearance keeps its data palette. Light and Dark change only the chart scaffolding (`ink`), which follows the chrome: surface, primary and muted ink, grid at surface-1, axis at the rule colour. Every categorical, de-emphasis, and selection colour passes 3:1 on the new chart surfaces (Dark on `#000000`: 5.41 to 16.67; Light unchanged on `#ffffff`).

The contrast test is `src/app/appearance/appearances.test.ts`; it covers every appearance, and now also the interactive border, accent text on raised surfaces and selection, and text on the inverted block.

## 7. Shapes, borders, and elevation

- Radii: 0 for every control, surface, badge, menu, dialog, slider track, and tile. Circles stay round where the shape carries meaning (radio buttons, the slider thumb, map point keys).
- Rules: 1 px `border` on pane boundaries (FlexLayout splitters and border bars), under tab strips, the ribbon, above the status bar, under panel and page header strips, between panel sections, and around and between dashboard tiles.
- Elevation: one shadow, `shadowPopover`, kept for menus, popovers, the command palette, and dialogs, together with a 1 px rule; nothing else casts a shadow.
- Motion: 150 ms colour transitions on tabs, buttons, and splitters; none under `prefers-reduced-motion: reduce`.

## 8. Component treatments

- **Tab strips** (FlexLayout centre tabs, side border tabs, Table sub-tabs): Geist Mono label size, uppercase, tracked 0.08em, muted; hover to text colour; the selected tab is an inverted block (text-coloured fill, surface-coloured label) inside a 1 px accent outline with a 2 px gap, drawn inset so the tab bar's overflow cannot clip it. The strip has a rule below.
- **Panel and page headers:** section strips on `surfaceRaised`, ruled below, label in mono uppercase muted at the label size; existing right-hand content (Simulated note, counts, actions) stays right-aligned.
- **Ribbon:** one line, ruled below. Menu names (File, Edit, View, Run, Help) are nav labels: mono uppercase at the label size, with the open menu shown as the inverted block. The search field is square and ruled with its hint in mono. The product name stays in its accent colour; the project name in Geist. Thin vertical rules separate the groups.
- **Status bar:** ruled above, on `surfaceRaised`, its text in mono at the label size; state tones only for state.
- **Buttons:** square, 1 px `borderInteractive`; hover turns the edge and label to the accent. Text buttons in toolbars and panels (Map, Table, Dashboard, Workflow, Inspection, Assets, Roadmap) use mono uppercase at the label size; buttons inside forms and dialogs keep sentence case in Geist. **Primary** (Run ▾, Send, primary form buttons): inverted block, accent fill on hover. Disabled-with-reason: dashed edge, muted label, still explains itself. Quiet icon buttons: no edge until hovered.
- **Inputs, selects, checkboxes, radios, sliders:** square, `borderInteractive` edges, accent edge when focused; invalid fields keep the danger edge and message.
- **Data grid (AG Grid):** header on `surfaceRaised` in Geist Mono uppercase label size, muted; rules between rows and columns in `border`; no zebra striping; accent tint on hover; `selectedBg` for selection; square wrapper.
- **Dashboard tiles:** a shared-border grid closed on all four sides, each tile with a mono uppercase label, the value at the title size, and its delta. Chart cards and scenario controls are ruled cells with header strips.
- **Charts:** scaffolding from `ink` (grid quieter than the rules, axis at the rule colour); text in Geist (guidelines 2); tooltip square with a rule.
- **Map:** legend square, ruled, its title as a mono uppercase label; MapLibre controls square and ruled; tooltip square.
- **Overlays:** menus, popovers, the command palette, and dialogs: square, 1 px rule, `surfaceRaised`, the one overlay shadow; dialog titles as mono strips.
- **States:** notices and empty states as ruled cells with a tone edge on the left where they carry a state; badges square, attention states with a tint.

## 9. The reference, described

- **Surface:** near-black page in dark (`#000000`), white in light; off-white or near-black text, mid-grey metadata.
- **Framing:** a continuous rectilinear grid of thin rules; cells share their borders; nothing floats.
- **Header:** low, one line, a thin bottom rule; navigation labels small, uppercase, widely tracked monospace; thin vertical dividers between groups.
- **Labels:** Geist Mono, 10 to 12 px, weight 600, uppercase, tracked 0.08 to 0.16 em, muted.
- **Active item:** a small inverted block (light fill, dark label in dark mode) inside a thin blue rectangular outline.
- **Primary action:** a full-height inverted block.
- **Not adopted:** the hero with display type and the Cormorant italic phrase, `+` registration marks, numbered section indices (`02 / …`), the scroll ruler, and the 760 to 900 px prose column: they suit a document, not a dense workbench.

## 10. Deviations during implementation

Recorded in the [family alignment record](../design-alignment-family.md#deviations).

## 11. Guideline amendments this variant would need

The guidelines are the user's; these are proposals, not edits.

- **Section 1 (boundaries):** allow a grid-framed language: rules on pane boundaries, tab strips, and between panel sections, with dashboard tiles as a shared-border grid, in place of "internal groupings should rely more on alignment, spacing, typography, and restrained surface contrast".
- **Section 2 (typography):** name **Geist Mono** for code, identifiers, keyboard hints, and the operation log beside Geist. Labels stay in Geist, as written (section 12), so no new size role is needed.
- **Section 4 (palettes):** say that Light and Dark carry the EnergyAtlas family palette, and that the curated palettes share the family structure.
- **Section 9 (Run):** describe the primary action as an inverted block (text-coloured fill) that turns to the accent on hover, keeping **▶ Run ▾**.
- **Section 11 (consistency):** add square corners and a single overlay shadow to the shared visual language.
- **Decision 0010:** its "Monospace stays Cascadia Code" consequence is superseded by section 4 of this record.

## 12. Label style (2026-10-20)

After trying the build, the owner kept the family variant but found the mono uppercase tab titles and header labels
tiresome. Labels now take the app's sans, as written:

- Tab strips, panel and page header strips, table headers, the status bar, dashboard tile labels, the map legend title,
  and toolbar text buttons use four label tokens in `src/app/global.css`: `--label-font` (`var(--font-sans)`),
  `--label-case` (`none`), `--label-size` (`var(--font-size-small)`, 12 px), and `--label-tracking` (`0`), with the
  existing `--label-weight` (600) and the muted colour. The family's treatment is one edit away:
  `var(--font-mono)`, `uppercase`, `var(--font-size-label)`, `0.08em`.
- Everything else of the family stays: the rules, the inverted active tab with its outline and gap, the strips, square
  corners, the palette, and inverted primary actions.
- Geist Mono stays for code, identifiers, numbers in counts, keyboard hints, and tool metadata.
- Units in labels read as written again (`MWh`, `m²`, `kWh/yr`).
- Page, panel, card, form, dialog, and Inspection section titles inside a panel's content are titles, not labels: they
  keep their earlier design (the title size and weight, the text colour, no tracking) and sit on the pane without a
  backdrop strip. Only the docked tab strips and side handles keep the strip treatment.
- Hovering an unselected tab or side handle shows the text colour, the pane surface, and a 1 px interactive edge (at
  least 3:1 against the strip). The library's own hover gave the label the selected-tab colour, which after the
  inversion is the strip's colour, so a hovered handle looked empty. Only hovering fades; selecting a tab is immediate,
  so no check samples a colour halfway through a transition.

## 13. Control grammar (2026-10-20)

Fields, selects, and buttons had become one object: a square box with a 1 px interactive edge on the pane colour. They
now differ in fill, edge, and content, so each reads at a glance and in greyscale:

| Kind | Fill | Edge | Content |
| --- | --- | --- | --- |
| Text input, command search, palette and agent inputs | `--field-bg`, the pane colour (a well on raised strips) | 1 px interactive edge, 2 px at the bottom | Value left, muted placeholder |
| Select (agent permission and model pickers) | As the input | As the input | Value left, chevron in its own full-height cell behind a rule; the open picker inverts the whole cell |
| Secondary button | `--button-bg`, the text colour at 8 % over the surface | Even 1 px interactive edge | Centred verb |
| Number steppers | `--button-bg` | On the field's bottom line | Minus and plus |
| Primary button | Inverted block, unchanged | — | Centred verb |
| Agent send (split button) | Ready: the inverted primary block; idle: the send part disabled (dashed, no fill), the chevron part `--button-bg` | A rule before the chevron part, a full-height cell | Enter glyph, then chevron; each part hovers on its own, and an open menu fills the whole chevron cell (inverted when idle, accent when ready) |
| Quiet ribbon buttons | None at rest | An interactive edge and `--button-bg-hover` (14 %) on hover | Icon or menu name |

Pressed buttons take `--button-bg-pressed` (20 %). A dashed edge means disabled and nothing else; disabled buttons lose
their fill. Muted text stays off the hover and pressed fills (it passes 4.5:1 on the 8 % rest fill in every appearance).

## 14. The EnergyAtlas mark (2026-10-20)

The owner chose the EnergyAtlas mark for the app and allowed copying it in. It replaces the blue square favicon and
stands before the product name in the ribbon.

- Source: the brand pack of the `app-ui-alignment` skill (`references/brand/`), drawn from the EnergyAtlas website's
  icon. The white-E version is used everywhere, since the app has dark appearances; the knockout version, whose E
  shows the surface, is not used.
- Favicons in `public/brand/` (SVG, 32 px PNG, 16/32/48 px ICO, 180 px apple touch icon), linked from `index.html`
  with root-relative paths that Vite prefixes with the base path. The production spec checks that each resolves to an
  image under the base path.
- The ribbon mark is `src/assets/brand/energyatlas-mark.svg`, imported as a URL (Vite inlines it, under 4 KB), drawn
  decoratively (`alt=""`) before "EnergyAtlas UI" at 17 px, about 1.3 times the name's size, in every appearance.
- The mark is never recoloured: its gradient includes the brand red, an image rather than a UI colour, so the rule
  that red marks only errors does not apply to it.

## 15. The mark alone in the ribbon (2026-10-24)

At the owner's request the ribbon no longer shows the product name ("EnergyAtlas UI") or the project name; the mark
stands alone at the start of the ribbon. This amends section 14 and the ribbon entry of section 8, which kept the
product name in its accent colour and the project name in Geist.

- The mark is now the only brand in the ribbon, so it carries the accessible name "EnergyAtlas" instead of `alt=""`.
  Its size (17 px) and colours are unchanged.
- The project name stays the page's level-one heading, visually hidden, so screen readers still announce it and the
  e2e checks of the heading still hold.
- The app's name in `index.html`, the favicons, and the wording elsewhere are unchanged.

## 16. The account button (2026-10-25)

At the owner's request the ribbon ends with an account button: the account's initials in a circle, as mail clients
draw an automatic account picture. Its dropdown is the same menu as File, Edit, View, Run, and Help.

- The circle is the family's one round shape. `--radius-round` (50 %) in `src/app/global.css` exists for it alone;
  every other corner stays square.
- The initials sit on `--color-accent` in `--color-on-accent`, in Geist at the label size. Hover and the open menu ring
  the circle in the text colour over a surface gap; keyboard focus uses the app's focus ring.
- Demo only. The initials belong to a fictional person, Avery Chen (`src/app/demoAccount.ts`). At the owner's request
  the menu holds exactly two items, Account and Log out. Both are planned and say so when chosen: capabilities
  `account.settings` and `account.signIn` (planned) describe them, and `account.demo` (simulated) the initials. A
  first version that switched between three demo people, with Profile and Notifications, was cut the same day.
- The actions are in the shared registry under the `Account` group, which is not one of the ribbon's menu names, so the
  command palette finds them too.
- A menu anchored at its right edge has a fixed width (22 rem): with a width that followed its wrapping reasons,
  React Aria's repositioning set off a ResizeObserver loop.
