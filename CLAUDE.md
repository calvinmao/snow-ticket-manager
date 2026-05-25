# CLAUDE.md — SNOW Ticket Manager

## Project Overview
Chrome extension (Manifest V3) for managing ServiceNow tickets via sidebar. Target instance: `avaya.service-now.com`. Authentication relies on the browser's existing SSO session — no API tokens.

## Architecture
- **panel.html / panel.js** — Sidebar UI with 5 tabs: List (default), Work Note, Action, Query, Siebel Note
- **background.js** — Service worker handling message routing; injects scripts into SNOW and GCT tabs
- **note-fields.js** — Shared module (works in both service worker and browser); builds comment field maps via `buildCommentFields()`
- **content-snow.js** — Injected into SNOW page's MAIN world; provides `snowFetch()` which uses `g_ck` + cookies
- **content-gct.js** — Injected into GCT page's MAIN world; provides `window._siebel` namespace with 8 step methods using Siebel's JavaScript API
- Two-step injection: inject content script first, then `executeScript` with a function that calls the injected API

- `gctInjected` flag in background.js ensures content-gct.js is injected only once per workflow (reset on navigation)

## Siebel/GCT Automation (content-gct.js)
- GCT tab at `gct.avaya.com` is separate from SNOW tab; `findGctTab()` opens one if none exists
- Navigation uses URL-based `GotoView` via `chrome.tabs.update` — `theApplication().GotoView()` doesn't exist
- After navigation, `pollSiebelReady()` polls `ActiveViewName()` every 1s until non-null (max 30s)
- **CRITICAL:** Siebel method call conventions (verified live GCT):
  - **NewRecord must be applet-level:** `applet.InvokeMethod("NewRecord")` — `bc.InvokeMethod("NewRecord", 1)` silently fails (no new record created, cursor stays on existing). This applies to both Activity and Time applets.
  - **Must use BC InvokeMethod:** `ClearToQuery`, `WriteRecord`, `FirstRecord` — direct calls throw "is not a function"
  - **Must use DIRECT call:** `bc.SetFieldValue(field, val)` — `bc.InvokeMethod("SetFieldValue", ...)` silently does NOTHING
  - **Direct call OK:** `GetFieldValue`, `FindApplet`, `BusComp` — work without InvokeMethod
- **CRITICAL:** Field names verified in live GCT: "Type" (NOT "Activity Type"), "Description" (NOT "Comments"), "Status" (may be LOV-constrained on new records)
- Siebel REST API is NOT available on gct.avaya.com (404 on `/Siebel/v1.0/data/describe`) — JS API is the only option
- Query execution is applet-level: `applet.InvokeMethod("NewQuery")` + `applet.InvokeMethod("ExecuteQuery")`
- Error checking via `app.GetErrorCount()` and `app.GetErrorMsg(0)` after query and save
- `GetFieldValue` works directly (no InvokeMethod needed); `FindApplet` and `BusComp` also direct
- Step wrapper functions in background.js (e.g. `gctQuerySR`) delegate to `window._siebel` methods
- 8-step workflow: navigate list view → query SR → navigate detail → verify activities → new activity → fill form → log time → save

## Key Patterns
- All API calls go through `snowFetch()` in the page's MAIN world (required for auth)
- ServiceNow returns `{value, display_value}` objects — use `displayVal()` to extract readable strings
- No inline onclick handlers (CSP blocks them) — use delegated event listeners with class-based selectors (`.toggle-link`, `.add-note-link`, `.update-link`, `.alarm-close-link`)
- Table detection from ticket prefix (first 3 chars) via `TABLE_MAP` (defined in both panel.js and background.js)
- Per-table state configuration via `TABLE_STATES` — labels, classes, transitions, reasons, alarm chains are all keyed by ServiceNow table name
- `getStateConfig(table)` returns the config for a given table, falling back to `incident` for unknown tables
- `stateBadge(state, table)` renders state badges using the correct per-table labels and CSS classes
- Journal entries queried from `sys_journal_field` table
- `switchTab(name)` handles tab switching; List tab auto-loads "My Open Tickets" on first visit and on startup
- Ticket cards in List/Query results have inline expandable forms for Add Note, Update Status, and Close Alarm — no tab switching needed
- Inline forms use mutual exclusion (only one visible per ticket card) and toggle on re-click; forms are inserted after the links container div to keep all links on one line
- Inline forms are reusable after submission — inputs are cleared, status messages shown alongside, previous messages cleaned up on re-submit. No `innerHTML` replacement.
- Visibility is hardcoded to `internal` (public dropdown removed — ACL blocks `comments` field)
- Action panel has a single Update button (Resolve removed); Notes field auto-includes `work_notes` + `u_private_note` on state change
- Action panel state dropdown is dynamically populated based on detected ticket table — only shows valid states for that ticket type
- Alarm INCs detected via `contact_type === "Alarm"` — shows purple badge and green "Close Alarm" action (only for incident table, controlled by `supportsAlarmClose`)
- `alarmClose` action chains state transitions sequentially (e.g. New → In Progress → Service Restored → Resolved → Closed) with `u_status_reason` set on Resolved/Closed steps — only supported for `incident` table
- Effort time is independent of notes — effort is recorded whenever a value is entered, regardless of whether notes are filled in
- List tab is Incident-only with "My" preset filters; raw query and table selector are hidden

## Custom Fields
- `u_wn_type` — Work Note Type dropdown (e.g. "Status Update", "Customer Feedback")
- `u_wn_public` — Boolean: true=public, false=internal. **Controlled by a business rule** that resets it based on whether `comments` field changed
- `u_public_note` / `u_private_note` — Stores the note text for public/internal notes respectively
- `u_wn_effort` — Effort duration in "1970-01-01 HH:MM:SS" format
- `u_resolution_notes` — Resolution notes field
- `u_status_reason` — Status reason dropdown

## Known Limitation: Public Notes (ACL Restriction)
The Avaya instance blocks programmatic write access to the `comments` field via ALL channels:
- REST API (`PATCH /api/now/table/`) — ACL silently ignores `comments`
- `sys_journal_field` direct POST — returns 403 ACL Exception
- `xmlhttp.do` with `AJAXGlideRecord` — empty response, no effect
- Form POST to `/{table}.do` — returns 200 but no effect

A **business rule** on the incident table sets `u_wn_public = true` only when `comments.changes()`.
Since `comments` can never be set programmatically, `u_wn_public` is always reset to `false`.

**Workaround:** All notes go through `work_notes` (which IS writable). Content and type are preserved.
The visibility flag `u_wn_public` will always be `false` (internal).

**To fix properly, the SNOW admin needs to either:**
1. Open the `comments` field ACL for REST API writes, OR
2. Modify the business rule to also check `u_public_note` (not just `comments.changes()`), OR
3. Create a Scripted REST API with elevated privileges to create comments

## State Codes (Per Table)

State codes are defined in `TABLE_STATES` in panel.js. Each table has its own state model:

### incident (Avaya custom)
| Code | State | Note |
|------|-------|------|
| 1 | New | |
| 2 | In Progress | |
| 3 | Awaiting Problem | |
| 4 | Service Restored | |
| 5 | Assigned | |
| 6 | Resolved | |
| 7 | Closed | |
| 8 | Cancelled | |
| -5 | Pending | Follow-up date required |

### change_request
| Code | State |
|------|-------|
| -5 | New |
| -4 | Assess |
| -3 | Authorize |
| -2 | Scheduled |
| -1 | Implement |
| 0 | Review |
| 3 | Closed |
| 4 | Canceled |

### problem (Enhanced model)
| Code | State |
|------|-------|
| 101 | New |
| 102 | Assess |
| 103 | Root Cause Analysis |
| 104 | Fix in Progress |
| 105 | Resolved |
| 106 | Closed |

### sc_req_item (RITM)
| Code | State |
|------|-------|
| 1 | Open |
| 2 | Work in Progress |
| 3 | Closed Complete |
| 4 | Closed Incomplete |
| 5 | Closed Skipped |

### sc_request (REQ)
| Code | State |
|------|-------|
| -5 | Pending |
| 4 | Closed Complete |
| 5 | Closed Incomplete |
| 6 | Closed Rejected |

### task / sc_task
| Code | State |
|------|-------|
| -5 | Pending |
| 1 | Open |
| 2 | Work in Progress |
| 3 | Closed Complete |
| 4 | Closed Incomplete |
| 7 | Closed Skipped |

## Commands
- No build step needed — load `chrome-extension/` folder as unpacked extension
- No tests currently

## ServiceNow Knowledge Base
- `docs/servicenow-kb/` — Official ServiceNow docs (Australia release) for reference
- Key files: `c_TableAPI.md` (REST Table API), `incident-state-model.md`, `change-state-model.md`, `problem-state-model.md`
- Source: https://github.com/ServiceNow/ServiceNowDocs (australia branch)

## CHROMEWEBSTORE.md 智能体指令
- Whenever you are creating or making changes to a Chrome extension, create and manage a CHROMEWEBSTORE.md file. You can use the chrome-extensions skill to learn about the format of this file.
