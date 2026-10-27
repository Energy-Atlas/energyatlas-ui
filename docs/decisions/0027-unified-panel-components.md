# 0027: Unified panel components, one message system, and shared table widgets

Date: 2026-10-26

Status: accepted by the owner (choices made on 2026-10-26); implemented in five steps on `claude/ui-component-system`
and integrated into local `master` on 2026-10-27 (fast-forward, not pushed). See
[unified panel components](../ui-component-system.md) for each step and its verification.

## Context

After testing local `master` at `4400c69`, the owner asked for one design for each kind of component inside a panel
(tables, selectable lists, logs, button groups, filters, popup messages), a message panel that hosts every popup
message, and the same built-in widgets on every table, shown on hover. The audit and full proposal are in
[unified panel components](../ui-component-system.md).

## Decision

- Each kind of panel component is built once in `src/app/components/` on React Aria Components, styled only from
  appearance tokens, and shown in every state on a component gallery page: `DataTable`, `SelectableList`, `LogView`,
  `Toolbar`, `SegmentedFilter`, `MenuButton`, `InlineAlert`, `PropertyList`, `PanelHeader`, and `Section`.
- **State stays where it is shown; events go to messages.** Field validation, blocking form issues, empty states, and
  stale notices stay inline. Events go to one message store, `services.messages`.
- **Toasts** appear in one host region only, and only for asynchronous events and failures: jobs finishing, failed
  saves, server faults and reconnects, agent approvals, and rejected commands. Applied commands appear in the status
  bar and the message history without a popup.
- **The Messages panel** keeps the history of every message and docks by default on the **right border**, beside
  Reasoning and Inspection. The status bar's unread counter opens it.
- **Tables** share one contract with a table toolbar (columns, filter, download, style) and per-column widgets
  (filter and sort, format), revealed on hover or focus; active widgets stay visible. Two renderers implement it:
  React Aria `Table` for page and panel tables, and AG Grid for the large virtualised Table page. The choice is
  revisited with the 10,000-building benchmark.
- **Shaded alternate rows** become an opt-in table style, off by default. This amends
  [decision 0021](0021-energyatlas-family-ui-alignment.md) ("no zebra striping") for that option only.

Table preferences were first kept per user in this browser, keyed by table id, until the owner chose; on 2026-10-27
they chose to save them with the project ([decision 0029](0029-table-settings-with-project-and-stage-properties.md)).

## Consequences

- No new package: React Aria Components, AG Grid, and lucide-react are already accepted (decisions 0007 and 0010).
- The job notice strip, the status bar's last-operation sentence, and per-form result lines move onto the message
  store; existing browser tests for them change with it.
- Table settings go through view operations keyed by table id, so the agent can use them.
- The work proceeds in the five steps listed in the proposal, each with the full check list from `AGENTS.md`.
