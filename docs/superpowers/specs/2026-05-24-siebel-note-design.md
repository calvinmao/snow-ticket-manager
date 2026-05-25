# Siebel Note — GCT Activity Automation Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Problem

Creating activities in the Avaya GCT (Siebel CRM) portal is a repetitive multi-step process:
navigate to Service → All Service Requests → query SR → drill into SR → Activities tab →
create activity → add comments → log time → change status → save. Agents repeat this
workflow dozens of times per day.

## Solution

Add a "Siebel Note" tab to the existing Chrome extension sidebar that automates the
post-login GCT activity creation workflow via Siebel's JavaScript API
(`theApplication()`, `BusComp`, `InvokeMethod`). This approach avoids DOM
interaction entirely — critical for background tab operation where Chrome
throttles DOM events.

## Scope

- Post-login only — user handles authentication manually
- Single SR per automation run
- Two activity types: SR Status - Outbound, SR Note
- Integrated into existing sidebar as a 5th tab

## UI Design

### Location: New "Siebel Note" tab in sidebar

Tab order: List (default) → Work Note → Action → Query → **Siebel Note**

**Form elements:**

1. **SR Number** — text input, required. Accepts formats like `1-23642931672`
2. **Activity Type** — dropdown, default "SR Status - Outbound"
   - SR Status - Outbound
   - SR Note
3. **Comments** — textarea, required
4. **Time (min)** — number input, default 15
5. **Status** — dropdown, default "Done"
   - Done
   - In Progress
   - Pending
   - Cancelled
6. **Submit button** — "Create Activity & Save"
7. **Result area** — shows step-by-step progress

Send Update Email is always unchecked (no UI control exposed).

## Automation Flow

When the user clicks "Create Activity & Save", background.js orchestrates:

```
1. Find/open GCT tab (gct.avaya.com)
2. Navigate via URL: Service → All Service Requests (chrome.tabs.update + polling)
3. Query: Siebel JS API — InvokeMethod SetSearchSpec on Service Request BC
4. Navigate via URL: Service Request Detail View (drill-in)
5. Verify: Activity List Applet loaded in detail view
6. Create Activity: InvokeMethod NewRecord on Activity BC
7. Fill Form: InvokeMethod SetFieldValue for type, comments, status
8. Log Time: InvokeMethod NewRecord + SetFieldValue on Time BC
9. Save: InvokeMethod WriteRecord on Activity BC
```

**Key technical decisions:**
- Navigation uses URL-based GotoView (chrome.tabs.update) since theApplication().GotoView doesn't exist
- Siebel readiness detected by polling `ActiveViewName()` every 1s after page load (not fixed delay)
- All BC action methods use `InvokeMethod()` — direct calls like `bc.ClearToQuery()` throw "is not a function"
- Query execution is applet-level: `applet.InvokeMethod("NewQuery")` + `applet.InvokeMethod("ExecuteQuery")`
- Content script injected once per workflow (gctInjected flag), not 8 times

Each step reports back to the result area. If any step fails, the chain stops and
reports which step failed with the error.

## Architecture

### Files

| File | Change |
|---|---|
| `chrome-extension/panel.html` | Add Siebel Note tab button + form section |
| `chrome-extension/panel.js` | Tab switching, form handler, send request to background, display results |
| `chrome-extension/background.js` | New `siebelCreateActivity` message handler — finds GCT tab, injects content-gct.js, orchestrates step sequence |
| `chrome-extension/content-gct.js` | **New** — Siebel JavaScript API automation (InvokeMethod-based) |

### Data Flow

```
panel.js ──{ siebelCreateActivity, { srNumber, activityType, comments, time, status } }──► background.js
                                                                                              │
                                                                                    find/inject GCT tab
                                                                                              │
                                                                                    ──{ cmd: "querySR" }──► content-gct.js
                                                                                    ◄──{ ok: true }        ──
                                                                                    ──{ cmd: "drillIn" }──►
                                                                                    ◄──{ ok: true }        ──
                                                                                    ... (each step)
                                                                                    ──{ cmd: "save" }─────►
                                                                                    ◄──{ ok: true }        ──
                                                                                              │
panel.js ◄──{ success: true, steps: [...] }────────────────────────────────────────────────┘
```

### Step-based protocol

`background.js` calls step wrapper functions via `injectAndExecGct()`, which executes
them in the GCT page's MAIN world where `window._siebel` is defined:

```js
// background.js step wrapper (runs in MAIN world via executeScript)
function gctQuerySR(srNumber) {
  return window._siebel.querySR(srNumber);
}

// content-gct.js implementation (runs in MAIN world)
querySR: function (srNumber) {
  // ... Siebel InvokeMethod calls ...
  bc.InvokeMethod("SetSearchSpec", "SR Number", srNumber);
  applet.InvokeMethod("ExecuteQuery");
  // ...
}
```

This matches the existing `snowFetch` injection pattern and keeps
retry/failure logic centralized in the service worker.

### GCT tab management

- If a GCT tab is already open → reuse it
- If not → open new tab to `https://gct.avaya.com/callcenter_enu/`
- If the tab shows login page → report "Please log in to GCT first"

## Error Handling

| Failure | Behavior |
|---|---|
| GCT tab not open / not logged in | "Open gct.avaya.com and log in first" |
| SR not found | "SR X not found. Check the number and try again." |
| Siebel applet not found | "Could not find [applet]. The Siebel UI may have changed." — stop with step name |
| Save fails | "Save failed — [Siebel error message]" |
| Navigation timeout (>30s) | "Navigation timeout after 30s" |
| Siebel not ready (>30s polling) | "Siebel not ready after 30s" |
| Query returns wrong SR | Siebel error check via GetErrorCount/GetErrorMsg |

All errors stop the chain immediately — no partial saves. Form state is preserved for retry.

## Testing Strategy

1. **Manual end-to-end**: Test with a real GCT SR via sidebar; verify Siebel JS API calls work in background tab
2. **`tests/siebel-note.test.js`**: Structural tests for content-gct.js (InvokeMethod patterns, namespace structure), background.js (polling, step sequence), and panel integration
3. **DevTools console testing**: Verify Siebel API object names and method availability before committing code

## Out of Scope

- Bulk activity creation across multiple SRs
- Login automation
- Activity types beyond SR Status - Outbound and SR Note
- Non-Done default status
- Preset comment templates
