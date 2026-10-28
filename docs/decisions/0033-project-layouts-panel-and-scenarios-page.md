# 0033: Layouts kept with the project in a Layouts panel, and the Scenarios page

Date: 2026-10-28

Status: accepted by the owner (2026-10-28, reviewing the next stages of [decision 0032](0032-next-stages-directions.md));
implemented on `claude/next-stages`; not merged into `master`, not pushed.

## Context

The owner reviewed the six next stages built under decision 0032 (review items R1 to R16 of the
[completion report](../20261028_next-stages-completion.md)) and asked for changes to saved layouts (R1, R11) and to
the name of the measures and scenarios page. The owner also asked for 3D floors and zones on the map, to be discussed
first ([floors and zones in 3D discussion](../floors-zones-3d-discussion.md)). The owner will review the content of
the Scenarios, Archetypes, Schema matching, Calibration, and viewer panels afterwards.

The owner's words, in short:

1. No personal layouts: every layout is saved with the project only. Layouts are managed in a panel, not a popup.
   A layout can be saved from the panel and from the View menu: in the panel by typing a name and pressing Save; from
   the View menu through a prompt that asks for the name.
2. The details (metadata) and the Apply, Update, Rename, Duplicate, and Delete actions move into the list of
   layouts in the panel, which is a table.
3. Measures and scenarios is renamed Scenarios.

## Decision

- **Layouts are kept with the project only.** Personal layouts, their browser storage (`eaui.layouts.v1`), the
  viewer's per-package personal layouts (`eaui.viewer.layouts.v1:<package id>`), Copy to personal or project, and
  the recovery for unreadable personal storage are removed. A layout keeps `scope: 'project'` in its stored shape,
  so projects and handover packages saved before this decision still read; a stored entry with any other scope is
  kept aside unchanged as unreadable. Values left in browser storage by earlier builds are ignored.
- **A Layouts panel** on the right border, after Messages (`panel.layouts`), replaces the Layouts dialog. It shows the
  applied layout with "changed since applied" and Reset to layout, a Layout name field with Save layout, and the
  layouts as a shared data table (`WorkbenchTable`, id `layouts`).
- **The table holds the details and actions.** Columns: Name; Actions (an Apply button, and a menu, "More actions for
  the layout …", with Update, Rename…, Duplicate, and Delete…, each explaining when unavailable); Default (a checkbox,
  "Open the project with the layout …"); State (Applied, or Applied, changed since); Updated; Saved by; Created. The
  row of the applied layout (or the one chosen in the Assets tree) is marked. Actions follow the name, and the
  changing actions share one menu, because five buttons per row would not fit the 320 px side panel: Name, Apply, the
  menu, and Default fit, and the other details scroll into view (or show when the panel is widened). Rename opens a
  name form above the table; Delete asks for confirmation above the table with Keep it focused.
- **Two ways to save.** In the panel: type a name, press Save layout (or Enter). From View > Layouts > Save layout…
  (and the palette): a "Save layout" prompt asks for the name, with Cancel and Save layout, and closes once saved.
  Both run the same `layouts.save` operation.
- **View > Layouts** now holds Layouts panel (Ctrl+Alt+L, which shows or hides the panel), Save layout…, Reset to
  layout, and one Apply entry per layout. Choosing a layout in the Assets tree (Enter or a double-click) shows the
  panel with that row marked.
- **The viewer** lists the handed-over layouts in the same panel with Apply only; saving, the changing actions, and
  the default checkbox are left out, as are the viewer agent's `layouts.save`, `update`, `rename`, `duplicate`,
  `delete`, and `setDefault` tools. Reset to handed-over layout is unchanged.
- **Agent tools** lose the `scope` and `toScope` inputs: `layouts.save { name }`, `layouts.apply { layoutId }`, and so
  on. `layouts.update` and `layouts.delete` still wait for approval.
- **Scenarios.** The page tab, its heading, the palette entry, and every message that named "Measures and scenarios"
  now say Scenarios; the component id stays `page.creator`, so saved arrangements still restore. The page's own list
  of scenarios is headed "Scenario list" so the page and the list are not both named Scenarios.

## Consequences

- Review items R1 and R11 of the completion report are replaced by this decision; R9 and R10 are unchanged.
- A viewer can no longer keep its own arrangements between visits beyond the autosaved arrangement
  (`eaui.viewer.layout.v1`); it can apply the handed-over layouts and reset to the handed-over one.
- A layout saved in the panel is part of the project's unsaved changes until the project is saved, as before.
