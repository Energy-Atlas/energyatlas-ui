# 0010: Geist typeface

Date: 2026-09-15

Status: the typeface was accepted by the user ("font family geist"), who asked for it to be written into the documentation and the plan. The agent chose the delivery method under that instruction; see alternatives.

## Context

The [UI design guidelines](../20260915_energyatlas_ui_design_guidelines.md) ([decision 0009](0009-ui-design-guidelines.md)) ask for a compact typography system but did not name a typeface. The build uses a system font stack (`src/index.css:19`), and ECharts hard-codes its own system stack (`src/app/pages/dashboardCharts.ts:84`).

## Decision

- **Geist is the application font family** on every surface: shell, docked panes, table, charts, map legend and overlays, and the contextual panel. Section 2 of the guidelines records this.
- **Self-host through `@fontsource-variable/geist` 5.3.0** (OFL-1.1), pinned exactly and imported once at the app entry. The package ships variable-weight WOFF2 files, normal and italic, for the Latin, Latin Extended, Cyrillic, Cyrillic Extended, and Vietnamese subsets. The browser downloads only the subsets a page needs.
- **Keep fallbacks:** the current system stack follows Geist, with explicit CJK fonts added, because Geist has no Chinese glyphs.
- **One source for the family:** every renderer takes it from `--font-sans`. Canvas renderers such as ECharts read the resolved token instead of a literal.

## Alternatives

- **Google Fonts CDN:** rejected. It needs the network at runtime, breaks offline use and a future desktop host, and adds a third-party request.
- **`geist` 1.7.2 (Vercel's package):** the upstream source, but documented for Next.js and 8.0 MB unpacked. Fontsource ships the same OFL fonts as plain CSS and WOFF2 files at 181 kB unpacked.
- **Vendored font files:** workable, but version pinning and license tracking would no longer come through npm.

## Consequences

- This adds a runtime dependency outside decisions 0007 and 0008. It is also recorded in [package selection](../package-selection.md).
- **Monospace stays Cascadia Code.** Superseded on 2026-10-20 by [decision 0021](0021-energyatlas-family-ui-alignment.md), which adopts Geist Mono for labels, code, and identifiers. On 2026-09-15 the user chose Cascadia Code, with Consolas and system fallbacks, over Geist Mono for identifiers, code, and the operation log. `@fontsource-variable/geist-mono` is not added.
- **Layout review:** Geist's metrics differ from Segoe UI, so chart labels, tab overflow, and table column widths need screenshot review after the switch.
- **Tabular numerals:** Geist's support for them has not been verified yet.
- **License:** OFL-1.1 allows bundling the fonts with the application.
