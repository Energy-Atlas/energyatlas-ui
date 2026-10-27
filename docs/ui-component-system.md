# Unified panel components: audit and proposal

Status: accepted as [decision 0027](decisions/0027-unified-panel-components.md) on 2026-10-26, with the owner's
choices recorded at the end. Steps 1 (primitives and gallery) and 2 (the shared data table) are built on
`claude/ui-component-system`; see [step 1 status](#step-1-status) and [step 2 status](#step-2-status). Steps 3 to 5
are not started. It answers the owner's
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
- **Messages panel.** A dockable panel (default: the right border, decision 0027) listing the history as a `LogView`/`SelectableList`: filter by tone and
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
9. **A component gallery page** (built at `/?gallery`) showing every component in every state; browser tests run axe
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

## Owner's choices (2026-10-26)

1. Table renderer: **A**, one contract with two renderers (React Aria `Table`, AG Grid on the Table page).
2. Shaded alternate rows: **an opt-in table style, off by default**, amending decision 0021 for that option only.
3. Toasts: **only asynchronous events and failures**; applied commands go to the status bar and the history.
4. Messages panel: **the right border**, beside Reasoning and Inspection (not the proposed bottom border).
5. Table preferences: not asked yet; the default is per user in this browser, keyed by table id.

## Step 1 status

Built on `claude/ui-component-system` (2026-10-26), not merged into `master`.

**Real:**

- `src/app/format.ts`: `formatNumber`, `formatEnergy`, `formatCount`, `formatTime`, `formatDateTime`, and `NO_DATA`.
  Inspection, the map legend, Jobs, Results, Intake, the project list, and the status bar format through it. Numbers
  keep en-US grouping and times the browser's locale, as before.
- `src/app/components/`: `PanelHeader` (with `HeaderCount`), `Toolbar` (arrow keys; items that do not fit move into
  More from the end, primary actions stay; the fit rule is `toolbarFit.ts`), `MenuButton` (action or checkable
  entries in groups; unavailable entries stay focusable and show their reason), `SegmentedFilter` (a radio group of
  joined cells with optional counts; unavailable choices are disabled and described), `InlineAlert` (four tones with
  an icon; errors are alerts, notices are silent unless `live`), `PropertyList`, and `Section` (a disclosure that
  remembers its open state by id for the session). `useRecordBlocked` in `ActionButton.tsx` records an unavailable
  control's reason in the operation log, for `onBlocked`.
- `src/app/components/menus.module.css`: one menu look, now shared by the ribbon menus, the command palette, the
  Reasoning panel's menus (which gained the check column), and `MenuButton`.
- The gallery at `/?gallery` (`src/app/gallery/`), with an appearance switch and `?appearance=<id>`.

**Adopted in pages:** page and panel headers (Jobs, Results, Intake, Archetypes, Calibration, Table, Roadmap,
Dashboard, Assets, Workflow); the Jobs filter (now with counts) and the Results resolution choice as
`SegmentedFilter`; property lists in Job details, Results provenance, the Roadmap stage details, the Intake fusion
preview, Assets details, and Inspection; chart data tables on the Dashboard and Results as `Section`; the dashboard's
stale notice, the Demo conditions warning, and the form and page errors of Table, Roadmap, Creator, the project
dialogs, and the start screen as `InlineAlert`.

**Deferred:**

- `Toolbar` and `MenuButton` are in the gallery but not yet in pages: the table toolbars of steps 2 and 3 are their
  first users. The Table page's edit row mixes a search field and counts with buttons and is redone in step 3.
- The ribbon's own menus share the menu styles but keep their component; moving them onto `MenuButton` would change
  the Run split button and the account menu without a user-visible gain.
- Inspection and the map's scene properties keep their eyebrow-and-title header, an object header rather than a
  panel header.
- Archetype form results and agent notices stay as they are until the message system (step 4).

**Verification (2026-10-26):** typecheck, lint, and format clean; 325 unit tests, 96 development browser tests
(including `e2e/gallery.spec.ts`: axe in all six appearances, toolbar overflow, keyboard use), and 3 production-preview
tests passed; `git diff --check` clean. The Jobs page was checked by eye in Dark.

## Step 2 status

Built on `claude/ui-component-system` (2026-10-26), not merged into `master`.

**Real:**

- `src/app/components/DataTable.tsx`: React Aria's `Table` (a grid: one tab stop, arrow keys between cells, row
  buttons reached the same way) inside a `ResizableTableContainer`. A tool bar above it holds **Columns** (a
  checklist; the row-naming column stays), **Filters** (the active filters, each removable, and Clear all),
  **Download** (CSV), and **Style** (compact or comfortable rows, shaded alternate rows, wrapped text, column widths
  default, fitted to content, or even, the first column frozen, and Reset table). Each column header holds **Filter
  and sort** (unsorted, ascending, descending; a "contains" filter for text, a checklist of values for enum columns,
  an at-least and at-most range for numbers, drafted and then applied) and **Format** (decimals, thousands
  separators, kWh shown as MWh where the unit scales, alignment, Hide column, Reset format). Clicking a header
  sorts; dragging its edge resizes.
- Widgets appear while the pointer is over the table (tool bar) or the column (its widgets), while focus is inside,
  and while their popover is open; a widget in use (a filter, a sort, hidden columns, a format, a style) stays
  visible, and touch screens always show them. A filtered table says "12 of 340 rows" and lists its filters as
  removable chips; long tables page with "Show 25 more".
- Settings live in view state under a stable table id and change only through the `table.change` view operation,
  so the agent can arrange a table too; tables on screen register their columns (`src/app/tables/tableRegistry.ts`)
  so the operation names unknown ids and columns. Settings are kept per user in this browser (`eaui.tables.v1`) and
  across project switches; a stored entry that no longer parses is dropped.
- The CSV is the view: identifying comment lines (table, project, context such as the run, rows shown of total,
  filters, sort, time), the shown columns with units in their names, every row that passes the filters in order,
  raw values, and formula-like text neutralised. `src/app/csv.ts` is shared with the Results export.
- Shaded alternate rows are off by default, as decision 0027 amends decision 0021.

**Migrated:** Job failed items, Results buildings and series (the series table now has a row per month or hour),
the modeled comparison, Creator measures and scenarios, the Dashboard's monthly, annual, and added-chart data
tables, Intake rejected records, planned changes, and applied datasets, Archetype assignment coverage, Calibration
meter preview, variants, and residuals, Issues, and the Settings capability overview.

**Not migrated, on purpose:** the Intake field mapping and the archetype schedule editor are forms whose cells are
inputs, and the Help dialog's shortcut lists are reference text.

- Default column widths share the pane but never cut a value short: each column's minimum is its fitted width, so
  a narrow pane scrolls sideways; long-text columns (`wrap`) wrap from a readable minimum.
- A range filter is entered in the unit shown (MWh when the column shows MWh) and stored and described in the
  column's own unit ("at least 1,000 kWh"); a checklist that has every value checked is no filter.

**Review:** an independent review found no high-severity defect. Its findings were fixed: ranges ignoring the MWh
scale, the current row no longer announced (it now reads "(current)" in its row header) and losing its mark when
the first column is frozen, format entries that could not return to the default (null now does), the text filter
without a length cap, CSV comment lines that a comma could split into a formula cell and values with a carriage
return, the agent path sorting or filtering columns the controls do not allow, and a checklist capped at 50 values.
Two remain by choice: `jobs.failedItems` is one arrangement for every job kind, and each added chart keeps its own
arrangement in this browser after the chart is removed.

**Deferred:** column reordering, saved per-project arrangements (the owner has not chosen; the default is per user
in this browser), row selection inside tables, and the Table page's AG Grid, which gets the same tool bar and
column widgets in step 3.

**Verification (2026-10-26):** typecheck, lint, and format clean; 344 unit tests, 98 development browser tests
(including `e2e/tables.spec.ts` and the gallery's axe checks in six appearances with the data table), and 3
production-preview tests passed; `git diff --check` clean. Results was checked by eye in a narrow pane.

## Owner review of steps 1 and 2 (2026-10-26)

The owner tried the tables and alerts and asked for these changes, now built on the same branch:

- **Column widgets follow the pointer:** a column's filter-and-sort and format widgets show while the pointer or
  focus is in any cell of that column, not only its header.
- **Text filters search values:** text, identifier, and enum columns open a search field above a checklist of the
  column's distinct values, with Select all (matches). Applying with every value checked clears the filter;
  applying while searching with every match checked keeps the rows that contain the search. Applying or clearing a
  filter closes its popover. Number columns keep the at-least and at-most range.
- **Headers cycle sorts:** clicking a header steps through ascending, descending, and unsorted. There is no
  standalone sort arrow: the column's filter icon shows with the direction in its corner, whether the sort came
  from the header or from the popover, and its name says "sorted ascending" or "sorted descending".
- **Format:** alignment offers Left, Center, and Right; Hide column moved out of the format popover (columns are
  hidden from the table's Columns tool).
- **Freezing:** the Style popover freezes the header row as well as the first column, separately or together; a
  frozen header bounds the table's height so it scrolls within itself. Stored arrangements from before read it as
  off.
- **Shading:** shaded alternate rows were too faint to see, worst in Dark; shading and hover are now opaque mixes
  on the pane colour (7 % text, 12 % accent) and frozen cells keep them.
- **Inline alerts:** no heavy left stroke; the whole alert is edged in its tone at the normal rule width on the
  faint tone fill (`--tone-*-bg`), with its icon.

Verification: typecheck, lint, and format clean; 344 unit, 99 development browser, and 3 production-preview tests
passed. The table, the value-search popover, and the alerts were checked by eye in Light and Dark.

## Step 3 status

Built on `claude/ui-component-system` (2026-10-26), not merged into `master`.

**Real:**

- `src/app/components/GridTable.tsx` draws the shared table contract (`DataColumn`, table settings, `table.change`)
  with AG Grid, for the Table page's Buildings and Grid elements. It has the same table bar (row count, filter chips,
  Columns, Filters, Download, Style) and the same Filter and sort and Format widgets in each column header, shown
  while the pointer or focus is in any cell of the column. This closes the audit's "no column visibility menu" gap.
- The shared model filters, searches, and sorts the rows (`processRows`, `searchRows`), and the grid shows them in
  that order, so both renderers agree and the CSV is the view. AG Grid holds the sort state, driven from the
  settings, with a comparator that keeps the model's order, so the header announces its sort (`aria-sort`) and Enter
  on a header steps it. Clicking a header steps ascending, descending, unsorted. AG Grid's own column filters, menus,
  and column moving are off.
- Keyboard: arrow keys move between headers and cells as before; Enter on a header sorts; Tab from a header steps
  into its two widgets and then on to the next header; keys on a widget belong to the widget.
- Style: row density sets the row height, shading uses a theme variant at the data table's strength, wrapping wraps
  cells and grows rows, the width modes apply, and freezing the first column pins it. The grid always keeps its
  header row in place, so "Freeze the header row" shows as on and unavailable, with that reason.
- The Buildings search moved into the table bar ("Search buildings"). It matches the shown text of shown columns,
  counts toward "12 of 464 rows", is named in the CSV (`# search:`), and still goes through `table.setQuickFilter`.
  When nothing matches, the grid says whether the filters, the search, or both are the cause and offers Clear
  filters and Clear search.
- The tables are `table.buildings` and `table.gridElements`, registered like the others, so the agent can arrange
  them through `table.change`. Their arrangement is kept per user in this browser.
- Editing (floors and archetype, held as pending drafts through `edits.propose`) and row selection stay AG Grid's,
  passed in as `columnOptions` and `gridOptions`. The edit row keeps the pending count, Apply, Discard, and the
  selection.
- Columns carry units (m, m², kWh/yr, MWh/yr, kVA, %), so PV yield and rating can show in MWh/yr and MVA; a column
  can turn thousands separators off by default (`grouping: false`, for years).
- Shared code: `src/app/components/tableTools.tsx` holds the table bar and the column widgets for both renderers,
  `useWorkbenchTable` binds either renderer to view state, registration, and the export log, and
  `nextHeaderSort` is the one header sort cycle.
- Enter in a column filter's value search now applies the filter, in both renderers; the search field had kept
  Enter to itself.

**Deferred:** column order and widths dragged by hand are not kept; the 10,000-building benchmark that decides
whether AG Grid stays is still to run.

**Verification (2026-10-26):** typecheck, lint, and format clean; 348 unit tests, 100 development browser tests
(including the new Table page grid test and the existing Table editing, selection, and lifecycle specs), and 3
production-preview tests passed; `git diff --check` clean. The grid was checked by eye in Dark and Light, narrow and
wide: hover-revealed widgets, the value-search popover, shading, comfortable rows, a pinned first column, a hidden
column, MWh/yr formatting with its popover kept open, and the Grid elements tab.

## Step 4 status

Built on `claude/ui-component-system` (2026-10-26), not merged into `master`.

**Real:**

- `src/app/messages/messageCenter.ts` is the one message store, `services.messages`. Each message has an id, time,
  tone (info, success, warning, danger), source (Project, Jobs, Agent, Server, Workspace), actor (a person, the
  agent, or the system), project id (none for the server connection), text, actions (Open job, Open Reasoning, or
  a page), a toast flag, a read flag, and a resolved flag. It keeps 500 messages for the browser session.
- What feeds it: every operation log entry except progress ticks (so commands, lifecycle results, save results,
  layout and view changes, and refusals), finished jobs (`watchJobCompletions` in `jobs/jobNotices.ts`, which
  replaces the notice store), the agent's approvals and notices, and reconnects (`service.resync`).
- Which messages pop up, following the owner's choice: finished jobs, refused commands, server faults (offline,
  requests failing), reconnects, the agent waiting for approval, and agent errors. A refusal whose every issue
  names a field of a person's own form is shown beside those fields instead; the same refusal of an agent's
  command pops up, since the agent has no form. Applied operations reach the status bar and the history only.
  Messages that pop up start unread; the rest are read when they arrive.
- Toasts (`shell/ToastHost.tsx`): one region, "Notifications", bottom right above the status bar; at most three,
  newest nearest the status bar. Success and information toasts leave after six seconds, with the clock stopped
  while the pointer or focus is on the toasts, and stay unread; warnings and errors stay until dismissed. A toast
  never takes focus; **Ctrl+Alt+N** (View > Go to notifications) reaches the newest. Dismissing one marks it read
  and moves focus to the next toast or back to the workspace; Open job moves focus to the job list. Messages that
  are not operation log entries are announced politely by the region; operations already are, by the status bar.
  Reduced motion removes the slide. A replaced project takes its toasts with it.
- The Messages panel (`panels/MessagesPanel.tsx`) docks on the right border beside Reasoning and Inspection
  (**Ctrl+Alt+M**, View > Panels > Messages). It lists this project's messages and the server's, newest first,
  with time, source, actor, text, and the message's actions; filters by tone (All, Problems) and source (From:
  Anywhere, Project, Jobs, Agent, Server, Workspace); Mark all read; and Clear messages. Messages count as read
  while the panel is on screen. An answered approval is muted and marked "Answered".
- The status bar keeps its last-operation sentence, now read from the store, and adds an unread counter (a bell
  and the count) coloured by the worst unread tone; it opens the Messages panel.
- Migrated: the job notice strip (now toasts and history), the status bar's sentence, and the per-form result lines
  in Creator (measures and scenarios) and Archetypes (archetypes and schedules). Their successes are reported by
  the status bar and the history; their blocking errors stay in the form as a danger `InlineAlert`.
- Saved layouts from before keep their panels; the Messages panel docks on the right the first time it is opened.

**Deferred:** Retry and Undo actions on messages; agent tools that read the history; the history as a `LogView`
(step 5); messages kept across reloads (the history lasts for the browser session).

**Verification (2026-10-26):** typecheck, lint, and format clean; 352 unit tests (including
`src/app/messages/messageCenter.test.ts` and the job notices moved onto the store), 101 development browser tests
(including `e2e/messages.spec.ts`: a refusal toast that never takes focus, Ctrl+Alt+N and keyboard dismissal, a job
toast held by hover and then leaving by itself, the counter opening the panel and marking messages read, both
filters, an action run from the history, Clear, and axe), and 3 production-preview tests passed; `git diff --check`
clean. Toasts, the counter, and the panel were checked by eye in Dark; the gallery shows toasts in three tones and
the history rows.

## Step 5 status

Built on `claude/ui-component-system` (2026-10-26), not merged into `master`. This completes the five steps.

**Real:**

- `src/app/components/SelectableList.tsx`: a React Aria `ListBox` with one row anatomy (the title as the option's
  name, then a status badge and one muted meta line as its description), the selected row in the selection tint with
  the accent edge, arrow keys and type-ahead, an optional search field ("Nothing matches" with Clear search), an
  empty state, and a reason shown when the rows cannot be chosen. `selectionMode="single"` keeps one row selected
  for a detail pane; `"none"` makes each row an action (Enter or click).
- `src/app/components/LogView.tsx`: a `role="log"` region reached by keyboard, lines in Geist Mono with time,
  level icon, source and tags, text, an optional second line, an optional detail read on demand, and actions. All
  and Problems (warnings and errors) as a level filter; Follow latest, on by default and turned off when the reader
  scrolls up; Copy lines; Download as text (`.txt`, one line per entry with ISO time, level, source, and text).
  `scrollable={false}` suits a short log inside another scrolling view.
- Migrated to `SelectableList`: the Jobs list; the Archetypes project archetypes (now with a search field), the
  synthetic library (was a drop-down), and schedules; Creator's measure library (was a drop-down; the chosen
  measure's description still shows under it); the saved projects on the start screen and in the Open project
  dialog (a search field from six projects).
- Migrated to `LogView`: the job log (levels read from the runner's wording: Failed, item failures and Cancelled,
  Completed; Problems filter, follow, download); the agent's tool calls, where each run of consecutive calls is one
  log in the transcript (the tool type and Applied or Rejected as tags, the summary and issues as the second line,
  the input and operation ids on demand, each line still named "Tool call: …"); and the Messages history, now
  oldest first and following the newest, with the source filter beside the level filter and Download.

**Not migrated, on purpose:** Creator's measures and scenarios and the calibration variants stay data tables (step
2): they compare several fields per row and keep sorting, filtering, and export. Listbox options cannot hold
buttons, so trailing row actions are not offered; a row's own action, or the detail it selects, does the work.

**Verification (2026-10-26):** typecheck, lint, and format clean; 358 unit tests (including
`src/app/components/lists.test.tsx`: list naming, keyboard selection, search, actions, the disabled reason, the
empty state, log text, the level filter, and job log levels), 101 development browser tests, and 3 production-preview
tests passed; `git diff --check` clean. Jobs, Archetypes, Creator, the Reasoning tool calls, and the Messages panel
were checked by eye; the gallery shows both components.

## Owner review of step 5 (2026-10-27)

The owner tested step 5 and asked for changes recorded in [decision 0028](decisions/0028-properties-panel-and-definition-tables.md).
Built on `claude/ui-component-system` (2026-10-27), not merged into `master`.

**Real:**

- No left accent bars: the job message is an `InlineAlert`; intake and calibration issues, approvals, and selected
  rows in lists, tables, and the Workflow panel use fills.
- `ScrollJump` (`src/app/components/ScrollJump.tsx`) on `DataTable`, `GridTable`, `SelectableList`, and
  `LogView`. The Follow latest toggle is gone; a log follows while the reader is at its end. Log, Messages, and
  header toolbars wrap or move into More instead of running past the pane (a toolbar measured while its panel was
  closed now measures again when shown).
- Messages resizing: a splitter drag took 180 to 270 ms per pointer move (the whole shell re-rendered and the layout
  was serialized to storage on every move); it now stays under 50 ms (tab content is cached, the layout is saved once
  changes settle, and the Messages panel subscribes to its own open state only).
- Reasoning: runs of tool calls collapse to "Used N tools" and open into the earlier cards; mono only for the input.
- Properties panel (formerly Inspection) shows and edits archetypes, schedules, measures, and scenarios, and shows
  assets from the Assets tree; New buttons create definitions there. Edited fields are marked; Cancel discards.
- Archetypes page: project archetypes, the synthetic library, and schedules as tables with search and filters;
  Measures and scenarios page (formerly Creator): measures, the measure library, scenarios, and the comparison.
- Schedules have one to seven day types and a week; the editor drags or keys points, wraps hour fields to the pane,
  and shows the annual average with equivalent full-load hours.
- Start screen: the workbench menu bar (actions needing a project explain why), Recent projects and Demo projects,
  no appearance select or demo boilerplate. The demo switch floats over every screen and can be moved.

**Verification (2026-10-27):** typecheck, lint, and format clean; 362 unit tests (adds the definition selection,
schedule day types and their migration from weekday/weekend); browser tests updated for the tables, Properties,
the start screen, and the demo switch, with a new schedule editing test (drag keys, edited marks, Cancel).
