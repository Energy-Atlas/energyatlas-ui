# 0023: A mock server owns the project, and a fixture picker sets demo conditions

Date: 2026-10-25

Status: decided by the user (the owner) on 2026-10-25, choosing option A and the recommended answers to the four open
questions. This is step 1 of the [pre-connection roadmap](../pre-connection-roadmap.md), under
[decision 0022](0022-backend-connections-inside-rc.md).

## Context

Before this decision every change ran synchronously in memory through `createWorkbench().execute`, stage runs only
looked slow (a timer simulator stepped tasks), and "Save" wrote `localStorage`. RC, which the UI will later call,
answers asynchronously and runs long jobs. Observed in RC (`feature/archetype-library-schedule-registry`, `7464c140`,
read-only):

- errors are `{success: false, message, code}`; model-binding failures add `title`, `status`, `errors` (messages per
  field), and `traceId` (`EnergyAtlasWeb/Runtime/ApiErrors.cs`);
- while a run holds a project, edits are refused with a 409 whose body has `code: "run_in_progress"`, `jobId`, and
  `kind` (`Runtime/ProjectEditGate.cs`);
- jobs move through `Created`, `Running`, then `Completed`, `Failed`, or `Cancelled`, and keep a log
  (`Runtime/JobRuntimeState.cs`); hubs push `jobProgress`, `jobEvent`, and `workflowProgress`.

## Decision

1. **Option A: a mock server in the page owns the project.** It runs the existing domain engine (`src/domain`, no
   React) behind an asynchronous request interface and keeps its saved project in this browser's storage. The UI keeps
   a copy of the server's state, the requests in flight, and its own UI-only state. One transport between them adds
   delay and injected faults. In RC the mock is replaced by an HTTP and SignalR client; the UI does not change.
2. **Server requests** (asynchronous, can fail): run, cancel, skip, and insert stages; apply edits; create measures and
   scenarios and set adoption; save the project and replace it (new project, fixtures). **Local** (instant): selection,
   pending edits as drafts, the focused stage, view, layout, appearance, and demo conditions.
3. **RC's shapes.** Rejections arrive as RC's error body and are shown on the field they name; edits during a run are
   refused with a 409 `run_in_progress`; the Tasks page becomes Jobs, with RC's job states and a log per job; the agent's
   tool calls take the same server path and wait for the reply.
4. **Undo covers drafts only.** Ctrl+Z undoes and redoes changes to pending edits that have not been sent. Changes the
   server has applied are not undone on the client, because RC's support for that is unknown; sending drafts clears the
   draft history.
5. **A small realistic delay by default** (about 250 to 450 ms), so pending states are always exercised; the browser
   tests run without delay.
6. **A fixture picker sets causes, not displayed states.** A "Demo conditions" dialog (Help menu and command palette)
   loads a project fixture and sets server conditions: delay, faults (next request fails, every request fails, offline,
   input rejected, edit lock held), job behaviour (normal, fail partway, stall), and holding requests unanswered. A
   status-bar chip discloses any non-default condition. URL parameters set the same conditions, and the choice lasts for
   the browser session. The picker ships in the published Pages demo.

## Rationale

- Only a server that owns the state can show the cases the move into RC must survive: a refused change, the edit lock
  during a run, a failed save while work continues, and a reply that never comes.
- The domain layer was already free of React, so reusing it as the mock server's engine costs little and keeps the
  demo's behaviour.
- Conditions that cause states, rather than forcing a surface to look loading or broken, cannot show a state the real
  app could never reach.

## Alternatives

- **Option B, an asynchronous wrapper around the existing workbench:** smaller, but it cannot show server refusals,
  the edit lock, or failed saves, and the swap into RC would still need the restructuring of option A.
- **Fixtures only, without a service layer:** gives review coverage of states but exercises no asynchronous behaviour.
- **Undo for server-applied changes, as before:** not chosen; unknown in RC.
- **No delay by default:** not chosen; pending states would go unseen in review.

## Consequences

- Real: the request states, error display, edit lock, and job lifecycle in the UI. Mocked: the server, its storage,
  the delay, and the faults. Deferred to RC: HTTP, SignalR, sign-in, and native file pickers.
- Applied project changes can no longer be undone with Ctrl+Z.
- The mock server restarts with each page load and restores the last saved project, as the demo did before.
