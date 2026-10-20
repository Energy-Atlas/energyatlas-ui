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

## Implementation status

In progress.
