# 0028: Properties panel, definition tables, schedule day types, and the floating demo switch

Date: 2026-10-27

Status: accepted by the owner (review feedback on 2026-10-27, after step 5 of
[decision 0027](0027-unified-panel-components.md)); implemented on `claude/ui-component-system`.

## Context

Testing the step 5 build, the owner asked for: no callout cards with a thick left accent bar anywhere (alerts and
selected rows use a fill, as toasts do); round jump-to-top and jump-to-bottom buttons on scrollable tables, lists, and
logs in place of the Follow latest toggle; archetypes, the library, and schedules as tables with filterable columns
and search; item properties seen and edited in the Inspection panel, renamed Properties, including asset details; a
schedule editor that fits its pane, lets points be dragged as well as typed, offers more than weekday and weekend,
shows a year-round equivalent value, highlights edits, and cancels them; measures and scenarios on their own tab
instead of Creator; a start screen with the workbench menu bar, a separate list of demos, and no demo boilerplate; a
demo switch floating over every screen that can be moved; the earlier tool-call cards with a collapse; and a fix for
the Messages panel's laggy resizing and toolbar overflow.

## Decision

- **Fills, never edge bars.** Alerts, job messages, issue boxes, approvals, and selected or current rows use a tone or
  selection fill with a full border where one is needed; `inset 2px 0 0` accents and `border-left` callouts are gone.
- **Jump buttons.** `ScrollJump` floats a round Top button inside the top edge and a round Bottom button inside the
  bottom edge of a scrolling `DataTable`, `GridTable`, `SelectableList`, or `LogView`, while the pointer is over it.
  The upper 70% of the area offers Top, the lower 70% offers Bottom, so the middle band offers both; neither shows
  when the content fits or is already at that end. They are pointer conveniences; Home and End do the same from the
  keyboard. A log follows new lines while the reader is at its end, without a toggle.
- **One selection, any object.** The shared selection (`selection.set`) holds buildings and grid elements as before,
  or one archetype, schedule, measure, scenario, or asset. Choosing a definition replaces a map selection, as
  choosing any object does in a desktop modeler. Saved selections stay compatible.
- **Properties panel.** Inspection is renamed Properties (the layout id stays `panel.inspection`). It reads buildings
  and grid elements as before; for a definition it is the editor, with edited fields marked by the accent edge and a
  dot, a "N fields edited, not saved" line, Save, and Cancel to discard. Unsaved edits are kept per definition for
  the session, so choosing another row and coming back finds them. New definitions start from New buttons on their
  page and are created in Properties (`services.properties.startCreate`).
- **Definition tables.** The Archetypes page shows project archetypes, the synthetic library, and schedules as
  `DataTable`s with search, filters, and sorting; the library adds per row. Creator becomes **Measures and
  scenarios** (page id `creator` kept) with project measures, the measure library, scenarios, and the comparison.
  `DataTable` gains single-row `selection`, a `search` field, and a `barStart` slot.
- **Schedules have day types.** A schedule is one to seven named day profiles of 24 hourly fractions and a week that
  assigns one profile to each day, Monday first. Schedules saved with `weekday` and `weekend` load as Weekday and
  Weekend. The editor draws the active day type as 24 points to drag or move with the arrow keys (Shift for 0.01),
  with hour fields that wrap to the pane, and shows the **annual average**: annual equivalent full-load hours over the
  8,760 hours of the year, the constant value with the same yearly total.
- **Start screen.** It carries the workbench menu bar; actions that need a project are unavailable and say so.
  Recent projects and Demo projects are separate lists; the appearance select and the demo boilerplate are removed
  (appearance stays under View).
- **Demo switch.** Demo conditions move from a dialog to a switch floating over every screen, by default in the
  empty right end of the menu bar so it covers no content, dragged by its grip or moved with the arrow keys (Home
  puts it back), its position kept in this browser. It is compact while conditions are normal and names them when
  on, and it stays usable above modal dialogs.
  Its switch turns conditions off (normal) or back on (the last conditions chosen); its panel, a non-modal dialog
  named Demo conditions, holds the fixtures and server conditions.
- **Tool calls.** Each run of consecutive tool calls collapses to "Used N tools", naming rejected calls; opened, each
  call is a ruled card as before step 5. Only tool input and inline code use the mono face.
- **Resizing.** The layout is saved after changes settle rather than on every splitter move, and tab content is
  cached so a layout change does not re-render every page.

## Consequences

- No new package.
- `schedule.save` takes `days` and `week`; agents and tests that sent `weekday` and `weekend` change with it.
- Browser tests find definitions in tables and edit them in Properties; the workbench is detected by its Workspace
  region, since the start screen now has the same menu bar.
