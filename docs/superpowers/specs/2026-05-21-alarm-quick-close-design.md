# Alarm INC Quick Close — Design Spec

**Date:** 2026-05-21
**Status:** Approved

## Problem

Alarm-generated INCs follow a repetitive multi-step close process: New → In Progress → Service Restored → Resolved (with status reason) → Closed (with work note). Agents manually click through 3-5 state transitions per alarm ticket. This is tedious and error-prone when handling many alarm INCs.

## Solution

Add a "Close Alarm" feature to the Action tab that chains all state transitions in one click, with a note template selector.

## Scope

- Only visible for INCs where `contact_type === "Alarm"`
- Sequential PATCH approach (one API call per state transition)
- Supports starting from any pre-Resolved state

## UI Design

### Location: Action tab, conditional section

When the user enters an alarm INC number in the Action tab, a new section appears between the ticket number field and the existing state controls. This section is hidden for non-alarm INCs.

**Elements:**

1. **Template dropdown** — preset note templates:
   - "Investigated alarm, confirmed cleared. Closing ticket."
   - "Alarm(s) cleared on access. Verified system restored to normal operation."
   - "False alarm confirmed. No further action required."
   - "Custom" (clears textarea for free-form input)

2. **Textarea** — pre-filled by template selection, user can edit before submitting

3. **"Close Alarm" button** — green styled, triggers the chain

The existing Update button and state dropdown remain unchanged for manual operations.

## State Chain Logic

### Transition table

| Current state | Chain to Closed |
|---|---|
| New (1) | In Progress (2) → Service Restored (4) → Resolved (6) → Closed (7) |
| In Progress (2) | Service Restored (4) → Resolved (6) → Closed (7) |
| Pending (-5) | Service Restored (4) → Resolved (6) → Closed (7) |
| Assigned (5) | Service Restored (4) → Resolved (6) → Closed (7) |
| Service Restored (4) | Resolved (6) → Closed (7) |
| Resolved (6) | Closed (7) |
| Closed (7) | Error: "Ticket is already closed" |
| Cancelled (8) | Error: "Cannot close a cancelled ticket" |

### Fields per step

- **Intermediate steps** (In Progress, Service Restored): `{ state: "<value>" }` only
- **Resolved step**: `{ state: "6", u_status_reason: "Alarm(s) Cleared on Access" }`
- **Closed step**: `{ state: "7", u_status_reason: "Alarm(s) Cleared on Access", work_notes: "<user note>", u_private_note: "<user note>", u_resolution_notes: "<user note>" }`

### Progress display

Show step-by-step progress in the result area:
```
Step 1/4: Setting to In Progress... ✓
Step 2/4: Setting to Service Restored... ✓
Step 3/4: Setting to Resolved... ✓
Step 4/4: Closing ticket... ✓
Alarm ticket closed successfully.
```

### Error handling

- If any step fails, stop the chain and show which step failed
- Display the error message from the API
- The ticket remains at whatever state the last successful step reached

## Background Handler

New `alarmClose` action in `background.js`:

- Receives `{ action: "alarmClose", ticketNumber, note }`
- Fetches ticket to get sys_id and current state
- Determines chain from current state
- Executes PATCH calls sequentially via `updateBySysIdInPage`
- Returns `{ success: true, steps: [...] }` or throws error

## Files Changed

- `chrome-extension/panel.html` — add alarm close section to Action panel
- `chrome-extension/panel.js` — UI logic, template handler, chain trigger, progress display
- `chrome-extension/background.js` — `alarmClose` message handler with sequential PATCH logic

## Out of Scope

- Effort time logging during auto-close (can be added later)
- Bulk close of multiple alarm INCs
- Non-INC ticket types
