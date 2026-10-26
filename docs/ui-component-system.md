# Unified panel components: audit and proposal

Status: proposal, awaiting the owner's choices (2026-10-26). Nothing here is implemented. It answers the owner's
review comments of 2026-10-26 after testing local `master` at `4400c69`:

1. one design (reusable components, or at least one guideline) for each kind of component inside any panel: tables,
   lists of selectable items, log output, groups of buttons, filter controls, popup messages;
2. a message panel that hosts every popup message;
3. the same prebuilt widgets on every table: a table toolbar (column visibility, download, restyle such as auto-fit
   column widths or shaded alternate rows) and two widgets per column (filter, and styling and formatting), shown
   only while the pointer is over the table or that column;
4. other suggestions for unifying components.

The owner's [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md) section 11 already asks for one
visual language across panes, tables, issues, and run state; [decision 0021](decisions/0021-energyatlas-family-ui-alignment.md)
fixes the look (square controls, mono uppercase headers, ruled tables). This proposal adds the missing layer: shared
behaviour and anatomy, built once as components. The guidelines document is not edited; if the owner wants the
catalogue below in it, they can add it.

## Audit (observed at `4400c69`)

Shared components today are few: `ActionButton`, `StateBadge`, `CapabilityBadge`, `EmptyState`, `CapabilityTable`,
`AccountAvatar` (`src/app/components/`, 271 lines), plus CSS classes in `components.module.css` and
`forms.module.css`. Everything else is built per page.

| Kind | What exists | Where |
| --- | --- | --- |
| Tables | Two technologies. AG Grid Community for the two Table page grids (Buildings, Grid elements), with per-column filters and no column visibility menu. About 20 plain `<table className={componentStyles.table}>` elsewhere, with no sorting, filtering, column control, or download, except Results, which has its own CSV export. | `src/app/pages/TablePage.tsx:232`, `:461`; Jobs `JobItems.tsx:76`; Intake `IntakePage.tsx:66`, `:410`; Archetypes `ArchetypesPage.tsx:627`, `ScheduleEditor.tsx`; Creator `CreatorPage.tsx:172`, `:216`; `ScenarioComparison.tsx:30`; Calibration `CalibrationPage.tsx:55`, `:202`, `:290`; Dashboard data tables `DashboardPage.tsx:161`, `:500`, `:543`; Results `ResultsPage.tsx:324`, `:355`; Issues `IssuesPage.tsx:33`; Help `HelpDialogs.tsx:93`, `:116` |
| Selectable lists | React Aria `ListBox` in two places, each styled separately; a `Tree` for assets; plain lists elsewhere. | `jobs/JobList.tsx`, `archetypes/ArchetypesPage.tsx`, `panels/AssetsPanel.tsx`, `project/ProjectList.tsx`, `panels/WorkflowPanel.tsx` |
| Log output | Two logs with separate markup: the job log and the agent transcript (`role="log"`). The status bar shows only the last operation. | `jobs/JobLog.tsx`, `panels/ReasoningPanel.tsx:424`, `shell/StatusBar.tsx:81` |
| Button groups | The ribbon uses React Aria `Toolbar` (arrow-key navigation); page and panel toolbars are rows of buttons without it. | `shell/Ribbon.tsx`, page headers |
| Filters | `RadioGroup` used as a segmented filter in Jobs and Results; AG Grid's own filter popups on the Table page. | `jobs/JobsPage.tsx`, `results/ResultsPage.tsx`, `TablePage.tsx` |
| Messages | Five channels, each with its own look and lifetime: the status bar's last-operation sentence (live region, replaced by the next operation); the job notice strip above the status bar (one at a time, "n earlier notices"); agent notices inside the Reasoning transcript; per-form success and error lines (`setMessage` in Creator and Archetypes); page alerts and notices (Table, Roadmap, Dashboard stale notice, Demo conditions). No history: a dismissed or replaced message is gone. | `StatusBar.tsx`, `JobNoticeTray.tsx`, `jobs/jobNotices.ts`, `ReasoningPanel.tsx:207`, `CreatorPage.tsx:361`, `ArchetypesPage.tsx:116`, `TablePage.tsx:378`, `RoadmapPage.tsx:388`, `DashboardPage.tsx:268` |
| Key–value details | Inspection, job detail, calibration fit, and provenance each lay out their own property rows. | `panels/InspectionPanel.tsx`, `jobs/JobDetail.tsx`, `calibration/`, `results/` |

Interpretation: the look is already consistent (decision 0021); the behaviour is not. A table, list, log, or message
behaves differently depending on which page it is on, and most tables lack the controls a data-heavy tool needs.

## Proposal

One rule decides where each thing lives: **state stays where it is shown; events go to messages.** Field validation,
blocking issues in a form, empty states, and "results are stale" notices are state and stay inline. Things that
happened (a job finished, a save failed, the server dropped, the agent needs approval, a command was rejected) are
events and go to the message system.

### 1. Component catalogue

Each kind gets one component in `src/app/components/`, built on React Aria Components (already accepted, no new
package), styled only from appearance tokens, and shown on a component gallery page (see 4.9) in every appearance.

| Component | Replaces | Anatomy and behaviour |
| --- | --- | --- |
| `DataTable` | All plain tables; wraps AG Grid on the Table page (section 3) | Section 3 |
| `SelectableList` | Job list, archetype list, project list, measure and scenario lists, calibration variants | `GridList` or `ListBox`; one row anatomy: leading status badge, title, one muted meta line, trailing quiet actions shown on hover or focus; single or multiple selection with `selectedBg` and the accent edge; optional search field and segmented filter above; built-in empty state |
| `LogView` | Job log, agent tool-call details, Messages panel history, operation log | `role="log"`, Geist Mono; columns time, level, source, text; level filter, follow-latest toggle (on by default, off when the reader scrolls up), copy, and download as text |
| `Toolbar` | Page and panel button rows | React Aria `Toolbar` with arrow-key navigation; mono uppercase buttons (decision 0021); groups split by rules; the primary action last; buttons that do not fit move into a "More" menu instead of wrapping; disabled buttons keep their reason |
| `SegmentedFilter` | `RadioGroup` filters in Jobs and Results | One look for "All / Running / Failed" style choices, each with a count; the active choice stays visible |
| `MenuButton` | Ribbon and Reasoning menus, table and column menus | One trigger and popover style; checkable items, sections, and descriptions that carry the reason for disabled items |
| `InlineAlert` | Page alerts, notices, stale notices, form result lines | Tone (info, success, warning, danger), an icon, text, optional actions; `role="alert"` only for danger |
| `PropertyList` | Inspection rows, job detail, fit details, provenance | Label and value columns with units, provenance or "edited" markers, and copy for identifiers |
| `PanelHeader` | Page and panel header strips | The mono header strip of decision 0021, a title, a count, and a `Toolbar` slot |
| `Section` | `<details>` data tables and ad hoc disclosures | Disclosure with a title, a count badge, and remembered open state |

### 2. Messages: one store, a toast host, a Messages panel

- **Store.** `services.messages` collects every event: command rejections, job notices (replacing `jobNotices`), save
  and lifecycle results, server faults and reconnects, agent approvals and agent notices. Each message has an id,
  time, tone, source (command, job, agent, server, project), project id, text, optional actions (Open job, Show
  issue, Retry, Undo), and a read flag.
- **Toast host.** One region, bottom right above the status bar, the only place popups appear. At most three
  toasts; success and info leave after six seconds (paused while hovered or focused); warnings and errors stay until
  dismissed. Toasts never take focus; one shortcut (F6 cycling, or a dedicated key) reaches them; reduced motion
  removes the slide. Every toast is also kept in the panel.
- **Messages panel.** A dockable panel listing the history as a `LogView`/`SelectableList`: filter by tone and
  source, mark read, clear, and run a message's actions again. Scoped to the open project, with a "server" scope
  for connection events.
- **Status bar.** Keeps a short last-operation sentence and adds an unread counter coloured by the worst unread tone;
  clicking it opens the Messages panel.
- **Issues stay separate.** Issues are the model's current validation problems (state); a message can link to an
  issue, not replace it.

### 3. Tables: one `DataTable` with built-in widgets

**Column definition** (one shape for every table): id, header, value accessor, type (text, number, date, enum,
status, identifier), unit, default format, default width, and whether it can be hidden, sorted, or filtered.

**Table toolbar**, top right of the table, appearing while the pointer is over the table or focus is inside it:

- **Columns:** a checklist of columns with show all and reset; columns can also be reordered.
- **Filter:** shows active filters as removable chips under the toolbar and clears them all.
- **Download:** CSV of the visible rows and columns, or of all rows; uses the Results CSV writer, so every export
  gets identifying header lines and formula-like text neutralised.
- **Style:** density (compact or comfortable), shaded alternate rows, wrap long text, fit columns to content,
  distribute columns evenly, freeze the first column, and reset.

**Column widgets**, in the header cell, appearing while the pointer is over that column or focus is on its header:

- **Filter and sort:** sort ascending or descending; a filter that fits the type (text contains, checklist of
  values for enums and statuses, range for numbers and dates).
- **Format:** decimals, unit scale (for example kWh to MWh), thousands separators, alignment, fit width, hide, and
  freeze.

**Rules that keep hidden widgets usable:**

- An active filter, sort, or format keeps its icon visible, so hiding only applies to widgets in their default
  state. A table whose rows are filtered always says so ("12 of 340 rows").
- Widgets also appear on keyboard focus, on devices without hover (`@media (hover: none)` shows them always), and
  through the header's context menu; header cells reserve their space so nothing shifts when widgets appear.
- Table settings go through view operations keyed by a stable table id, so the agent can set them like the map or
  dashboard view, and tests can drive them.

**Renderers.** Two directions for the work behind the contract:

- **A. One contract, two renderers (recommended).** React Aria `Table` (sorting, column resizing, keyboard
  navigation, selection, no new package) for page and panel tables; AG Grid for the large virtualised Table page,
  with the same toolbar and a custom header component for the column widgets. The widgets and state are written
  once; AG Grid Community lacks a column tool panel anyway, so its menus would be custom either way. Revisit with the
  10,000-building benchmark: if React Aria's virtualiser holds up there, AG Grid can go.
- **B. AG Grid everywhere.** One renderer, but heavy for ten-row tables in forms, harder to style to decision 0021,
  and its keyboard model differs from the rest of the app.
- **C. React Aria everywhere now.** Lightest and most consistent, but it replaces a working virtualised grid before
  the benchmark shows that it can.

**Conflict to settle:** decision 0021 says "no zebra striping". Proposed: shaded alternate rows stay off by default
and become a per-table style choice in the Style menu, which amends 0021 for that option only.

### 4. Further suggestions for streamlining

1. **Number, unit, and date formatting in one module**, used by tables, charts, Inspection, exports, and the agent,
   so 1,234.5 MWh reads the same everywhere and the Format menu changes one setting.
2. **Row actions in one place:** a row's context menu, its hover actions, and the selection toolbar come from one
   action list, like the app actions registry.
3. **Selection follows one model:** selecting a building in any table, list, map, or chart selects it everywhere and
   shows it in Inspection, as the Table and Map already do.
4. **Every chart has a data table** through `Section` + `DataTable`, so the same widgets and download apply to chart
   data.
5. **Confirmation dialogs share one component** stating the consequence and naming the destructive button by its
   action ("Cancel 3 jobs"), as the project lifecycle dialogs already do.
6. **Disabled controls explain themselves the same way:** reason in the tooltip and in menu descriptions (already a
   rule; the components enforce it).
7. **Counts and empty states are built into containers** (`SelectableList`, `DataTable`, `Section`), so no page
   forgets them.
8. **Keyboard map per component** (arrow keys inside, Tab between components, Escape closes menus, F6 between
   regions) documented once in the developer guide.
9. **A component gallery page** (`/?spike=components`) showing every component in every state; browser tests run axe
   and the appearance checks against it, so it becomes the living guideline.
10. **Per-user table and panel preferences** (column choices, density, open sections) stored per table id in this
    browser, separate from the project, until saved layouts are designed.

## Suggested order of work

Each step is reviewable on its own and ends with the full check list from `AGENTS.md`.

1. Primitives and gallery: `Toolbar`, `MenuButton`, `PanelHeader`, `InlineAlert`, `PropertyList`, `Section`,
   `SegmentedFilter`, the formatting module, and the gallery page.
2. `DataTable` on React Aria with the table and column widgets; migrate the plain tables.
3. The AG Grid adapter on the Table page; this closes the known "column visibility menu" gap.
4. Messages: store, toast host, Messages panel, status bar counter; migrate the job notice strip, the last-operation
   sentence, and per-form result lines.
5. `SelectableList` and `LogView`; migrate Jobs, Archetypes, Creator, projects, and the agent's tool-call details.

## Open choices for the owner

1. Table renderer: A (recommended), B, or C.
2. Shaded alternate rows as an opt-in table style, amending decision 0021 for that option.
3. Which events raise a toast: only asynchronous events and failures (recommended; applied commands go to the
   status bar and the panel history without a popup), or every operation.
4. Where the Messages panel docks: a new bottom border collapsed by default (recommended, like an output pane), or
   the right border beside Reasoning and Inspection.
5. Whether table preferences are per user in this browser (recommended) or saved with the project.
