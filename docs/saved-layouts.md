# Saved layouts: plan and status

Date: 2026-10-28. Stage 1 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed.

## Owner's review (2026-10-28): decision 0033

[Decision 0033](decisions/0033-project-layouts-panel-and-scenarios-page.md) replaces parts of this stage. Personal
layouts are removed: every layout is kept with the project. The Layouts dialog became the **Layouts panel** on the
right border (`src/app/layouts/LayoutsPanel.tsx`), whose table holds each layout's details and its Apply, Update,
Rename, Duplicate, and Delete actions; a layout is saved there by name, or from View > Layouts > Save layout…
through a name prompt (`src/app/layouts/SaveLayoutPrompt.tsx`). `personalLayouts.ts`, `LayoutsDialog.tsx`, and
`layoutsDialogStore.ts` are gone (`layoutsPanelStore.ts` holds the marked row and the prompt), the service addresses
layouts by id, and agent tools no longer take a scope. Review fixes from 2026-10-29 are
[below](#review-fixes-after-decision-0033-2026-10-29). Text below that mentions personal layouts, the dialog,
Copy to personal, or unreadable personal storage describes the stage as first built.

## The owner's decision

Saved layouts for the modeller and, later, the viewer: project layouts and personal layouts (direction C of the
[next stages discussion](next-stages-discussion.md#4-saved-layouts)). A layout holds the panel arrangement and view
settings. Project layouts are saved with the project and will travel in a handover package (stage 5); personal layouts
stay in the browser and work in every project. A viewer's changes are personal and never alter handed-over layouts,
so resetting always returns to them.

RC reference (observed at `7464c140`, recorded in the discussion): RC saves no layouts on the server or in the project
(`Models/ProjectData.cs`); its pages keep per-page presets in `localStorage` (column widths, `resultViewer_state`,
`geoDataPreview_state`, menu state, theme). Personal layouts follow that browser-local behaviour; project layouts have
no RC counterpart.

## What was built

| Part | Where |
| --- | --- |
| Shape, validation, view snapshot, apply rules | `src/app/layouts/savedLayout.ts` (`SavedLayout`, `savedLayoutSchema`, `parseLayoutList`, `captureViewSnapshot`, `applyViewSnapshot`) |
| Personal storage | `src/app/layouts/personalLayouts.ts` (`eaui.layouts.v1`) |
| Operations (one service) | `src/app/layouts/layoutLibrary.ts` (`createLayoutLibrary`, `services.layouts`) |
| Arrangement safety | `prepareArrangement`, `normalizeArrangement`, `getArrangement`, `loadArrangement` in `src/app/layout/layoutController.ts` |
| View settings | the internal view operation `view.applyLayout` in `src/app/view/viewOperations.ts`; `viewStore.execute(..., { record: false })` |
| Saved with the project | `SavedView.layouts` and `SavedView.defaultLayoutId` (`src/server/projectCatalog.ts`), `savedViewSchema` (`src/server/projectSchema.ts`) |
| UI | `src/app/layouts/LayoutsDialog.tsx` (dialog), `layoutsDialogStore.ts`, View > Layouts submenu and palette entries in `src/app/actions.ts`, the ribbon's Layouts quick button, project layouts as View assets in `src/app/panels/AssetsPanel.tsx` + `assetTree.ts` |
| Agent | `layouts.list`, `save`, `apply`, `update`, `rename`, `duplicate`, `delete`, `setDefault`, `reset` tools (`kind: 'layouts'`) in `src/app/agent/tools.ts` |

### A layout

```ts
type SavedLayout = {
  format: 1                       // a later format is kept aside as unreadable
  id: string                      // layout-<uuid>
  name: string                    // 1 to 60 characters, unique per scope (case-insensitive)
  scope: 'project' | 'personal'
  createdAt: string; updatedAt: string
  createdBy: 'manual' | 'agent' | 'system'
  arrangement: object             // FlexLayout JSON, without the active tab group and docking mode
  view: ViewSnapshot              // read section by section on apply
}
```

The view snapshot holds:

- `tables`: every table arrangement by table id (decision 0029);
- `map`: the layer stack (decision 0031), the 3D view, terrain and its exaggeration, and the scene lighting;
- `table`: the Table page's view (buildings or grid) and its search text;
- `dashboard`: scenarios left out of the comparison and the charts added from specifications;
- `jobs`: the Jobs list filter;
- `results`: the chosen result, the drilled-down building, and the resolution.

It leaves out the shared selection, the chosen job, the data intake draft (a dataset and its mapping), the
appearance, and the basemap on/off preference: these belong to the person or the moment, not to an arrangement.

### Operations

All go through `services.layouts` and record one operation-log entry each (type `layouts.*`, workspace messages):

- **Save** the current arrangement and view settings as a new layout, choosing project or personal and a name.
- **Apply**: `layoutController.loadArrangement` for the arrangement, then `view.applyLayout` for the view settings,
  recorded as one `layouts.apply` entry. Anything left out is posted as one warning toast.
- **Update** a layout with the current arrangement and settings.
- **Rename**, **Duplicate** (same scope, " copy"), **Copy to personal / project** (other scope, same name, numbered
  when taken), **Delete** (confirmed inline).
- **Open the project with this layout**: the project's default layout, applied when the project opens.
- **Reset to layout**: re-applies the layout applied last, as it is saved now.
- **Remove stored personal layouts**: the only way past an unreadable personal value.

Entry points: View > Layouts (Layouts… with Ctrl+Alt+L, Save current layout…, Reset to layout, and one Apply entry per
saved layout, ticked when applied), the same entries in the command palette, the ribbon's Layouts quick button, and the
project's layouts under View > Layouts in the Assets tree, where Enter or a double-click opens the dialog on that
layout (arrowing onto the row opens nothing).

## Real, mocked, deferred

- **Real**: saving, validating, applying, updating, renaming, copying, deleting, and resetting layouts; the default
  layout on opening; project layouts saved in the browser's project catalog with the project and restored on opening;
  personal layouts in `localStorage`; unknown tabs and unreadable parts dropped with a note; blocked and unreadable
  storage explained; agent tools through the same service.
- **Mocked**: the project catalog is the browser-local mock server's (decision 0023), so "saved with the project" means
  the browser catalog; there is no shared or server-side store, as in RC.
- **Deferred** (the camera since done by [decision 0036](decisions/0036-owner-review-of-next-stages.md), [status](per-building-zoning.md#the-camera-l1)): the map camera (centre, zoom, pitch, bearing) is not view state, so layouts do not keep it; the stage 5
  viewer and handover package (the service is ready: `projectWritable: false` keeps project layouts read-only and still
  copies them to personal); undo for layout operations (layout and
  view changes are not undoable anywhere); scripted agent sessions that use the new tools (they are offered to a future
  model provider through `describeAgentTools`).

## States

- **Empty**: "No saved layout is applied in this project yet", and per-list empty texts naming where to save.
- **Success**: the status bar and Messages report each operation; the list marks Default and Applied; the applied line
  says "changed since applied" once the arrangement or view settings differ from what was applied.
- **Warning**: parts left out on apply (tabs this version lacks, unreadable sections, charts or results the project has
  not published) as one warning toast; layouts this version cannot read are listed as kept unchanged; save blockers
  (storage, 50 layouts per scope, read-only project layouts) shown under the form.
- **Error**: an arrangement without a page tab group or that FlexLayout refuses is not applied, and the current layout
  stays; blocked storage and an unreadable personal value are shown in the dialog with the recovery action; a storage
  write failure rejects the operation and keeps the previous list.
- **Loading**: none; every operation is local and synchronous. Project layouts reach the server with Save, which keeps
  its existing pending and failure states.
- **Keyboard**: Ctrl+Alt+L opens the dialog; Tab moves through the form, lists, detail, and toolbar; arrow keys and
  type-ahead move in the lists; Enter on a layout applies it; the toolbar is arrow-key navigable; unavailable actions
  stay focusable and explain themselves.

## Decisions taken for review

1. **Snapshot contents** as listed above; selection, the chosen job, the intake draft, appearance, and the basemap
   preference stay out. The map camera is not in view state today, so it is deferred rather than added in this stage.
2. **Apply is tolerant.** Sections a layout lacks stay as they are; a section that does not parse is skipped with a
   note; scenario ids the project lacks are dropped silently; charts that fail validation for the project, results it
   has not published (Results fall back to the baseline), and drill-downs into unmodelled buildings are left out with a
   note; terrain stays off unless the layout's 3D view is on, as `map.setTerrain` requires.
3. **Arrangement safety also applies to the autosaved arrangement.** `restoreModel` now prepares the stored
   `eaui.layout.v2` like a saved layout, so a tab a later version removed is dropped instead of showing the "Unknown
   tab" placeholder (which remains as a fallback). Both side containers always exist, the app's FlexLayout globals
   always win, and the window's docking mode (split or overlay) applies on load.
4. **The default layout applies in full when the project opens**, including its table settings and layers, and the
   views it sets count as the project's opened state, so opening never shows unsaved changes; the next Save stores
   them as usual.
5. **Reset to layout** returns to the layout applied last, as it is saved now; saving or updating a layout makes it the
   applied one. It is unavailable, with a reason, before any layout is applied in the project or after the applied
   layout was deleted. View > Appearance > Reset layout still restores the default arrangement only.
6. **Names** are unique per scope ignoring case, up to 60 characters; at most 50 layouts per scope.
7. **Unreadable storage is never overwritten silently**, as with the project catalog: an unreadable personal value
   blocks personal writes until removed on request; single unreadable entries (personal or project, including later
   formats) are kept as stored and written back unchanged, as are fields a later version adds to a readable layout
   and a default naming a layout this version cannot read.
8. **Project layout changes count as unsaved project changes**, including the default choice.
9. **Agent parity** through `layouts.*` tools; `layouts.update` and `layouts.delete` wait for approval, because
   they lose a layout's content and cannot be undone.
10. **Asset tree**: project layouts are view state saved beside the model, not model assets, so the tree adds them
    under View > Layouts for display (`withLayoutAssets`) and choosing one opens the Layouts dialog rather than
    selecting it; Properties does not describe them. The `layout.saveAsView` capability is now working.
11. **A dialog, not a panel**, hosts layout management, built from `SelectableList`, `PropertyList`, `Toolbar`,
    `InlineAlert`, and `ActionButton`; the default is a checkbox, and Delete is confirmed inline with Keep it
    focused.
12. **Ctrl+Alt+L** opens the dialog; the ribbon gains a Layouts quick button beside Reset layout.

## Known issues and limits

- "Changed since applied" compares the whole arrangement, so resizing a splitter, opening a side panel, or a narrow
  window closing the overlays counts as a change.
- Two tabs: each change re-reads the stored personal layouts and applies only itself, and the `storage` event
  refreshes the list in other tabs; two tabs changing the same layout at once still keep the later change.
- A layout applied in another project keeps table settings for tables that project may never show; they are harmless
  and saved with it.
- Port 5173 on the build machine was taken by another program (an `EnergyAtlasWeb` build of RC), so the dev-server
  specs ran through a throwaway Playwright config on port 5180 under the ignored `tmp/` folder; the specs and the
  committed config are unchanged.

## Review (2026-10-28)

An independent review found nothing high-severity. Fixed on `claude/next-stages`:

- Arrowing through the Assets tree onto a project layout no longer opens the Layouts dialog (the tree selects on
  focus); Enter or a double-click does, and the e2e spec arrows past the row before pressing Enter.
- `layouts.update` now waits for approval like `layouts.delete`.
- `prepareArrangement` keeps the selected tab selected after other tabs are dropped (the first tab when the selected
  one is dropped; a side container stays collapsed), and names repeated tabs it drops.
- Readable layouts keep fields a later version added, and a default naming an unreadable layout is saved back.
- Personal layout changes re-read storage first and other tabs follow the `storage` event, so a layout another tab
  added is not overwritten.
- The delete confirmation focuses Keep it.
- Save current layout… names both reasons when neither scope can take a layout.
- New unit tests: the selected tab after dropped and repeated tabs, kept fields and defaults, two tabs, and storage
  failing during rename, update, and delete.

## Review fixes after decision 0033 (2026-10-29)

Fixed on `claude/next-stages` from a review of the Layouts panel:

- A layout chosen in the Assets tree stays marked only until a layout is applied (saving and updating apply it too),
  the chosen layout is deleted, or another project session starts (`clearFocus` in `layoutLibrary.ts`); the panel
  then marks the applied layout again.
- Keyboard: after Keep it, Delete layout, or Rename's Cancel or Rename, focus returns to the row's actions menu
  (the table when the row is gone) instead of the page; Escape cancels the Rename form and the delete confirmation.
- Updated and Created sort by time, not by their formatted text, and have no range filter.
- The delete confirmation stacks its message above its buttons in the 320 px panel; an empty list is a wrapping line,
  not an empty table wider than the panel.
- A stored `layouts` value that is not a list is no longer dropped by `savedViewSchema` (so the next save erased it):
  it becomes one unreadable entry, reported in the panel and saved back unchanged beside the readable layouts.
- In the viewer the applied line and empty text use viewer wording, and the Default column is left out (State names
  the handed-over default).

Tests: `layoutLibrary.test.ts` (the tree's mark, a non-list layouts value kept) and `e2e/layouts.spec.ts` (marked row
after Apply, focus after rename and delete, Escape, the stacked confirmation, sorting by time).

## Verification (2026-10-28)

After the review fixes: typecheck, lint, format check, `git diff --check`: clean. `npm test`: 395 passed in 43
files (23 in `layoutLibrary.test.ts`). `npm run test:e2e` on port 5180: 106 tests, 105 passed with 4 workers; the same
`project-lifecycle.spec.ts` appearance test hit its 120 s timeout under load again and passed alone (1.6 min).
`npm run test:e2e:preview`: 3 passed.

Before the review:


- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm test`: 391 Vitest tests in 43 files passed (19 new in `src/app/layouts/layoutLibrary.test.ts`: the shape,
  unreadable and foreign entries, names, arrangement preparation, tolerant apply, the internal view operation, save in
  both scopes, apply as one logged operation with change detection and reset, dropped-tab warnings and refused
  arrangements, rename/duplicate/copy/delete/default, the default on opening, blocked and unreadable storage,
  read-only project layouts, saved views, and agent tools).
- `npm run test:e2e` (on port 5180, see above): 106 Playwright tests; 105 passed with 4 workers and
  `project-lifecycle.spec.ts` "start and creation render in every appearance" timed out once under load and passed
  alone (1.4 min). The 3 new specs in `e2e/layouts.spec.ts` cover saving a personal layout, applying it by keyboard
  after changing the arrangement and the table search, Reset to layout from the palette, persistence across a reload,
  deletion, a project layout and default surviving Save and reopen with no unsaved changes, the layout as a View asset,
  and unreadable personal storage with its recovery, with axe on each.
- `npm run test:e2e:preview`: 3 passed.
- Screenshots of the dialog in Light and Dark at 1280x800 were reviewed and deleted.
