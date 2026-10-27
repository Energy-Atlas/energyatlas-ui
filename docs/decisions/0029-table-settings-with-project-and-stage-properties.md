# 0029: Table settings are saved with the project, and stages show in Properties

Date: 2026-10-27

Status: accepted by the owner (2026-10-27); implemented on `claude/ui-component-system` and
fast-forwarded into local `master` on 2026-10-27 at the owner's request; not pushed.

## Context

[Decision 0027](0027-unified-panel-components.md) left one choice open: whether table preferences are kept per user in
this browser or saved with the project. Until the owner chose, they were kept in this browser under `eaui.tables.v1`.
On 2026-10-27 the owner chose: "table settings may be saved with the project."

In the same message the owner reported that clicking a stage on the Roadmap showed nothing anywhere, not even in the
Roadmap's own details pane, and asked to retire that pane and show stages in the Properties panel like every other
object ([decision 0028](0028-properties-panel-and-definition-tables.md)), with the Roadmap canvas clearly bounded by
visible strokes on all sides and a gap to the panel edge.

## Decision

- **Table settings belong to the project.** The arrangement of every table (filters, sorts, hidden and ordered
  columns, widths, formats, styles) is sent with Save and stored in the project's catalog entry as `view.tables`.
  Opening or creating a project restores what that project saved, or the defaults when it saved none
  (`view.resetForProject`). Nothing is kept in browser storage for tables any more; the old `eaui.tables.v1` key is
  ignored.
- **Changing a table is an unsaved change.** The status bar, the exit guard, and the demo switch count a table whose
  settings differ from the saved ones as unsaved, beside the model's own changes. A table put back to its defaults
  counts as unchanged when the project saved none for it (`tablesDiffer`).
- **Stages are objects in the shared selection.** `stage` joins the selectable entities. Clicking a stage on the
  Roadmap, or pressing Enter on it, focuses it and selects it, and Properties shows its description, dependencies,
  last run, Run or Rerun, Skip or Restore, Previous and Next, and the form that inserts a custom stage after it
  (`src/app/properties/StageProperties.tsx`). The Roadmap's own details pane is gone; the selected stage is filled.
- **The Roadmap canvas is bounded.** It has a rule on every side, small rounded corners, and the panel's spacing
  between it and the panel edge.

## Cause of the Roadmap bug

React Flow sets `pointer-events: none` on nodes that are neither selectable, draggable, nor handled by `onNodeClick`.
The Roadmap turned selection and dragging off and handled clicks on the node's own button, so pointer clicks went to
the pane underneath; only Enter on a focused stage worked. The Roadmap now handles `onNodeClick`.

## Consequences

- Saved projects without table settings open with the defaults; no migration is needed, since `view` is optional in
  the catalog entry and ignored when malformed (`parseSavedView`).
- Table settings follow the project to anyone it is shared with once projects are shared through a real backend; a
  per-user layer over them can be added later if the owner asks.
- Browser tests save and reopen a project to check that tables come back, rather than reloading the page.
