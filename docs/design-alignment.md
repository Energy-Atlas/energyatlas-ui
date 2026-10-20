# Design alignment

Date: 2026-09-15

Aligns the build with the [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md) ([decision 0009](decisions/0009-ui-design-guidelines.md)) and the Geist typeface ([decision 0010](decisions/0010-geist-typeface.md)). The user accepted the plan through their answers on 2026-09-15. The pass is built in commits `9127604`, `3d66ea5`, `5b408b6`, and `38e08a3`; see [implementation status](#implementation-status). The observed gaps describe the build before alignment.

On 2026-10-20 [decision 0021](decisions/0021-energyatlas-family-ui-alignment.md) aligned the build with the EnergyAtlas family, which wins where it conflicts with the decisions below (borders, monospace, labels, corners, and the Light and Dark palettes); see [family alignment](design-alignment-family.md).

## Observed gaps

Facts from the source at `88b08c9` (end of first-slice stage 3c). Counts come from text search.

| Guideline section | Build before alignment | Source |
| --- | --- | --- |
| 1. Boundaries | 91 `border` or `border-*` declarations across 11 CSS modules: shell 17, forms 16, components 13, dashboard 11, map 10, roadmap 9, and at most 4 in each of the rest. | `src/app/**/*.module.css` |
| 2. Typography | Seven font sizes: `0.75rem` (15 uses), `0.8125rem` (12), `0.875rem` (6), `1rem` (6), `0.9375rem` (1), `1.375rem` (1), and `var(--font-size-base)` (3). Font stack: `system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`; monospace `'Cascadia Code', Consolas, ui-monospace, monospace`. FlexLayout and AG Grid read `var(--font-sans)` (AG Grid at 13px); ECharts hard-codes `system-ui, "Segoe UI", sans-serif` in two places. | `src/app` CSS, `src/index.css:19`, `src/app/layout/flexlayout-theme.css:4`, `src/app/grid/agGrid.ts:20`, `src/app/pages/dashboardCharts.ts:84`, `src/app/pages/dashboardCharts.ts:161` |
| 3. Charts | A legend for two or more series. Line end labels and the y-axis name were removed in the stage 3c review because they collided. No annotation of peaks, thresholds, or scenario divergence. | `src/app/pages/dashboardCharts.ts` |
| 4. Palettes | One data palette (categorical blue, orange, green; sequential blue; status green, amber, red). The theme preference is system, light, or dark. | `src/app/viz/palette.ts`, `src/app/theme.ts` |
| 5. Cross-view color | Map ramp, chart slots, and status colors come from `palette.ts`, and the AG Grid theme derives from CSS tokens. The map background is hard-coded (`#f5f6f8` light, `#15181c` dark). Badge tones are CSS classes independent of `palette.ts`. | `src/app/pages/MapPage.tsx:44`, `src/app/grid/agGrid.ts`, `src/app/components/StateBadge.tsx` |
| 6. Map | No basemap. Buildings use the sequential blue ramp with a no-data color, plus a grid overlay. No diverging scale. | `src/app/pages/MapPage.tsx` |
| 7. Legend | Absolutely positioned group with a 1px border, medium radius, `min-width: 14rem`, a title, the ramp, and a no-data row. | `src/app/pages/map.module.css:58` |
| 8. Status | Stage labels: Not started, Ready, Running, Done, Skipped, Blocked, Failed, Stale, Unavailable; each has an icon and a colored tone. Capability labels Working, Simulated, Planned. State and capability badges render in 10 product files. | `src/app/components/StateBadge.tsx:23`, `src/app/components/CapabilityBadge.tsx:11` |
| 9. Run action | Ribbon quick button "Run current stage" (Ctrl+Enter). "Run next ready stage" exists in the Run group of the action registry. No split button. | `src/app/actions.ts:289`, `src/app/actions.ts:306`, `src/app/shell/Ribbon.tsx:22` |
| 10. Right surface | The right border holds a Reasoning placeholder only. No Inspection mode; selection details appear in the Assets panel details region. | `src/app/shell/WorkbenchShell.tsx:95`, `src/app/panels/AssetsPanel.tsx` |

## Decisions from discussion (2026-09-15)

1. **Scope and sequencing.** Implement every guideline except the scripted agent, before stage 4: Geist, type scale, borders, semantic color tokens, status vocabulary, capability disclosure, map and legend, chart scaffolding and selective annotation, Run ▾, curated palettes, and the Reasoning | Inspection surface with a read-only inspector.
2. **Capability disclosure.** The user agreed that the original section 8 conflicted with honest prototyping and amended it: working behavior carries no label, Planned is a normal state, Simulated is disclosed once per surface, and one complete overview stays in Settings.
3. **Palettes.** The user asked for "4 named palettes + light + dark". This is read as six appearance choices:
   - Light and Dark: the existing palettes, restyled to the guidelines;
   - technical monochrome, Lieflat-inspired, clean technical light, and dark engineering.

   System follows the operating system between Light and Dark. If the user meant each named palette in both modes, the token structure keeps that addition possible. The interpretation has not been confirmed yet.
4. **Monospace.** Cascadia Code stays, with Consolas and system fallbacks; no Geist Mono.
5. **Run ▾ variants.** Only the Run actions that exist: run current stage, run next ready stage, and cancel running tasks.

## Plan as implemented

- **Semantic color layer.** `src/app/appearance/appearances.ts` defines each appearance's chrome tokens (surfaces, text, borders, accent, focus, selection, status tones) and data palette (categorical slots, de-emphasis, sequential ramp, no data, selection, network, chart ink, status). `applyAppearance` in `src/app/theme.ts` writes the chrome tokens onto the root element; map, charts, and dashboard meters read the data palette through `useAppearance()`. No component writes a color literal.
- **Typeface.** `@fontsource-variable/geist` 5.3.0 is imported in `src/main.tsx`. `--font-sans` is `'Geist Variable'`, then Microsoft YaHei, PingFang SC, and Noto Sans CJK SC, then the system stack; `--font-mono` stays Cascadia Code. Charts read the resolved family through `useChartFont` and rebuild once fonts are ready. Aligned numbers use `tabular-nums`, which Geist supports.
- **Type scale.** `--font-size-small` (0.75rem), `--font-size-base` (0.8125rem), and `--font-size-title` (0.9375rem). Headings default to the base size; page, panel, dialog, and Inspection titles opt into the title size.
- **Borders.** Kept on pane edges, the ribbon and status bar, tab strips, inputs, buttons, popovers, dialogs, the map tooltip, and roadmap nodes. Removed from page headers, dashboard cards, stat tiles, scenario controls, creator forms, empty states, notices, and the map legend, which now use spacing and `--color-surface-raised`. Internal dividers use `--color-border-subtle`.
- **Status vocabulary.** Complete replaces Done, Outdated replaces Stale, and Planned replaces Unavailable. Not started, Ready, Complete, Skipped, Blocked, and Planned are muted text with an icon; Running uses the info tone; Failed and Outdated add tone and a tint. User-facing text says outdated.
- **Capability disclosure.** `CapabilityBadge` renders nothing for working capabilities. Simulated appears once per surface: the Workflow panel, the Dashboard header, the map legend, the status bar, and Inspection provenance. Planned stays on planned controls. `StatusTag` names every status in the Settings and Help capability table.
- **Appearances.** Settings offers System and the six appearances with descriptions and swatches; the View menu and command palette offer the same choices. Changes are logged as `view.setAppearance` and stored under `eaui.theme`.
- **Map and legend.** Background, ramp, no-data color, selection outline, feeder lines, and grid points come from the appearance. The legend is a compact, borderless instrument with the unit in its title, outlined swatches, and one quiet Simulated note.
- **Charts.** Scaffolding from the appearance ink, a legend by default, and one annotation on the baseline peak month. The annual bars keep their direct labels with reductions.
- **Run ▾.** A split button in the ribbon: the primary part runs the current stage, and the menu lists the Run group with unavailable actions explained. When the current stage cannot run, the control recedes to neutral colors and still explains why.
- **Context panel.** The right border tab was named Context and held a keyboard-accessible Reasoning | Inspection switch, logged as `view.setContextMode`. Inspection follows the shared selection read-only through `src/app/panels/inspection.ts`. "Inspect selection" in the command palette and an Inspect button on the Map page open it. Superseded on 2026-09-15 by [decision 0016](decisions/0016-reasoning-and-inspection-panels.md): Reasoning and Inspection are independent panels, the switch and the `context.setMode` operation are gone, and "Inspect selection" opens the Inspection panel.

Deviations from the plan above as proposed:

- **Blocked** stays quiet rather than taking warning color, because it follows from an upstream failure that already draws attention.
- **Annotations:** only the baseline peak is annotated. The largest scenario difference is already a direct label on the annual bars.
- **Panel name:** the right panel is named Context; its component id remains `panel.reasoning` so saved layouts restore, and restored layouts take the new name.
- **Light appearance:** its third categorical color moved from `#1baf7a` (2.82:1 on white) to `#15986a` (3.66:1) so every slot in every appearance passes 3:1.

## Implementation status

### Part 1: appearances, typeface, type scale, borders, map, and charts

Commits `9127604` (Playwright worker cap) and `3d66ea5`.

- **Real:** six appearances and System; the Settings picker and View menu commands; logged and persisted preference; Geist with fallbacks; the three-size type scale; border reduction; appearance-driven map, legend, charts, and meters; the baseline peak annotation.
- **Tests:** `src/app/appearance/appearances.test.ts` checks every appearance: text and muted text at least 4.5:1 on the ground, surface, raised surface, and selection tint; accent text, text on accent, and focus; status tone text at least 4.5:1 on its tint, the surface, and the raised surface; categorical, de-emphasis, and selection colors at least 3:1 on the chart surface; and that the declared scheme matches the surfaces. It also covers reading stored preferences. `e2e/appearance.spec.ts` checks that Geist loads, that an appearance chosen in Settings persists across reloads, and that the workbench has no serious or critical axe violations in all six appearances.

### Part 2: status, capability disclosure, and Run

Commit `5b408b6`.

- **Real:** semantic stage states with quiet routine treatment; quiet capability disclosure; the Run split button; outdated wording.
- **Tests:** the browser specs assert Complete and Outdated; `e2e/workbench.spec.ts` checks that no Working label is visible and runs a stage from the Run menu, where an unavailable action is marked disabled.

### Part 3: context panel

Commit `38e08a3`.

- **Real:** the Context panel with its mode switch; Inspection of one building (properties, results, warnings, linked grid elements, provenance), one grid element (rating, connected buildings, transformer loading and rating warnings), or several objects (summary and a list of up to 10 that can each be inspected); the Inspect selection action and Map button.
- **Simulated:** every value shown, disclosed in Provenance.
- **Planned:** Reasoning mode remained a labeled placeholder in this pass; stage 4 built it on the `feature/agentic` branch (see [stage 4 status](first-slice-proposal.md#stage-4-scripted-agent-2026-09-15)).
- **Tests:** `src/app/panels/inspection.test.ts` (empty, single building, skipped by the baseline, several buildings, transformer over rating); `e2e/context.spec.ts` (mode switch, selection from the Table, provenance, axe, clearing, and the palette action reopening the panel on Inspection).

### Verification (2026-09-15)

Node.js 24.21.0 and Microsoft Edge on the `E:/Coding` machine.

- `npm run typecheck` and `npm run lint` pass.
- `npx prettier --check . --end-of-line auto` passes. Plain `npm run format:check` reports files on this checkout only because `core.autocrlf=true` checks them out with CRLF line endings.
- `npm test`: 69 tests in 9 files pass.
- `npm run test:e2e`: 36 tests pass with 4 workers in about 53 seconds.
- Screenshots reviewed: the Dashboard, the monthly chart, and the Map with data in all six appearances at 1920x1080; the Table with Inspection in Light and Dark engineering at 1920x1080; Settings at 1280x800. The review added outlines to legend swatches, which were nearly invisible for no data in Dark engineering, and corrected the Inspection results hint for buildings the baseline model skipped.

### Findings

- **Playwright parallelism:** on unchanged code, the default worker count (16 workers on 32 cores) timed out 5 of 30 tests while the dev server was cold. Four workers pass consistently, so local runs are capped at 4.
- **Tabular numerals:** Geist supports them. At 40px, "1111" and "0000" both measure 96px with `tabular-nums`, and 56.6px and 107.3px without.
- **Menu names:** React Aria's `MenuTrigger` names the menu after its trigger button, overriding the menu's own `aria-label`.
- **Skipped buildings:** the baseline model skips buildings without an archetype or a floor area (`src/domain/simulation.ts`). In the synthetic project, 16 of 400 buildings have no archetype, so Inspection explains the missing result instead of asking to run the stage again.

### Remaining gaps

- **Palettes:** the six-appearance reading of the user's answer is unconfirmed, and each named palette exists in one scheme only.
- **Accessibility coverage:** axe runs in all six appearances on the default workbench only. Pages with data were axe-checked in Light and reviewed by screenshot in the other appearances. Roadmap and Creator were not re-screenshotted in this pass.
- **Charts:** only the annual bars carry direct labels, and no map metric uses a diverging scale yet.
- **Map context layers** (section 6): not built in this pass. Built on the `feature/basemap` branch ([decision 0012](decisions/0012-openfreemap-basemap-back-bay.md)): OpenFreeMap streets, water, parks, and labels recolored from each appearance, with the basemap's own buildings hidden. Basemap labels use OpenFreeMap's Noto Sans glyphs rather than Geist.
- **Inspection:** it is read-only; editing stays on the Table page. The Assets panel keeps its own details region, the context mode resets on reload, and the Table page has no Inspect button (the command palette action covers keyboard use).
- **Reasoning:** closed on the `feature/agentic` branch, where stage 4 fills it with scripted agent sessions; `master` still shows the placeholder until that branch is merged. [Decision 0016](decisions/0016-reasoning-and-inspection-panels.md) then made it a panel of its own with send and permission modes.
- **Line endings:** `npm run format:check` failed on CRLF checkouts. Resolved on 2026-09-15 by [decision 0014](decisions/0014-lf-line-endings.md): `.gitattributes` keeps text files in LF on every platform.
